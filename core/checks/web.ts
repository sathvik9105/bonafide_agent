// Shared, deterministic helpers for the Stage 2 web checks.
import {
  baseVenueName,
  editDistance,
  isAcademicDomain,
  mentionsWord,
  normaliseTitle,
  plainName,
  registrableDomain,
  stripDiacritics,
  surnameOf,
  truncate,
  venueAcronym,
} from '../normalise.ts';

// Words too common in venue names to identify one.
const VENUE_FILLER = new Set([
  'conference', 'international', 'symposium', 'workshop', 'journal', 'proceedings', 'transactions',
  'society', 'association', 'advanced', 'advances', 'global', 'world', 'recent', 'trends', 'emerging',
]);

export function significantWords(venueName: string): string[] {
  const words = normaliseTitle(baseVenueName(venueName)).split(' ');
  return [...new Set(words.filter((w) => w.length > 3 && !VENUE_FILLER.has(w)))];
}

/** Text refers to this venue: its acronym as a word, or at least 60% of its distinctive words. */
export function mentionsVenue(text: string, venueName: string): boolean {
  const acronym = venueAcronym(venueName);
  if (acronym && mentionsWord(text, acronym)) return true;
  const words = significantWords(venueName);
  if (words.length < 2) return false;
  const hay = ` ${normaliseTitle(text)} `;
  const present = words.filter((w) => hay.includes(` ${w} `)).length;
  return present / words.length >= 0.6;
}

export function lineMentioningVenue(text: string, venueName: string): string | null {
  const line = text.split(/\r?\n/).find((l) => l.trim() && mentionsVenue(l, venueName));
  return line ? truncate(line) : null;
}

/** A clickable search a judge can repeat. Anakin search results have no public URL. */
export function webSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Profiles and aggregators: useful elsewhere, but not the person's institutional page.
const AGGREGATORS = new Set([
  'linkedin.com', 'researchgate.net', 'google.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'wikipedia.org', 'academia.edu', 'orcid.org', 'semanticscholar.org', 'dblp.org',
  'scopus.com', 'ratemyprofessors.com', 'zoominfo.com', 'rocketreach.co', 'muckrack.com',
]);

const AFFILIATION_FILLER = new Set([
  'university', 'institute', 'college', 'technology', 'school', 'department', 'national', 'research',
  'sciences', 'science', 'center', 'centre', 'faculty', 'state', 'polytechnic', 'academy', 'royal',
  'technical', 'applied',
]);

/** Words that identify an affiliation: "KTH Royal Institute of Technology" -> kth; "IIT Bombay" -> iit, bombay. */
function affiliationWords(affiliation: string): { words: string[]; acronyms: string[] } {
  const acronyms = (affiliation.match(/\b[A-Z]{2,6}\b/g) ?? []).map((a) => a.toLowerCase());
  const words = normaliseTitle(affiliation)
    .split(' ')
    .filter((w) => w.length >= 4 && !AFFILIATION_FILLER.has(w));
  return { words, acronyms };
}

export type WebHit = { url: string; title: string; snippet: string };

/**
 * The hit is at the stated affiliation: its domain is named after it, or its own title/snippet names it.
 * An academic domain alone is not enough; a same-name academic elsewhere is a different person.
 */
export function isAtAffiliation(hit: WebHit, affiliation: string | null): boolean {
  const domain = registrableDomain(hit.url);
  if (!domain || !affiliation || AGGREGATORS.has(domain)) return false;
  const { words, acronyms } = affiliationWords(affiliation);
  const label = domain.split('.')[0];
  if (words.some((w) => label.includes(w)) || acronyms.some((a) => label.startsWith(a))) return true;
  const text = `${hit.title} ${hit.snippet}`;
  return [...words, ...acronyms].some((w) => mentionsWord(text, w));
}

/**
 * A hit at the stated affiliation naming someone with the same given name directly followed by a
 * near-identical surname ("Anna Bergman" for "Anna Berg"). Ambiguous, so not a denial.
 */
export function nearNameAtAffiliation(
  hits: WebHit[],
  personName: string,
  affiliation: string | null,
): { hit: WebHit; matched: string } | null {
  const given = stripDiacritics(plainName(personName).split(/\s+/)[0] ?? '').toLowerCase();
  const surname = stripDiacritics(surnameOf(personName) ?? '').toLowerCase();
  if (!given || !surname || given === surname) return null;

  for (const hit of hits) {
    if (!isAtAffiliation(hit, affiliation)) continue;
    const words = stripDiacritics(`${hit.title} ${hit.snippet}`).split(/[^\p{L}'-]+/u).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].toLowerCase() !== given) continue;
      const candidate = words[i + 1].toLowerCase();
      if (candidate.length < 3 || candidate === surname) continue;
      const allowed = Math.max(candidate.length, surname.length) >= 6 ? 2 : 1;
      if (candidate.startsWith(surname) || surname.startsWith(candidate) || editDistance(candidate, surname) <= allowed) {
        return { hit, matched: `${words[i]} ${words[i + 1]}` };
      }
    }
  }
  return null;
}

const CREDIBLE_DOMAINS = new Set([
  'retractionwatch.com', 'beallslist.net', 'predatoryjournals.org', 'predatoryjournals.com', 'cabells.com',
  'thinkchecksubmit.org', 'thinkcheckattend.org', 'scholarlyoa.com', 'timeshighereducation.com',
  'insidehighered.com', 'chronicle.com', 'nature.com', 'science.org', 'ugc.gov.in', 'ugc.ac.in',
]);

/** Library guides, universities, research-integrity watchdogs and serious academic press. */
export function isCredibleSource(url: string): boolean {
  const domain = registrableDomain(url);
  if (!domain) return false;
  if (CREDIBLE_DOMAINS.has(domain) || isAcademicDomain(domain)) return true;
  return /(^|\.)(libguides|library|lib)\./i.test(hostOf(url));
}

export const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s"'<>()[\]]+/g;

export function cleanDoi(doi: string): string {
  return doi.replace(/[.,;:]+$/, '');
}
