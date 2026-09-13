// people.reality — see SPEC.md. Stage 2: costs Anakin credits.
import { scrape, search, type CallContext } from '../../providers/anakin.ts';
import { assessSupport } from '../../providers/llm.ts';
import { mentionsWord, plainName, registrableDomain, surnameOf, truncate } from '../normalise.ts';
import type { CheckContext, Claims, Finding, Person } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';
import { hostOf, isInstitutionalFor, lineMentioningVenue, webSearchUrl } from './web.ts';

export const id = 'people.reality';
export const stage = 2;

const meta: CheckMeta = { id, label: 'Speaker reality', severity: 'major' };
const MAX_PEOPLE = 2;
const MAX_SCRAPES = 4;
const SEARCH_LIMIT = 5;
const LISTING_LINK = /\[([^\]]*(?:keynote|speaker|committee|editorial|board)[^\]]*)\]\((https?:\/\/[^)\s]+)\)/i;

export function appliesTo(c: Claims): boolean {
  return c.people.length > 0;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

type Budget = { scrapes: number };

export async function run({ claims, ledger }: CheckContext): Promise<Finding[]> {
  const claim = `The people named by ${claims.venueName} are really involved in it`;
  return guard(meta, claim, async () => {
    const people = claims.people.filter((p) => p.affiliation).slice(0, MAX_PEOPLE);
    if (people.length === 0) {
      return [finding(meta, { claim, verdict: 'unverifiable', note: 'No named person has a stated affiliation to check.' })];
    }
    const call: CallContext = { ledger, checkId: id };
    const budget: Budget = { scrapes: 0 };

    // 1. Reconcile names against the venue's own site: the page given, then a speakers/committee page.
    const venuePages: string[] = [];
    if (claims.venueUrl) {
      try {
        budget.scrapes++;
        const home = await scrape(claims.venueUrl, call);
        if (home.page) {
          venuePages.push(home.page.markdown);
          const someoneMissing = people.some((p) => !listedOn(home.page?.markdown ?? '', p));
          const link = someoneMissing ? home.page.markdown.match(LISTING_LINK)?.[2] : undefined;
          if (link && registrableDomain(link) === registrableDomain(claims.venueUrl)) {
            budget.scrapes++;
            const listing = await scrape(link, call);
            if (listing.page) venuePages.push(listing.page.markdown);
          }
        }
      } catch (e) {
        console.log(`[people.reality] venue site not checked: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 2–3. Each person's own institutional page, judged semantically.
    const findings: Finding[] = [];
    for (const person of people) {
      findings.push(await checkPerson(person, claims, venuePages, call, budget));
    }
    return findings;
  });
}

function listedOn(text: string, person: Person): boolean {
  const surname = surnameOf(person.name);
  return surname !== null && mentionsWord(text, surname);
}

async function checkPerson(
  person: Person,
  claims: Claims,
  venuePages: string[],
  call: CallContext,
  budget: Budget,
): Promise<Finding> {
  const name = plainName(person.name);
  const claim = `${person.name} (${person.affiliation}) is involved in ${claims.venueName} as ${person.role}`;
  const label = `Speaker reality: ${person.name}`;
  const onVenueSite = !claims.venueUrl
    ? 'no venue site given'
    : venuePages.length === 0
      ? 'venue site unreadable'
      : venuePages.some((t) => listedOn(t, person))
        ? 'named on the venue site'
        : 'not named on the venue site';
  const query = `"${name}" ${person.affiliation}`;

  try {
    const surname = surnameOf(person.name);
    const { hits } = await search(query, SEARCH_LIMIT, call);
    const aboutPerson = hits.filter((h) => surname && mentionsWord(`${h.title} ${h.snippet} ${h.url}`, surname));
    const topTitles = hits.slice(0, 3).map((h) => h.title || hostOf(h.url)).join('; ');

    if (aboutPerson.length === 0) {
      return finding(meta, {
        claim,
        label,
        verdict: 'contradicted',
        sourceUrl: webSearchUrl(query),
        excerpt: `Search ${query}: ${hits.length} results, none naming ${surname ?? name}${topTitles ? ` (${topTitles})` : ''}`,
        note: `No search result shows ${person.name} at ${person.affiliation} (${onVenueSite}).`,
      });
    }

    const institutional = aboutPerson.find((h) => isInstitutionalFor(h.url, person.affiliation));
    if (!institutional) {
      return finding(meta, {
        claim,
        label,
        verdict: 'unverifiable',
        sourceUrl: webSearchUrl(query),
        excerpt: truncate(`Results naming ${surname}: ${aboutPerson.map((h) => hostOf(h.url)).join(', ')}`),
        note: `${person.name} appears in search results, but no page at ${person.affiliation} was found to check (${onVenueSite}).`,
      });
    }

    if (budget.scrapes >= MAX_SCRAPES) {
      return finding(meta, {
        claim,
        label,
        verdict: 'unverifiable',
        sourceUrl: institutional.url,
        note: `The ${MAX_SCRAPES}-scrape cap was reached before ${person.name}'s page could be read.`,
      });
    }
    budget.scrapes++;
    const scraped = await scrape(institutional.url, call);
    const host = hostOf(institutional.url);
    if (!scraped.page) {
      return finding(meta, {
        claim,
        label,
        verdict: 'unverifiable',
        sourceUrl: institutional.url,
        note: `${person.name}'s page at ${host} could not be read (${scraped.failure ?? 'no content'}).`,
      });
    }

    const text = scraped.page.markdown;
    const judged = await assessSupport({
      pageText: text,
      personName: person.name,
      affiliation: person.affiliation,
      venueName: claims.venueName,
    });
    const quote =
      judged.quote && squash(text).includes(squash(judged.quote)) ? truncate(judged.quote) : lineMentioningVenue(text, claims.venueName);

    if (judged.mentionsVenue && quote) {
      return finding(meta, {
        claim,
        label,
        verdict: 'supported',
        sourceUrl: institutional.url,
        excerpt: quote,
        note: `${person.name}'s own page at ${host} mentions the venue (${onVenueSite}).`,
      });
    }
    if (judged.personIdentified) {
      return finding(meta, {
        claim,
        label,
        verdict: 'contradicted',
        sourceUrl: institutional.url,
        excerpt: `${host}: ${person.name}'s page, no mention of ${claims.venueName}`,
        note: `No mention of ${claims.venueName} was found on ${person.name}'s page at ${person.affiliation} (${onVenueSite}).`,
      });
    }
    return finding(meta, {
      claim,
      label,
      verdict: 'unverifiable',
      sourceUrl: institutional.url,
      note: `The page found at ${host} is not clearly ${person.name}'s own page, so it settles nothing (${onVenueSite}).`,
    });
  } catch (e) {
    return finding(meta, {
      claim,
      label,
      verdict: 'unverifiable',
      note: `${person.name} could not be checked: ${truncate(e instanceof Error ? e.message : String(e), 160)}.`,
    });
  }
}
