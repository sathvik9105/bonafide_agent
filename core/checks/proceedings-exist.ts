// proceedings.exist — see SPEC.md. Stage 2: one search + one scrape; DOIs resolve free via Crossref.
import { scrape, search, type CallContext } from '../../providers/anakin.ts';
import { crossrefWork, type CrossrefWork } from '../../providers/registries.ts';
import { baseVenueName, editionNumber, venueAcronym } from '../normalise.ts';
import { comparePublishers } from '../publisher.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';
import { cleanDoi, DOI_PATTERN, hostOf, mentionsVenue, webSearchUrl } from './web.ts';

export const id = 'proceedings.exist';
export const stage = 2;

const meta: CheckMeta = { id, label: 'Earlier proceedings', severity: 'major' };
const SEARCH_LIMIT = 5;
const MAX_DOIS = 3;

export function appliesTo(c: Claims): boolean {
  return c.venueType === 'conference' && ((editionNumber(c.venueName) ?? 0) >= 2 || /\bannual\b/i.test(c.venueName));
}

function eventYear(claims: Claims, now: Date): number {
  const fromText = [claims.eventDate, claims.venueName].map((s) => s?.match(/\b(20\d{2})\b/)?.[1]).find(Boolean);
  return fromText ? Number(fromText) : now.getUTCFullYear();
}

export async function run({ claims, now, ledger }: CheckContext): Promise<Finding[]> {
  const claim = `${claims.venueName} has held earlier editions with published proceedings`;
  return guard(meta, claim, async () => {
    const call: CallContext = { ledger, checkId: id };
    const previous = eventYear(claims, now) - 1;
    const acronym = venueAcronym(claims.venueName);
    const query = `${acronym ?? `"${baseVenueName(claims.venueName)}"`} ${previous} proceedings`;
    const edition = editionNumber(claims.venueName);
    const claimedHistory = edition ? `the ${claims.venueName.match(/\b\d{1,3}(st|nd|rd|th)\b/i)?.[0]} edition` : 'an annual event';

    // 1. Last year's edition.
    const { hits } = await search(query, SEARCH_LIMIT, call);
    const prior = hits.find((h) => {
      const text = `${h.title} ${h.snippet} ${h.url}`;
      return mentionsVenue(text, claims.venueName) && text.includes(String(previous));
    });
    if (!prior) {
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: webSearchUrl(query),
          excerpt: `Search ${query}: ${hits.length} results, none for a ${previous} edition${
            hits.length ? ` (${hits.slice(0, 3).map((h) => h.title || hostOf(h.url)).join('; ')})` : ''
          }`,
          note: `The venue calls itself ${claimedHistory}, but no ${previous} edition could be found.`,
        }),
      ];
    }

    // 2. DOIs from that page.
    const scraped = await scrape(prior.url, call);
    if (!scraped.page) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          sourceUrl: prior.url,
          note: `A page for the ${previous} edition was found but could not be read (${scraped.failure ?? 'no content'}).`,
        }),
      ];
    }
    const dois = [...new Set((scraped.page.markdown.match(DOI_PATTERN) ?? []).map(cleanDoi))].slice(0, MAX_DOIS);
    if (dois.length === 0) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          sourceUrl: prior.url,
          excerpt: `${hostOf(prior.url)}: ${prior.title || 'page'}, no DOIs listed`,
          note: `A ${previous} edition page exists at ${hostOf(prior.url)}, but it lists no DOIs to resolve.`,
        }),
      ];
    }

    // 3. Resolve them in Crossref (free).
    const works = await Promise.all(dois.map((doi) => crossrefWork(doi).catch(() => undefined)));
    const resolved = works.filter((w): w is CrossrefWork => Boolean(w));
    if (works.every((w) => w === null)) {
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: prior.url,
          excerpt: `DOIs on ${hostOf(prior.url)}: ${dois.join(', ')} | none exist in Crossref`,
          note: `The DOIs listed for the ${previous} edition do not exist in Crossref.`,
        }),
      ];
    }
    if (resolved.length === 0) {
      return [finding(meta, { claim, verdict: 'unverifiable', sourceUrl: prior.url, note: 'Crossref could not be reached to resolve the DOIs.' })];
    }

    const related = resolved.filter((w) => mentionsVenue(`${w.containerTitle ?? ''} ${w.title ?? ''}`, claims.venueName));
    if (related.length === 0) {
      const w = resolved[0];
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          sourceUrl: w.sourceUrl,
          excerpt: `${w.doi}: "${w.containerTitle ?? w.title ?? 'untitled'}"`,
          note: `The DOIs on the ${previous} page resolve, but to publications that are not this venue's proceedings.`,
        }),
      ];
    }

    const w = related[0];
    if (claims.publisher && w.publisher && comparePublishers(claims.publisher, [w.publisher]).outcome === 'mismatch') {
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: w.sourceUrl,
          excerpt: `Crossref publisher: ${w.publisher} | Invitation publisher: ${claims.publisher}`,
          note: `The ${previous} proceedings are registered to ${w.publisher}, not the publisher the invitation names.`,
        }),
      ];
    }
    return [
      finding(meta, {
        claim,
        verdict: 'supported',
        sourceUrl: w.sourceUrl,
        excerpt: `${w.doi} | ${w.containerTitle ?? w.title ?? ''} | ${w.publisher ?? 'publisher not listed'}`,
        note: `Crossref confirms ${related.length} DOI${related.length === 1 ? '' : 's'} from the ${previous} proceedings.`,
      }),
    ];
  });
}
