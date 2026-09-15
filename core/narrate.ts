// Prose for outbound email. Speaker emails are template-only. The disposition is LLM-drafted,
// with a template fallback, so drafting never fails.
import { writeDispositionEmail } from '../providers/llm.ts';
import type { Claims, Finding, Person } from './types.ts';

/** Emails must read like the user wrote them, so they are signed with the user's own name. */
export function senderName(): string {
  return process.env.BONAFIDE_USER_NAME?.trim() || process.env.MAIL_FROM_NAME?.trim() || 'A research student';
}

export function outreachSubject(claims: Claims, token: string, now: Date): string {
  const hasYear = /\b20\d{2}\b/.test(claims.venueName);
  const year =
    [claims.eventDate, ...claims.deadlines].map((s) => s?.match(/\b(20\d{2})\b/)?.[1]).find(Boolean) ??
    String(now.getUTCFullYear());
  return `Quick verification — ${claims.venueName}${hasYear ? '' : ` ${year}`} [BF-${token}]`;
}

export function dispositionSubject(verdict: 'RED' | 'AMBER', claims: Claims): string {
  return verdict === 'RED'
    ? `Re: ${claims.venueName}: not submitting`
    : `Re: ${claims.venueName}: on hold pending verification`;
}

function looksLikeEmail(body: string, sender: string): boolean {
  const b = body.trim();
  return b.length >= 120 && b.length <= 1500 && /^dear\b/i.test(b) && b.includes(sender) && !/[[\]{}<>]|```/.test(b);
}

function outreachTemplate(person: Person, claims: Claims, sender: string): string {
  const kind = claims.venueType === 'journal' ? 'a journal invitation' : 'a conference invitation';
  const where = claims.venueUrl ? `The website for ${claims.venueName}` : `The invitation for ${claims.venueName}`;
  return [
    `Dear ${person.name},`,
    '',
    `I'm a student verifying ${kind} before submitting. ${where} lists your role as "${person.role.trim()}". Could you confirm whether you agreed to take part?`,
    '',
    "If your name is being used without your knowledge, I'd be glad to send you the page.",
    '',
    'Thank you,',
    sender,
  ].join('\n');
}

/** Speaker emails always use the docs/SPEC.md template: the same wording for every speaker, no LLM. */
export function outreachBody(person: Person, claims: Claims): string {
  return outreachTemplate(person, claims, senderName());
}

// Neutral wording for what could not be verified. Never an accusation.
const UNVERIFIED_PHRASE: Record<string, string> = {
  'identity.url_match': "the journal's registered website or publisher",
  'indexing.scopus': 'the Scopus indexing',
  'indexing.doaj': 'the DOAJ listing',
  'domain.age': 'the history of the website',
  'contact.domain': 'the contact address',
  'timeline.plausibility': 'the review timeline',
  'people.callback': "a listed speaker's participation",
};

export function unverifiedDetails(findings: Finding[]): string[] {
  const phrases = findings
    .filter((f) => f.verdict === 'contradicted' && (f.severity === 'fatal' || f.severity === 'major'))
    .map((f) => UNVERIFIED_PHRASE[f.id] ?? f.label.toLowerCase());
  return [...new Set(phrases)];
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function dispositionTemplate(verdict: 'RED' | 'AMBER', claims: Claims, unverified: string[], sender: string): string {
  const middle =
    verdict === 'RED'
      ? `Thank you for the invitation to ${claims.venueName}. I will not be submitting, registering or paying${
          unverified.length ? `, because I could not verify ${joinList(unverified)}` : ''
        }. Please remove my address from your mailing list.`
      : `Thank you for the invitation to ${claims.venueName}. I am verifying the venue's details and will not submit, register or pay until that is complete.`;
  return ['Dear organisers,', '', middle, '', 'Regards,', sender].join('\n');
}

export async function draftDispositionBody(verdict: 'RED' | 'AMBER', claims: Claims, findings: Finding[]): Promise<string> {
  const sender = senderName();
  const unverified = unverifiedDetails(findings);
  try {
    const body = await writeDispositionEmail({ verdict, venueName: claims.venueName, unverified, senderName: sender });
    if (looksLikeEmail(body, sender)) return body.trim();
    console.log('[narrate] disposition draft failed the shape check; using the template');
  } catch (e) {
    console.log(`[narrate] disposition draft failed (${e instanceof Error ? e.message : e}); using the template`);
  }
  return dispositionTemplate(verdict, claims, unverified, sender);
}
