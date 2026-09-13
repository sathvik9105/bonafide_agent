'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreditSummary } from '../core/credits.ts';
import type { Plan } from '../core/orchestrator.ts';
import type { Case, CaseVerdict, Claims, Finding, Outreach, ReplyClass, Severity } from '../core/types.ts';

type MailMode = 'dry' | 'live';
type CaseState = { case: Case; outreach: Outreach[]; mailMode: MailMode };
type VerifyResponse = CaseState & { plan: Plan | null; credits: CreditSummary | null };

const VERDICT_STYLE: Record<CaseVerdict, { box: string; title: string }> = {
  RED: { box: 'border-red-500 bg-red-50/60 text-red-950', title: 'RED: evidence contradicts this invitation' },
  AMBER: { box: 'border-amber-400 bg-amber-50/60 text-amber-950', title: 'AMBER: not enough evidence to clear it' },
  GREEN: { box: 'border-emerald-500 bg-emerald-50/60 text-emerald-950', title: 'GREEN: independently supported' },
};

function verdictMeaning(verdict: CaseVerdict, findings: Finding[]): string {
  const contradicted = findings.filter((f) => f.verdict === 'contradicted');
  const fatal = contradicted.filter((f) => f.severity === 'fatal').length;
  const major = contradicted.filter((f) => f.severity === 'major').length;
  const supported = findings.filter((f) => f.verdict === 'supported').length;
  const speakerDenied = findings.some((f) => f.id === 'people.callback' && (f.excerpt === 'DENIES' || f.excerpt === 'UNAWARE'));
  if (verdict === 'RED') {
    if (speakerDenied) return 'A named speaker replied that they did not agree to take part. That overrides every other finding.';
    return fatal > 0
      ? `${fatal} fatal contradiction${fatal === 1 ? '' : 's'} found in independent sources.`
      : `${major} major contradictions found in independent sources.`;
  }
  if (verdict === 'GREEN') return `No contradictions, and ${supported} independent checks support the venue.`;
  if (major === 1) return 'One major problem was found. That alone is not enough to call the invitation fraudulent.';
  return `AMBER means insufficient evidence, not "slightly suspicious". Only ${supported} check${supported === 1 ? '' : 's'} could confirm anything, and GREEN needs four with no contradictions. Obscure but genuine venues land here too.`;
}

const SEVERITY_ORDER: Record<Severity, number> = { fatal: 0, major: 1, minor: 2, info: 3 };
const VERDICT_ORDER = { contradicted: 0, supported: 1, unverifiable: 2 } as const;

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

const VERDICT_CELL = {
  supported: 'text-emerald-700',
  contradicted: 'text-red-700',
  unverifiable: 'text-zinc-500',
} as const;

const VERDICT_MARK = { supported: '✔', contradicted: '✘', unverifiable: '?' } as const;

const REPLY_STYLE: Record<ReplyClass, string> = {
  CONFIRMS: 'bg-green-100 text-green-800',
  DENIES: 'bg-red-100 text-red-800',
  UNAWARE: 'bg-red-100 text-red-800',
  UNCLEAR: 'bg-zinc-100 text-zinc-700',
};

function claimRows(c: Claims): [string, string][] {
  const rows: [string, string | null][] = [
    ['Venue', `${c.venueName} (${c.venueType})`],
    ['Website', c.venueUrl],
    ['ISSN', c.issn],
    ['Claimed indexing', c.claimedIndexing.join(', ') || null],
    ['Publisher', c.publisher],
    ['Fee', c.feeAmount !== null ? `${c.feeAmount} ${c.feeCurrency ?? ''}`.trim() : null],
    ['Deadlines', c.deadlines.join('; ') || null],
    ['Event date', c.eventDate],
    ['Promised turnaround', c.promisedTurnaroundDays !== null ? `${c.promisedTurnaroundDays} days` : null],
    ['Contact', c.contactEmail],
    [
      'People',
      c.people
        .map((p) => `${p.name}${p.affiliation ? `, ${p.affiliation}` : ''} (${p.role})${p.email ? ` <${p.email}>` : ''}`)
        .join('; ') || null,
    ],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

function sendStatus(o: Outreach, mailMode: MailMode): string {
  if (o.sentAt) return `Sent ${new Date(o.sentAt).toLocaleString()}`;
  if (!o.toEmail) return 'Draft only: the invitation has no contact address';
  if (mailMode === 'dry') return 'Draft only: MAIL_MODE=dry, not sent';
  return 'Not sent: live sending was not requested for this run';
}

function ReplyBlock({ o, mailMode, onUpdate }: { o: Outreach; mailMode: MailMode; onUpdate: (s: CaseState) => void }) {
  const [text, setText] = useState('I have never heard of this event and did not agree to speak at it.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (o.replyClass) {
    return (
      <div className="mt-4 border-t border-zinc-100 pt-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPLY_STYLE[o.replyClass]}`}>{o.replyClass}</span>
          <span className="text-xs text-zinc-500">Reply received {o.replyAt ? new Date(o.replyAt).toLocaleString() : ''}</span>
        </div>
        <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-zinc-700">{o.replyBody}</pre>
      </div>
    );
  }

  if (mailMode === 'live') {
    return (
      <p className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        {o.sentAt ? 'Waiting for a reply. The inbox is checked every 30 seconds.' : 'Not sent, so no reply will arrive.'}
      </p>
    );
  }

  async function simulate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/outreach/${o.id}/simulate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onUpdate({ case: data.case, outreach: data.outreach, mailMode: data.mailMode });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-zinc-100 pt-3">
      <label className="text-xs text-zinc-500">Dry run: simulate this speaker&apos;s reply</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="mt-2 w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100"
      />
      <button
        type="button"
        onClick={simulate}
        disabled={busy || !text.trim()}
        className="mt-2 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
      >
        {busy ? 'Classifying…' : 'Simulate reply'}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function OutreachCard({ o, mailMode, onUpdate }: { o: Outreach; mailMode: MailMode; onUpdate: (s: CaseState) => void }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">{o.personName}</span>{' '}
          <span className="text-zinc-500">&lt;{o.toEmail || 'no address'}&gt;</span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${o.sentAt ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
          {sendStatus(o, mailMode)}
        </span>
      </div>
      <div className="mt-3 font-medium text-zinc-900">{o.subject}</div>
      <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-zinc-700">{o.body}</pre>
      {o.kind === 'speaker' && <ReplyBlock o={o} mailMode={mailMode} onUpdate={onUpdate} />}
    </div>
  );
}

export default function Home() {
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState(false);
  const [sendMail, setSendMail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [flip, setFlip] = useState<string | null>(null);
  const lastVerdict = useRef<CaseVerdict | null>(null);

  const applyCaseState = useCallback((next: CaseState) => {
    const before = lastVerdict.current;
    if (before && next.case.verdict && before !== next.case.verdict) {
      setFlip(`Verdict changed from ${before} to ${next.case.verdict} after a speaker replied.`);
    }
    lastVerdict.current = next.case.verdict;
    setResult((prev) => (prev ? { ...prev, ...next } : prev));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setFlip(null);
    try {
      const res = await fetch(`/api/verify${fresh ? '?fresh=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sendMail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      lastVerdict.current = (data as VerifyResponse).case.verdict;
      setResult(data as VerifyResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // While speakers may still reply, refresh the case so a flipped verdict shows up on its own.
  const caseId = result?.case.id;
  const awaiting = result?.case.status === 'awaiting_reply';
  useEffect(() => {
    if (!caseId || !awaiting) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/case/${caseId}`);
        if (res.ok) applyCaseState((await res.json()) as CaseState);
      } catch {
        // try again on the next tick
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [caseId, awaiting, applyCaseState]);

  const c = result?.case;
  const findings = c?.findings ?? [];
  const speakers = result?.outreach.filter((o) => o.kind === 'speaker') ?? [];
  const dispositions = [...(result?.outreach.filter((o) => o.kind === 'disposition') ?? [])].reverse();
  const outreachFinding = findings.find((f) => f.id === 'people.outreach');

  return (
    <main className="mx-auto w-full max-w-[680px] flex-1 px-4 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Invitation verification</p>
      <h1 className="mt-3 font-serif text-5xl tracking-tight text-zinc-900">BonaFide</h1>
      <p className="mt-4 text-base leading-relaxed text-foreground/60">
        Paste an academic conference or journal invitation. Free registries check its claims, named speakers are asked
        whether they agreed to take part, and a fixed rule decides the verdict.
      </p>

      <form onSubmit={submit} className="mt-10 space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Paste the full invitation email here…"
          className="w-full rounded-lg border border-zinc-200 bg-white p-4 font-mono text-sm leading-relaxed shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        />
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
          >
            {loading ? 'Checking…' : 'Verify invitation'}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" className="accent-indigo-600" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
            Fresh run (skip cache)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" className="accent-indigo-600" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} />
            Send emails for real (needs MAIL_MODE=live on the server)
          </label>
          {loading && <span className="text-sm text-zinc-500">Checking claims and drafting emails, about 20 seconds.</span>}
        </div>
      </form>

      {error && <div className="mt-8 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-800">{error}</div>}

      {result && c && c.verdict && (
        <section className="mt-14 space-y-12">
          {flip && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-sm font-medium text-indigo-900">{flip}</div>
          )}

          <div className={`rounded-lg border-l-4 px-6 py-5 ${VERDICT_STYLE[c.verdict].box}`}>
            <div className="font-serif text-2xl">{VERDICT_STYLE[c.verdict].title}</div>
            <p className="mt-1 text-sm">{verdictMeaning(c.verdict, findings)}</p>
            {c.status === 'awaiting_reply' && (
              <p className="mt-2 text-xs opacity-80">Waiting for speaker replies. This page updates on its own.</p>
            )}
          </div>

          {sendMail && result.mailMode === 'dry' && (
            <p className="text-sm text-zinc-600">
              Live sending was requested, but the server runs with MAIL_MODE=dry, so every email below is a draft.
            </p>
          )}

          {result.plan && (
            <div>
              <h2 className="font-serif text-2xl text-zinc-900">Plan</h2>
              <p className="mt-1 text-sm">
                Planned {result.plan.scheduledCount} of {result.plan.entries.length} checks based on{' '}
                {result.plan.claimCount} claims.
                {result.credits && ` Anakin credits spent: ${result.credits.spent} of ${result.credits.limit}.`}
              </p>
              <ul className="mt-4 flex flex-wrap gap-2 text-xs">
                {result.plan.entries.map((e) => (
                  <li
                    key={e.id}
                    className={`rounded-full border px-3 py-1 font-mono ${e.scheduled ? 'border-zinc-300 text-zinc-800' : 'border-zinc-200 text-zinc-400 line-through'}`}
                  >
                    {e.id}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.claims && (
            <div>
              <h2 className="font-serif text-2xl text-zinc-900">Extracted claims</h2>
              <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                {claimRows(c.claims).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div>
            <h2 className="font-serif text-2xl text-zinc-900">Evidence</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                    <th className="w-[104px] pb-3 pr-4 font-medium">Result</th>
                    <th className="w-[72px] pb-3 pr-4 font-medium">Severity</th>
                    <th className="w-[116px] pb-3 pr-4 font-medium">Check</th>
                    <th className="pb-3 pr-4 font-medium">Evidence</th>
                    <th className="w-[136px] pb-3 pr-4 font-medium">Source</th>
                    <th className="w-[52px] pb-3 text-right font-medium">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {sortFindings(findings).map((f, i) => (
                    <tr key={`${f.id}-${i}`} className="border-b border-zinc-100 align-top last:border-0">
                      <td className={`w-28 py-4 pr-4 font-medium whitespace-nowrap ${VERDICT_CELL[f.verdict]}`}>
                        {VERDICT_MARK[f.verdict]} {f.verdict}
                      </td>
                      <td className="w-16 py-4 pr-4 whitespace-nowrap text-zinc-600">{f.severity}</td>
                      <td className="py-4 pr-4">
                        <div className="font-medium">{f.label}</div>
                        <div className="font-mono text-xs text-zinc-400 [overflow-wrap:anywhere]">{f.id}</div>
                      </td>
                      <td className="py-4 pr-4 break-words">
                        <div>{f.note}</div>
                        {f.excerpt && (
                          <div className="mt-2 rounded-md bg-zinc-50 px-2.5 py-1.5 font-mono text-xs leading-relaxed text-zinc-700 [overflow-wrap:anywhere]">{f.excerpt}</div>
                        )}
                      </td>
                      <td className="truncate py-4 pr-4">
                        {f.sourceUrl ? (
                          <a
                            href={f.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={new URL(f.sourceUrl).host}
                            className="whitespace-nowrap text-indigo-600 hover:text-indigo-700 hover:underline"
                          >
                            {new URL(f.sourceUrl).host}
                          </a>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-4 text-right tabular-nums text-zinc-500">{f.costCredits || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-zinc-900">Speaker verification</h2>
            {speakers.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-600">
                {c.claims?.people.length
                  ? (outreachFinding?.note ?? 'No speaker could be contacted.')
                  : 'The invitation names no speakers, so there is nobody to ask.'}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {speakers.map((o) => (
                  <OutreachCard key={o.id} o={o} mailMode={result.mailMode} onUpdate={applyCaseState} />
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="font-serif text-2xl text-zinc-900">Disposition</h2>
            {dispositions.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-600">
                {c.verdict === 'GREEN' ? 'No disposition email for a GREEN verdict.' : 'No disposition email yet.'}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {dispositions.map((o) => (
                  <OutreachCard key={o.id} o={o} mailMode={result.mailMode} onUpdate={applyCaseState} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
