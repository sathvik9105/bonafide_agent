// timeline.plausibility — see SPEC.md. No network; dates parsed deterministically.
import { DAY_MS, parseDate, startOfUtcDay } from '../normalise.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, quoteLine, type CheckMeta } from './finding.ts';

export const id = 'timeline.plausibility';
export const stage = 1;

const meta: CheckMeta = { id, label: 'Timeline plausibility', severity: 'major' };

const DURATION = /\b(\d+|one|two|three|four|five|six|seven|a)\s*(hours?|hrs?|days?|weeks?)\b/i;
const REVIEW_WORD = /review|decision|accept|publish|notification/i;
const EXTENSION =
  /\b(final|last|second|2nd|third|3rd|fourth|4th)\s+(deadline\s+)?extension\b|\blast chance\b|\bextended\s+(again|once more)\b/i;

export function appliesTo(_c: Claims): boolean {
  return true;
}

export async function run({ claims, rawText, now }: CheckContext): Promise<Finding[]> {
  const claim = `The review time and deadlines for ${claims.venueName} are realistic`;
  return guard(meta, claim, async () => {
    const findings: Finding[] = [];
    const today = startOfUtcDay(now);
    const daysUntil = (d: Date) => Math.round((d.getTime() - today.getTime()) / DAY_MS);

    const turnaround = claims.promisedTurnaroundDays;
    if (turnaround !== null && turnaround <= 7) {
      findings.push(
        finding(meta, {
          claim,
          verdict: 'contradicted',
          excerpt:
            quoteLine(rawText, (l) => DURATION.test(l) && REVIEW_WORD.test(l)) ?? `Promised turnaround: ${turnaround} days`,
          note: `The invitation promises a decision within ${turnaround} day${turnaround === 1 ? '' : 's'}, faster than real peer review can run.`,
        }),
      );
    }

    const deadlines = claims.deadlines
      .map((text) => ({ text, date: parseDate(text) }))
      .filter((d): d is { text: string; date: Date } => d.date !== null);
    const upcoming = deadlines
      .filter((d) => d.date.getTime() >= today.getTime())
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    const event = parseDate(claims.eventDate);
    if (upcoming && event) {
      const toDeadline = daysUntil(upcoming.date);
      const toEvent = daysUntil(event);
      if (toDeadline <= 14 && toEvent >= 0 && toEvent < 60) {
        findings.push(
          finding(meta, {
            claim,
            verdict: 'contradicted',
            excerpt: `${upcoming.text} (${toDeadline} days away) | Event starts ${claims.eventDate} (${toEvent} days away)`,
            note: `Submissions close in ${toDeadline} days for an event ${toEvent} days away, leaving no time for real review.`,
          }),
        );
      }
    }

    const extension = quoteLine(rawText, EXTENSION) ?? claims.deadlines.find((d) => EXTENSION.test(d)) ?? null;
    if (extension) {
      findings.push(
        finding(meta, {
          claim,
          verdict: 'contradicted',
          severity: 'minor',
          excerpt: extension,
          note: 'The deadline is sold as an extension, a pressure tactic common in mass-mailed invitations.',
        }),
      );
    }

    if (findings.length > 0) return findings;

    if (turnaround === null && deadlines.length === 0 && event === null) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          severity: 'info',
          note: 'The invitation states no review time, deadline or event date to assess.',
        }),
      ];
    }
    const parts = [
      turnaround !== null ? `Turnaround: ${turnaround} days` : null,
      upcoming ? `Next deadline: ${upcoming.text}` : null,
      claims.eventDate ? `Event: ${claims.eventDate}` : null,
    ].filter(Boolean);
    return [
      finding(meta, {
        claim,
        verdict: 'supported',
        excerpt: parts.join(' | ') || null,
        note: 'Nothing in the stated review time or deadlines is implausible.',
      }),
    ];
  });
}
