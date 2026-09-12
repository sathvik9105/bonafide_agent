// Shared helpers for building findings. Checks never throw: guard() turns errors into unverifiable.
import { truncate } from '../normalise.ts';
import type { Finding, FindingVerdict, Severity } from '../types.ts';

export type CheckMeta = { id: string; label: string; severity: Severity };

export type FindingFields = {
  claim: string;
  verdict: FindingVerdict;
  note: string;
  severity?: Severity;
  label?: string;
  sourceUrl?: string | null;
  excerpt?: string | null;
};

export function finding(meta: CheckMeta, f: FindingFields): Finding {
  return {
    id: meta.id,
    label: f.label ?? meta.label,
    claim: truncate(f.claim, 300),
    verdict: f.verdict,
    severity: f.severity ?? meta.severity,
    sourceUrl: f.sourceUrl ?? null,
    excerpt: f.excerpt ? truncate(f.excerpt) : null,
    note: f.note,
    costCredits: 0,
  };
}

/** Run a check body; any throw becomes one unverifiable finding. */
export async function guard(meta: CheckMeta, claim: string, body: () => Promise<Finding[]>): Promise<Finding[]> {
  try {
    return await body();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [finding(meta, { claim, verdict: 'unverifiable', note: `The check could not complete: ${truncate(message, 160)}.` })];
  }
}

/** First line of the invitation matching the pattern, trimmed to excerpt length. */
export function quoteLine(rawText: string, pattern: string | RegExp | ((line: string) => boolean)): string | null {
  const test =
    typeof pattern === 'function'
      ? pattern
      : typeof pattern === 'string'
        ? (line: string) => line.toLowerCase().includes(pattern.toLowerCase())
        : (line: string) => pattern.test(line);
  const line = rawText.split(/\r?\n/).find((l) => l.trim() && test(l));
  return line ? truncate(line) : null;
}
