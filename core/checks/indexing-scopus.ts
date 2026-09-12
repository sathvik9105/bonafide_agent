// indexing.scopus — see SPEC.md.
import {
  SCOPUS_SEARCH_URL,
  scopusByIssn,
  scopusByTitle,
  scopusSourceUrl,
  type ScopusRecord,
} from '../../providers/registries.ts';
import { formatIssn } from '../normalise.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';

export const id = 'indexing.scopus';
export const stage = 1;

const meta: CheckMeta = { id, label: 'Scopus indexing claim', severity: 'fatal' };
const TITLE_MATCH = 0.9;

export function appliesTo(c: Claims): boolean {
  return c.claimedIndexing.includes('scopus');
}

function issns(rec: ScopusRecord): string {
  return [rec.issn, rec.eissn].filter((x): x is string => Boolean(x)).map(formatIssn).join(' / ') || 'none listed';
}

export async function run({ claims }: CheckContext): Promise<Finding[]> {
  const claim = `${claims.venueName} is indexed in Scopus${claims.issn ? ` (ISSN ${claims.issn})` : ''}`;
  const isConference = claims.venueType === 'conference';

  const coverage = (rec: ScopusRecord, how: string): Finding => {
    const excerpt = `"${rec.title}" | ISSN ${issns(rec)} | ${rec.active ? 'Active' : 'Inactive'} | Coverage ${rec.coverage}`;
    if (rec.active) {
      return finding(meta, {
        claim,
        verdict: 'supported',
        sourceUrl: scopusSourceUrl(rec),
        excerpt,
        note: `Scopus lists "${rec.title}" as an active source (${how}).`,
      });
    }
    const end = rec.coverageEndYear ?? 'an unstated year';
    return finding(meta, {
      claim,
      verdict: 'contradicted',
      severity: 'major',
      sourceUrl: scopusSourceUrl(rec),
      excerpt: `${excerpt} (last covered ${end})${rec.discontinuedNote ? ` | ${rec.discontinuedNote}` : ''}`,
      note: `Scopus stopped covering "${rec.title}" after ${end}, so the current indexing claim is out of date.`,
    });
  };

  const absent = (excerpt: string): Finding =>
    finding(meta, {
      claim,
      verdict: 'contradicted',
      sourceUrl: SCOPUS_SEARCH_URL,
      excerpt,
      note: 'The Scopus source list has no entry matching this venue, so the Scopus indexing claim is unsupported by the index itself.',
    });

  return guard(meta, claim, async () => {
    if (claims.issn) {
      const rec = await scopusByIssn(claims.issn);
      if (rec) return [coverage(rec, `matched by ISSN ${claims.issn}`)];
      if (!isConference) {
        const hit = await scopusByTitle(claims.venueName);
        if (hit && hit.score >= TITLE_MATCH) {
          return [
            finding(meta, {
              claim,
              verdict: 'contradicted',
              severity: 'major',
              sourceUrl: scopusSourceUrl(hit.record),
              excerpt: `Claimed ISSN ${claims.issn}: not in Scopus | Indexed "${hit.record.title}": ISSN ${issns(hit.record)}`,
              note: 'A journal with this title is indexed, but under a different ISSN from the one the invitation quotes.',
            }),
          ];
        }
      }
      return [absent(`ISSN ${claims.issn}: no Scopus source with this ISSN or EISSN`)];
    }

    if (isConference) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          note: 'Scopus indexes conference proceedings volume by volume after publication, and the invitation gives no ISSN to look up.',
        }),
      ];
    }

    const hit = await scopusByTitle(claims.venueName);
    if (hit && hit.score >= TITLE_MATCH) {
      return [coverage(hit.record, `title match ${hit.score.toFixed(2)} for "${claims.venueName}"`)];
    }
    return [
      absent(
        hit
          ? `No Scopus source titled "${claims.venueName}" (nearest: "${hit.record.title}", similarity ${hit.score.toFixed(2)})`
          : `No Scopus source titled "${claims.venueName}"`,
      ),
    ];
  });
}
