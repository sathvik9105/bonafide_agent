// reports.prior — see SPEC.md. Stage 2: one search, deliberately minor.
import { search } from '../../providers/anakin.ts';
import { baseVenueName, truncate } from '../normalise.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';
import { hostOf, isCredibleSource, mentionsVenue, webSearchUrl } from './web.ts';

export const id = 'reports.prior';
export const stage = 2;

const meta: CheckMeta = { id, label: 'Prior warnings', severity: 'minor' };
const SEARCH_LIMIT = 10;
const WARNING = /\b(predatory|scam|fake|hijack(ed|ing)?|fraud(ulent)?|bogus|beware|warning|questionable)\b/i;

export function appliesTo(c: Claims): boolean {
  return c.venueName.trim().length > 0;
}

export async function run({ claims, ledger }: CheckContext): Promise<Finding[]> {
  const claim = `${claims.venueName} has no public warnings against it`;
  return guard(meta, claim, async () => {
    const name = baseVenueName(claims.venueName) || claims.venueName;
    const query = `"${name}" predatory OR scam OR fake`;
    const { hits } = await search(query, SEARCH_LIMIT, { ledger, checkId: id });

    const credible = hits.filter((h) => {
      const text = `${h.title} ${h.snippet}`;
      return isCredibleSource(h.url) && WARNING.test(text) && mentionsVenue(text, claims.venueName);
    });
    if (credible.length > 0) {
      const top = credible[0];
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: top.url,
          excerpt: truncate(`${top.title}: ${top.snippet}`),
          note: `${credible.length} credible source${credible.length === 1 ? '' : 's'} warn about this venue; the strongest is ${hostOf(top.url)}.`,
        }),
      ];
    }
    return [
      finding(meta, {
        claim,
        verdict: 'unverifiable',
        severity: 'info',
        sourceUrl: webSearchUrl(query),
        excerpt: `Search ${query}: ${hits.length} results, none a credible warning about this venue`,
        note: 'No credible warnings were found, and an absence of complaints is weak evidence.',
      }),
    ];
  });
}
