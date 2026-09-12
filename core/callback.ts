// The act layer: speaker outreach, the disposition email, and replies that can flip a verdict.
import { classifyReply } from '../providers/llm.ts';
import { fetchReplies, mailConfigured, sendEmail } from '../providers/mail.ts';
import {
  createOutreach,
  getCase,
  getOutreach,
  listAwaitingReplies,
  listOutreach,
  markOutreachSent,
  newOutreachId,
  recordOutreachReply,
  updateCase,
} from '../store/db.ts';
import { dispositionSubject, draftDispositionBody, outreachBody, outreachSubject } from './narrate.ts';
import { DAY_MS, emailDomain, freeMailProvider, registrableDomain, truncate } from './normalise.ts';
import { capMajorsPerCheck, score } from './scoring.ts';
import type { CaseVerdict, Claims, Finding, Outreach, Person, ReplyClass } from './types.ts';

export const MAX_SPEAKERS = 2;

// ---------------------------------------------------------------- targeting

export type SpeakerTarget = Person & { email: string };
export type TargetSelection = { targets: SpeakerTarget[]; skipped: { name: string; reason: string }[] };

/** Up to two listed people, in invitation order, with an institutional address outside the venue's domains. */
export function pickSpeakerTargets(claims: Claims): TargetSelection {
  const venueDomain = registrableDomain(claims.venueUrl);
  const contactDomain = registrableDomain(emailDomain(claims.contactEmail));
  const targets: SpeakerTarget[] = [];
  const skipped: TargetSelection['skipped'] = [];

  for (const person of claims.people) {
    const domain = emailDomain(person.email);
    const reg = registrableDomain(domain);
    let reason: string | null = null;
    if (!person.email || !domain) reason = 'no email address in the invitation';
    else if (freeMailProvider(domain)) reason = `${reg} is a free mail provider, not an institutional address`;
    else if (reg === venueDomain || reg === contactDomain) reason = `${reg} is the venue's own domain`;
    else if (targets.length >= MAX_SPEAKERS) reason = `only the first ${MAX_SPEAKERS} eligible people are contacted`;

    if (reason) skipped.push({ name: person.name, reason });
    else targets.push({ ...person, email: person.email as string });
  }
  return { targets, skipped };
}

/** "No listed speaker has a discoverable institutional address" is itself a (weak) signal. */
export function noAddressFinding(claims: Claims, selection: TargetSelection): Finding | null {
  if (claims.people.length === 0 || selection.targets.length > 0) return null;
  return {
    id: 'people.outreach',
    label: 'Speaker contact addresses',
    claim: `The ${claims.people.length} named ${claims.people.length === 1 ? 'person' : 'people'} can be asked to confirm their involvement`,
    verdict: 'contradicted',
    severity: 'minor',
    sourceUrl: null,
    excerpt: truncate(selection.skipped.map((s) => `${s.name}: ${s.reason}`).join(' | ')),
    note: 'No listed speaker has a discoverable institutional address, so none could be asked to confirm.',
    costCredits: 0,
  };
}

// ---------------------------------------------------------------- sending

async function deliver(row: Outreach, live: boolean): Promise<void> {
  if (!row.toEmail) {
    console.log(`[mail] ${row.kind} ${row.id} has no recipient address; stored as a draft only`);
    return;
  }
  try {
    const result = await sendEmail({ to: row.toEmail, subject: row.subject, text: row.body }, { live });
    if (result.delivered) markOutreachSent(row.id, Date.now());
  } catch (e) {
    console.error(`[mail] sending ${row.kind} ${row.id} failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function startOutreach(
  caseId: string,
  claims: Claims,
  targets: SpeakerTarget[],
  opts: { live: boolean; now: Date },
): Promise<void> {
  await Promise.all(
    targets.map(async (person) => {
      const body = outreachBody(person, claims);
      const id = newOutreachId();
      const row = createOutreach({
        id,
        caseId,
        kind: 'speaker',
        toEmail: person.email,
        personName: person.name,
        subject: outreachSubject(claims, id, opts.now),
        body,
      });
      await deliver(row, opts.live);
    }),
  );
}

/** Decline for RED, hold note for AMBER, nothing for GREEN. Addressed to the invitation's contact. */
export async function sendDisposition(
  caseId: string,
  claims: Claims,
  findings: Finding[],
  verdict: CaseVerdict,
  opts: { live: boolean },
): Promise<void> {
  if (verdict === 'GREEN') return;
  const body = await draftDispositionBody(verdict, claims, findings);
  const row = createOutreach({
    id: newOutreachId(),
    caseId,
    kind: 'disposition',
    toEmail: claims.contactEmail ?? '',
    personName: 'Venue organisers',
    subject: dispositionSubject(verdict, claims),
    body,
  });
  await deliver(row, opts.live);
}

// ---------------------------------------------------------------- replies

/** Drop quoted history so only the speaker's own words are classified. */
export function stripQuotedReply(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On\b.*\bwrote:\s*$/i.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*wrote:\s*$/i.test(line) && /^\s*On\b/i.test(out[out.length - 1] ?? '')) {
      out.pop(); // "On <date>, <name>" wrapped onto its own line
      break;
    }
    if (/^\s*From:\s/i.test(line) && out.some((l) => l.trim())) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The model's quote if it really appears in the reply; otherwise the reply's first sentence. */
function verifiedQuote(reply: string, quote: string): string {
  if (quote && squash(reply).includes(squash(quote))) return squash(quote);
  return squash(reply).split(/(?<=[.!?])\s+/)[0] ?? '';
}

const CALLBACK_RESULT: Record<ReplyClass, Pick<Finding, 'verdict' | 'severity'>> = {
  CONFIRMS: { verdict: 'supported', severity: 'major' },
  DENIES: { verdict: 'contradicted', severity: 'fatal' },
  UNAWARE: { verdict: 'contradicted', severity: 'fatal' },
  UNCLEAR: { verdict: 'unverifiable', severity: 'info' },
};

function callbackFinding(o: Outreach, claims: Claims, replyClass: ReplyClass, quote: string): Finding {
  return {
    id: 'people.callback',
    label: `Speaker reply: ${o.personName}`,
    claim: `${o.personName} agreed to take part in ${claims.venueName}`,
    ...CALLBACK_RESULT[replyClass],
    sourceUrl: null,
    excerpt: replyClass,
    note: quote ? `${o.personName} replied: "${truncate(quote, 240)}"` : `${o.personName} replied without a clear answer.`,
    costCredits: 0,
  };
}

export type ReplyOutcome = {
  caseId: string;
  outreachId: string;
  replyClass: ReplyClass;
  previousVerdict: CaseVerdict | null;
  verdict: CaseVerdict;
};

/**
 * Record a speaker's reply, append a people.callback finding and re-score the case. The first reply
 * per outreach wins. Returns null when there is no speaker email awaiting a reply under that id.
 */
export async function applyReply(
  outreachId: string,
  rawReply: string,
  opts: { source: 'imap' | 'simulated'; receivedAt?: number },
): Promise<ReplyOutcome | null> {
  const o = getOutreach(outreachId);
  if (!o || o.kind !== 'speaker' || o.replyAt !== null) return null;
  const c = getCase(o.caseId);
  if (!c?.claims) return null;

  const reply = stripQuotedReply(rawReply) || rawReply.trim();
  let replyClass: ReplyClass = 'UNCLEAR';
  let quote = '';
  try {
    const r = await classifyReply({ replyText: reply, personName: o.personName, venueName: c.claims.venueName });
    replyClass = r.classification;
    quote = r.quote;
  } catch (e) {
    console.error(`[callback] classifying reply to ${o.id} failed; recording UNCLEAR: ${e instanceof Error ? e.message : e}`);
  }
  quote = verifiedQuote(reply, quote);
  recordOutreachReply(o.id, { body: reply, replyClass, at: opts.receivedAt ?? Date.now() });

  const findings = capMajorsPerCheck([...(c.findings ?? []), callbackFinding(o, c.claims, replyClass, quote)]);
  const verdict = score(findings);
  const stillAwaiting = listOutreach(c.id).some((x) => x.kind === 'speaker' && x.replyAt === null);
  updateCase(c.id, { findings, verdict, status: stillAwaiting ? 'awaiting_reply' : 'complete' });
  console.log(`[callback] ${o.personName} replied ${replyClass}; case ${c.id} ${c.verdict} -> ${verdict}`);

  if (verdict !== c.verdict && verdict !== 'GREEN') {
    // A real reply can only exist for an email that was really sent, so it may send the new disposition live.
    await sendDisposition(c.id, c.claims, findings, verdict, { live: opts.source === 'imap' && o.sentAt !== null });
  }
  return { caseId: c.id, outreachId: o.id, replyClass, previousVerdict: c.verdict, verdict };
}

export type PollSummary = { awaiting: number; fetched: number; applied: ReplyOutcome[]; skipped: string | null };

let polling = false;

/** One IMAP sweep. Connects only when a speaker email was actually sent and still has no reply. */
export async function pollReplies(): Promise<PollSummary> {
  const awaiting = listAwaitingReplies();
  const summary: PollSummary = { awaiting: awaiting.length, fetched: 0, applied: [], skipped: null };
  if (awaiting.length === 0) return { ...summary, skipped: 'no sent speaker emails are awaiting a reply' };
  if (!mailConfigured()) return { ...summary, skipped: 'GMAIL_USER and GMAIL_APP_PASSWORD are not set' };
  if (polling) return { ...summary, skipped: 'a poll is already running' };

  polling = true;
  try {
    const earliest = Math.min(...awaiting.map((o) => o.sentAt ?? Date.now()));
    const replies = await fetchReplies({
      tokens: new Set(awaiting.map((o) => o.id)),
      since: new Date(earliest - DAY_MS),
    });
    summary.fetched = replies.length;
    for (const r of replies) {
      const outcome = await applyReply(r.token, r.text, { source: 'imap', receivedAt: r.receivedAt });
      if (outcome) summary.applied.push(outcome);
    }
    return summary;
  } finally {
    polling = false;
  }
}

const POLL_INTERVAL_MS = 30_000;
const poller = globalThis as typeof globalThis & { __bonafideReplyPoller?: ReturnType<typeof setInterval> };

/** Started once per server process from instrumentation.ts. */
export function startReplyPoller(): void {
  if (poller.__bonafideReplyPoller) return;
  poller.__bonafideReplyPoller = setInterval(() => {
    pollReplies()
      .then((s) => {
        if (s.applied.length) console.log(`[poller] applied ${s.applied.length} speaker repl${s.applied.length === 1 ? 'y' : 'ies'}`);
      })
      .catch((e) => console.error(`[poller] poll failed: ${e instanceof Error ? e.message : e}`));
  }, POLL_INTERVAL_MS);
  console.log(`[poller] checking for speaker replies every ${POLL_INTERVAL_MS / 1000}s`);
}
