'use client';

import { useState, type FormEvent } from 'react';
import type { Plan } from '../core/orchestrator.ts';
import type { Case, CaseVerdict, Claims, Finding, Severity } from '../core/types.ts';

type VerifyResponse = { case: Case; plan: Plan | null };

const VERDICT_STYLE: Record<CaseVerdict, { box: string; title: string }> = {
  RED: { box: 'border-red-600 bg-red-50 text-red-950', title: 'RED: evidence contradicts this invitation' },
  AMBER: { box: 'border-amber-500 bg-amber-50 text-amber-950', title: 'AMBER: not enough evidence to clear it' },
  GREEN: { box: 'border-green-600 bg-green-50 text-green-950', title: 'GREEN: independently supported' },
};

function verdictMeaning(verdict: CaseVerdict, findings: Finding[]): string {
  const contradicted = findings.filter((f) => f.verdict === 'contradicted');
  const fatal = contradicted.filter((f) => f.severity === 'fatal').length;
  const major = contradicted.filter((f) => f.severity === 'major').length;
  const supported = findings.filter((f) => f.verdict === 'supported').length;
  if (verdict === 'RED') {
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
  supported: 'text-green-700',
  contradicted: 'text-red-700',
  unverifiable: 'text-zinc-500',
} as const;

const VERDICT_MARK = { supported: '✔', contradicted: '✘', unverifiable: '?' } as const;

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
    ['People', c.people.map((p) => `${p.name}${p.affiliation ? `, ${p.affiliation}` : ''} (${p.role})`).join('; ') || null],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

export default function Home() {
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/verify${fresh ? '?fresh=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data as VerifyResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const c = result?.case;
  const findings = c?.findings ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 bg-white px-4 py-8 text-zinc-900">
      <h1 className="text-2xl font-semibold">BonaFide</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Paste an academic conference or journal invitation. Free registries check its claims; a fixed rule decides
        the verdict.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Paste the full invitation email here…"
          className="w-full rounded border border-zinc-300 p-3 font-mono text-sm"
        />
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {loading ? 'Checking…' : 'Verify invitation'}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
            Fresh run (skip cache)
          </label>
          {loading && <span className="text-sm text-zinc-500">Extracting claims and querying registries, about 15 seconds.</span>}
        </div>
      </form>

      {error && <div className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {c && c.verdict && (
        <section className="mt-8 space-y-6">
          <div className={`rounded border-l-4 p-4 ${VERDICT_STYLE[c.verdict].box}`}>
            <div className="text-lg font-semibold">{VERDICT_STYLE[c.verdict].title}</div>
            <p className="mt-1 text-sm">{verdictMeaning(c.verdict, findings)}</p>
          </div>

          {result.plan && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Plan</h2>
              <p className="mt-1 text-sm">
                Planned {result.plan.scheduledCount} of {result.plan.entries.length} checks based on{' '}
                {result.plan.claimCount} claims.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {result.plan.entries.map((e) => (
                  <li
                    key={e.id}
                    className={`rounded px-2 py-1 font-mono ${e.scheduled ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400 line-through'}`}
                  >
                    {e.id}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.claims && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Extracted claims</h2>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Evidence</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-xs uppercase text-zinc-500">
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Severity</th>
                    <th className="py-2 pr-3">Check</th>
                    <th className="py-2 pr-3">Evidence</th>
                    <th className="py-2 pr-3">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {sortFindings(findings).map((f, i) => (
                    <tr key={`${f.id}-${i}`} className="border-b border-zinc-100 align-top">
                      <td className={`py-2 pr-3 font-medium whitespace-nowrap ${VERDICT_CELL[f.verdict]}`}>
                        {VERDICT_MARK[f.verdict]} {f.verdict}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{f.severity}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{f.label}</div>
                        <div className="font-mono text-xs text-zinc-400">{f.id}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <div>{f.note}</div>
                        {f.excerpt && (
                          <div className="mt-1 rounded bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700">{f.excerpt}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {f.sourceUrl ? (
                          <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline">
                            {new URL(f.sourceUrl).host}
                          </a>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
