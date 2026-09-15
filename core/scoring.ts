// The rule engine. NO LLM. A speaker reply of DENIES or UNAWARE forces RED (docs/SPEC.md).
import type { CaseVerdict, Finding } from './types.ts';

/**
 * One major contradiction per check. A check that reports several keeps its first at major and
 * the rest drop to minor, so a single check can't reach RED alone. Idempotent.
 */
export function capMajorsPerCheck(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.map((f) => {
    if (f.verdict !== 'contradicted' || f.severity !== 'major') return f;
    if (!seen.has(f.id)) {
      seen.add(f.id);
      return f;
    }
    return {
      ...f,
      severity: 'minor',
      note: `${f.note} (Counted as minor: this check already reported a major contradiction.)`,
    };
  });
}

export function score(findings: Finding[]): CaseVerdict {
  const contradicted = findings.filter(f => f.verdict === 'contradicted');
  const fatal = contradicted.filter(f => f.severity === 'fatal');
  const major = contradicted.filter(f => f.severity === 'major');
  const verified = findings.filter(f => f.verdict === 'supported');

  if (findings.some(f => f.id === 'people.callback' && (f.excerpt === 'DENIES' || f.excerpt === 'UNAWARE'))) return 'RED';
  if (fatal.length >= 1) return 'RED';
  if (major.length >= 2) return 'RED';
  if (major.length === 1) return 'AMBER';
  if (contradicted.length === 0 && verified.length >= 4) return 'GREEN';
  return 'AMBER';                                  // insufficient evidence
}
