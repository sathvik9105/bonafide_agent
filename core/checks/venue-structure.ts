// venue.structure — see docs/SPEC.md. Stage 2: one Anakin Map call, deliberately conservative.
// A weak, corroborating signal: it alone can never be fatal, and it only contradicts a
// genuinely bare site. Small legitimate workshops must not be flagged by this check alone.
import { map } from '../../providers/anakin.ts';
import { registrableDomain, truncate } from '../normalise.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';

export const id = 'venue.structure';
export const stage = 2;

const meta: CheckMeta = { id, label: 'Venue site structure', severity: 'major' };

const CATEGORIES: Record<string, RegExp> = {
  committee: /committee|chairs?|organi[sz]ers?|keynote|speakers?/i,
  cfp: /\bcfp\b|call-for-papers|submissions?|papers?/i,
  dates: /dates?|deadlines?|schedule|programme?|agenda/i,
  proceedings: /proceedings|publication|archive|past/i,
  contact: /venue|contact|about|location|regist(er|ration)/i,
};

const THIN_LINK_LIMIT = 2;

function matchedCategories(links: string[]): string[] {
  const matched = new Set<string>();
  for (const link of links) {
    let path: string;
    try {
      path = new URL(link).pathname;
    } catch {
      path = link;
    }
    for (const [category, pattern] of Object.entries(CATEGORIES)) {
      if (pattern.test(path)) matched.add(category);
    }
  }
  return [...matched];
}

export function appliesTo(c: Claims): boolean {
  return c.venueType === 'conference' && c.venueUrl !== null;
}

export async function run({ claims, ledger }: CheckContext): Promise<Finding[]> {
  const venueUrl = claims.venueUrl!;
  const claim = `${claims.venueName} has a real site behind it, not a single thin page`;
  return guard(meta, claim, async () => {
    const { links, failure } = await map(venueUrl, { ledger, checkId: id });
    if (failure || links === null) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          severity: 'info',
          sourceUrl: venueUrl,
          note: `The venue site's structure could not be mapped: ${truncate(failure ?? 'no response', 120)}.`,
        }),
      ];
    }

    // Only same-domain pages, and never the seed page itself.
    const domain = registrableDomain(venueUrl);
    const sameSite = links.filter((l) => registrableDomain(l) === domain && l !== venueUrl);
    const categories = matchedCategories(sameSite);

    if (categories.length >= 2) {
      return [
        finding(meta, {
          claim,
          verdict: 'supported',
          sourceUrl: venueUrl,
          excerpt: `${sameSite.length} pages found, matching: ${categories.join(', ')}`,
          note: `The venue site has real structure behind it (${categories.join(', ')} pages found).`,
        }),
      ];
    }

    if (categories.length === 0 && sameSite.length <= THIN_LINK_LIMIT) {
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: venueUrl,
          excerpt: `${sameSite.length} page(s) found, none matching a committee/CFP/dates/proceedings/contact pattern`,
          note:
            'Few structured pages were found. This alone doesn’t prove anything — small legitimate venues ' +
            'can look thin too — so treat it as corroborating, not decisive.',
        }),
      ];
    }

    return [
      finding(meta, {
        claim,
        verdict: 'unverifiable',
        severity: 'info',
        sourceUrl: venueUrl,
        excerpt:
          categories.length > 0
            ? `${sameSite.length} pages found, matching only: ${categories.join(', ')}`
            : `${sameSite.length} pages found, no clear category matches`,
        note: 'The site structure is ambiguous — neither clearly substantial nor clearly bare.',
      }),
    ];
  });
}
