// Shared, deterministic helpers for the Stage 2 web checks.
import {
  baseVenueName,
  isAcademicDomain,
  mentionsWord,
  normaliseTitle,
  registrableDomain,
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
  'sciences', 'science', 'center', 'centre', 'faculty', 'state', 'polytechnic', 'academy',
]);

/** URL looks like a page at the stated affiliation: an academic domain, or one named after it. */
export function isInstitutionalFor(url: string, affiliation: string | null): boolean {
  const domain = registrableDomain(url);
  if (!domain || AGGREGATORS.has(domain)) return false;
  if (isAcademicDomain(domain)) return true;
  if (!affiliation) return false;
  const label = domain.split('.')[0];
  return normaliseTitle(affiliation)
    .split(' ')
    .filter((w) => w.length >= 4 && !AFFILIATION_FILLER.has(w))
    .some((w) => label.includes(w));
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
