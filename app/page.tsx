'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreditSummary } from '../core/credits.ts';
import type { Plan } from '../core/orchestrator.ts';
import type { Case, CaseVerdict, Claims, Finding, Outreach, ReplyClass, Severity } from '../core/types.ts';

type MailMode = 'dry' | 'live';
type CaseState = { case: Case; outreach: Outreach[]; mailMode: MailMode };
type VerifyResponse = CaseState & { plan: Plan | null; credits: CreditSummary | null };
type Tab = 'evidence' | 'speakers' | 'claims' | 'disposition';

const VERDICT_STYLE: Record<CaseVerdict, { box: string; title: string }> = {
  RED: { box: 'border-bad-line bg-bad-bg text-bad-fg', title: 'RED: evidence contradicts this invitation' },
  AMBER: { box: 'border-warn-line bg-warn-bg text-warn-fg', title: 'AMBER: not enough evidence to clear it' },
  GREEN: { box: 'border-good-line bg-good-bg text-good-fg', title: 'GREEN: independently supported' },
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

const DOT = {
  contradicted: 'bg-bad-dot',
  supported: 'bg-good-dot',
  unverifiable: 'bg-neutral-dot',
} as const;

const SEVERITY_PILL: Record<Severity, string> = {
  fatal: 'bg-fatal-bg text-fatal-fg',
  major: 'bg-major-bg text-major-fg',
  minor: 'bg-minor-bg text-minor-fg',
  info: 'bg-neutral-pill-bg text-neutral-pill-fg',
};

const REPLY_STYLE: Record<ReplyClass, string> = {
  CONFIRMS: 'bg-good-pill-bg text-good-pill-fg',
  DENIES: 'bg-fatal-bg text-fatal-fg',
  UNAWARE: 'bg-fatal-bg text-fatal-fg',
  UNCLEAR: 'bg-neutral-pill-bg text-neutral-pill-fg',
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

/** "Speaker reality: Dr. X" -> title "Speaker reality", subject "Dr. X". */
function splitLabel(label: string): { title: string; subject: string | null } {
  const i = label.indexOf(': ');
  return i > 0 ? { title: label.slice(0, i), subject: label.slice(i + 2) } : { title: label, subject: null };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Stable keys for findings, so expand state survives a re-sort when a speaker reply is appended. */
function keyFindings(findings: Finding[]): { key: string; f: Finding }[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const base = `${f.id}|${f.label}|${f.excerpt ?? ''}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: `${base}|${n}`, f };
  });
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function EvidenceRow({ f, open, onToggle }: { f: Finding; open: boolean; onToggle: () => void }) {
  const { title, subject } = splitLabel(f.label);
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-12 w-full items-center gap-3 px-5 text-left hover:bg-surface-muted"
      >
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.verdict]}`} />
        <span className="sr-only">{f.verdict}:</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {title}
          {subject && <span className="text-ink-subtle"> · {subject}</span>}
        </span>
        {f.verdict === 'contradicted' && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_PILL[f.severity]}`}>
            {f.severity}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="space-y-3 pb-5 pl-10 pr-5">
          <p className="text-sm leading-relaxed text-ink-muted">{f.note}</p>
          {f.excerpt && (
            <pre className="whitespace-pre-wrap rounded-lg bg-code px-3 py-2.5 font-mono text-xs leading-relaxed text-code-ink [overflow-wrap:anywhere]">
              {f.excerpt}
            </pre>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-subtle">
            {f.sourceUrl ? (
              <a
                href={f.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={hostOf(f.sourceUrl)}
                className="text-accent hover:text-accent-hover hover:underline"
              >
                {hostOf(f.sourceUrl)} ↗
              </a>
            ) : (
              <span>No source link</span>
            )}
            <span className="font-mono">{f.id}</span>
            <span className="tabular-nums">
              {f.costCredits} credit{f.costCredits === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

function EvidenceList({ findings }: { findings: Finding[] }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showUnverifiable, setShowUnverifiable] = useState(false);
  const keyed = keyFindings(sortFindings(findings));
  const hiddenCount = keyed.filter(({ f }) => f.verdict === 'unverifiable').length;
  const visible = keyed.filter(({ f }) => showUnverifiable || f.verdict !== 'unverifiable');

  return (
    <ul className="overflow-hidden rounded-xl border border-line bg-surface">
      {visible.map(({ key, f }) => {
        const open = toggled[key] ?? f.verdict === 'contradicted';
        return <EvidenceRow key={key} f={f} open={open} onToggle={() => setToggled((t) => ({ ...t, [key]: !open }))} />;
      })}
      {hiddenCount > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setShowUnverifiable((s) => !s)}
            className="w-full px-5 py-3 text-left text-sm text-accent hover:bg-surface-muted"
          >
            {showUnverifiable
              ? `Hide ${hiddenCount} unverifiable check${hiddenCount === 1 ? '' : 's'}`
              : `${hiddenCount} unverifiable check${hiddenCount === 1 ? '' : 's'} hidden · show all`}
          </button>
        </li>
      )}
    </ul>
  );
}

function ReplyBlock({ o, mailMode, onUpdate }: { o: Outreach; mailMode: MailMode; onUpdate: (s: CaseState) => void }) {
  const [text, setText] = useState('I have never heard of this event and did not agree to speak at it.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (o.replyClass) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPLY_STYLE[o.replyClass]}`}>{o.replyClass}</span>
          <span className="text-xs text-ink-subtle">Reply received {o.replyAt ? new Date(o.replyAt).toLocaleString() : ''}</span>
        </div>
        <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-ink-muted">{o.replyBody}</pre>
      </div>
    );
  }

  if (mailMode === 'live') {
    return (
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-subtle">
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
    <div className="mt-4 border-t border-line pt-3">
      <label className="text-xs text-ink-subtle">Dry run: simulate this speaker&apos;s reply</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="mt-2 w-full rounded-lg border border-line bg-canvas p-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-focus-ring"
      />
      <button
        type="button"
        onClick={simulate}
        disabled={busy || !text.trim()}
        className="mt-2 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-accent hover:bg-surface-muted disabled:opacity-40"
      >
        {busy ? 'Classifying…' : 'Simulate reply'}
      </button>
      {error && <p className="mt-2 text-xs text-bad-fg">{error}</p>}
    </div>
  );
}

function OutreachCard({ o, mailMode, onUpdate }: { o: Outreach; mailMode: MailMode; onUpdate: (s: CaseState) => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium text-ink">{o.personName}</span>{' '}
          <span className="text-ink-subtle">&lt;{o.toEmail || 'no address'}&gt;</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs ${o.sentAt ? 'bg-good-pill-bg text-good-pill-fg' : 'bg-neutral-pill-bg text-neutral-pill-fg'}`}
        >
          {sendStatus(o, mailMode)}
        </span>
      </div>
      <div className="mt-3 font-medium text-ink">{o.subject}</div>
      <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-ink-muted">{o.body}</pre>
      {o.kind === 'speaker' && <ReplyBlock o={o} mailMode={mailMode} onUpdate={onUpdate} />}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-1 font-serif text-3xl tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-subtle">{hint}</div>}
    </div>
  );
}

export default function Home() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [flip, setFlip] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('evidence');
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
    setTab('evidence');
    try {
      // No per-run toggles in the UI: MAIL_MODE on the server decides whether emails are sent, and
      // ?fresh=1 on the API still skips the cache for a live demo run.
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sendMail: true }),
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

  /** "New check": back to the full input form; the previous text stays so it can be edited. */
  function newCheck() {
    setResult(null);
    setFlip(null);
    setError(null);
    lastVerdict.current = null;
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

  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: 'evidence' as const, label: 'Evidence', count: findings.length, show: findings.length > 0 },
    { id: 'speakers' as const, label: 'Speakers', count: speakers.length, show: speakers.length > 0 },
    { id: 'claims' as const, label: 'Claims', count: null, show: Boolean(c?.claims) },
    { id: 'disposition' as const, label: 'Disposition', count: null, show: dispositions.length > 0 },
  ].filter((t) => t.show);
  const activeTab: Tab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'evidence');

  if (!result || !c || !c.verdict) {
    return (
      <main className="flex-1 px-4 py-16">
        <div className="mx-auto w-full max-w-[680px]">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-ink-subtle">Invitation verification</p>
          <h1 className="mt-3 font-serif text-5xl tracking-tight text-ink">BonaFide</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-muted">
            Paste an academic conference or journal invitation. Free registries check its claims, named speakers are asked
            whether they agreed to take part, and a fixed rule decides the verdict.
          </p>

          <form onSubmit={submit} className="mt-10 space-y-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="Paste the full invitation email here…"
              className="w-full rounded-lg border border-line bg-surface p-4 font-mono text-sm leading-relaxed text-ink shadow-sm placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-4 focus:ring-focus-ring"
            />
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={loading || !text.trim()}
                className="rounded-lg bg-button px-4 py-2 text-sm font-medium text-button-ink shadow-sm hover:bg-button-hover disabled:opacity-40"
              >
                {loading ? 'Checking…' : 'Verify invitation'}
              </button>
              {loading && <span className="text-sm text-ink-subtle">Checking claims and drafting emails, about 20 seconds.</span>}
            </div>
          </form>

          <p className="mt-3 text-xs text-ink-subtle">
            Emails are drafted but not sent while MAIL_MODE=dry. Set MAIL_MODE=live on the server to send them.
          </p>

          {error && (
            <div className="mt-8 rounded-lg border border-bad-line bg-bad-bg px-4 py-3 text-sm text-bad-fg">{error}</div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-10">
      <div className="mx-auto w-full max-w-[1080px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-3">
          <div className="min-w-0 truncate text-sm">
            <span className="font-medium text-ink">{c.claims?.venueName ?? 'Invitation'}</span>
            <span className="text-ink-subtle">
              {' '}
              · {result.plan ? `${result.plan.claimCount} claims` : 'claims could not be extracted'}
            </span>
          </div>
          <button
            type="button"
            onClick={newCheck}
            className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
          >
            New check
          </button>
        </div>

        {flip && (
          <div className="rounded-lg border border-notice-line bg-notice-bg px-4 py-3 text-sm font-medium text-notice-fg">{flip}</div>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className={`rounded-xl border-l-4 px-6 py-5 ${VERDICT_STYLE[c.verdict].box}`}>
            <div className="font-serif text-2xl">{VERDICT_STYLE[c.verdict].title}</div>
            <p className="mt-2 text-sm leading-relaxed">{verdictMeaning(c.verdict, findings)}</p>
            {c.status === 'awaiting_reply' && (
              <p className="mt-2 text-xs">Waiting for speaker replies. This page updates on its own.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Checks run"
              value={result.plan ? `${result.plan.scheduledCount}/${result.plan.entries.length}` : '—'}
            />
            <StatCard
              label="Anakin credits"
              value={result.credits ? String(result.credits.spent) : '—'}
              hint={result.credits ? `of ${result.credits.limit} per run` : undefined}
            />
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Result sections"
          className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-tab-track p-1"
        >
          {tabs.map((t) => {
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-4 py-1.5 text-sm ${active ? 'bg-tab-active font-medium text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
              >
                {t.label}
                {t.count !== null && <span className="ml-1.5 tabular-nums text-ink-muted">{t.count}</span>}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" aria-label={activeTab}>
          {activeTab === 'evidence' && <EvidenceList key={c.id} findings={findings} />}

          {activeTab === 'speakers' && (
            <div className="space-y-4">
              {speakers.map((o) => (
                <OutreachCard key={o.id} o={o} mailMode={result.mailMode} onUpdate={applyCaseState} />
              ))}
            </div>
          )}

          {activeTab === 'claims' && c.claims && (
            <div className="rounded-xl border border-line bg-surface p-6">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2.5 text-sm">
                {claimRows(c.claims).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-subtle">{k}</dt>
                    <dd className="break-words text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              {result.plan && (
                <div className="mt-6 border-t border-line pt-5">
                  <h3 className="font-serif text-lg text-ink">Check plan</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    Planned {result.plan.scheduledCount} of {result.plan.entries.length} checks based on{' '}
                    {result.plan.claimCount} claims.
                    {result.credits && ` Anakin credits spent: ${result.credits.spent} of ${result.credits.limit}.`}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                    {result.plan.entries.map((e) => (
                      <li
                        key={e.id}
                        className={`rounded-full border px-3 py-1 font-mono ${e.scheduled ? 'border-line-strong text-ink' : 'border-line text-ink-subtle line-through'}`}
                      >
                        {e.id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'disposition' && (
            <div className="space-y-4">
              {dispositions.map((o) => (
                <OutreachCard key={o.id} o={o} mailMode={result.mailMode} onUpdate={applyCaseState} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
