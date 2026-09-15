// indexing.doaj — see docs/SPEC.md.
import { doajLookup } from '../../providers/registries.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';

export const id = 'indexing.doaj';
export const stage = 1;

const meta: CheckMeta = { id, label: 'DOAJ listing', severity: 'major' };

export function appliesTo(c: Claims): boolean {
  return c.claimedIndexing.includes('doaj') || (c.venueType === 'journal' && c.issn !== null);
}

export async function run({ claims }: CheckContext): Promise<Finding[]> {
  const claimed = claims.claimedIndexing.includes('doaj');
  const claim = claimed
    ? `${claims.venueName} is listed in DOAJ`
    : `${claims.venueName} (ISSN ${claims.issn}): DOAJ listing not claimed, checked anyway`;

  return guard(meta, claim, async () => {
    const isConference = claims.venueType === 'conference';
    if (!claims.issn && isConference) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          note: 'The invitation gives no ISSN, and a conference name cannot be looked up as a DOAJ journal.',
        }),
      ];
    }

    const { record, query, queryUrl } = await doajLookup({
      issn: claims.issn,
      title: isConference ? null : claims.venueName,
    });

    if (record) {
      const issns = [record.pissn, record.eissn].filter(Boolean).join(' / ') || 'none listed';
      return [
        finding(meta, {
          claim,
          verdict: 'supported',
          sourceUrl: record.sourceUrl,
          excerpt: `"${record.title}" | ISSN ${issns} | ${record.publisher ?? 'publisher not listed'}`,
          note: `DOAJ lists "${record.title}".`,
        }),
      ];
    }

    const excerpt = `DOAJ query ${query} returned no matching journal`;
    if (claimed) {
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: queryUrl,
          excerpt,
          note: 'The invitation claims a DOAJ listing, but DOAJ has no journal matching it.',
        }),
      ];
    }
    return [
      finding(meta, {
        claim,
        verdict: 'unverifiable',
        severity: 'info',
        sourceUrl: queryUrl,
        excerpt,
        note: 'The journal is not listed in DOAJ, and the invitation does not claim that it is.',
      }),
    ];
  });
}
