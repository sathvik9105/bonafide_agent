// Pure helpers shared by providers and checks: titles, ISSNs, domains, dates. No I/O.

export const DAY_MS = 86_400_000;

export function truncate(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function normaliseTitle(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Title without parenthetical qualifiers: "Sustainability (Switzerland)" -> "sustainability". */
export function normaliseTitleCore(s: string): string {
  return normaliseTitle(s.replace(/\([^)]*\)/g, ' '));
}

/** Word-level Jaccard similarity of two normalised titles. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  let overlap = 0;
  for (const w of A) if (B.has(w)) overlap++;
  const union = A.size + B.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

/** 8-character ISSN without hyphen, or null if the input isn't ISSN-shaped. */
export function normaliseIssn(s: string | null | undefined): string | null {
  if (!s) return null;
  const compact = s.replace(/[^0-9xX]/g, '').toUpperCase();
  return /^\d{7}[\dX]$/.test(compact) ? compact : null;
}

export function formatIssn(normalised: string): string {
  return `${normalised.slice(0, 4)}-${normalised.slice(4)}`;
}

// Suffixes under which registrations happen one level deeper (example.ac.uk).
const TWO_PART_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'org.uk', 'gov.uk', 'ac.in', 'co.in', 'edu.in', 'res.in', 'ernet.in', 'org.in',
  'gov.in', 'ac.jp', 'co.jp', 'ac.kr', 'co.kr', 'ac.nz', 'co.nz', 'ac.za', 'co.za', 'ac.id', 'ac.ir',
  'ac.th', 'ac.ae', 'ac.il', 'co.il', 'edu.au', 'com.au', 'org.au', 'edu.cn', 'com.cn', 'org.cn',
  'edu.pk', 'com.pk', 'edu.my', 'com.my', 'edu.sg', 'com.sg', 'edu.br', 'com.br', 'edu.tr', 'com.tr',
  'edu.ng', 'com.ng', 'edu.eg', 'edu.sa', 'com.sa', 'edu.vn', 'edu.ph', 'com.ph', 'edu.mx', 'com.mx',
]);

export function hostnameOf(urlOrHost: string): string | null {
  const s = urlOrHost.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

export function registrableDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  const host = hostnameOf(urlOrHost);
  if (!host) return null;
  if (/^\d+(\.\d+){3}$/.test(host)) return host;
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3 && TWO_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export function emailDomain(email: string | null | undefined): string | null {
  const m = email?.trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com',
  'icloud.com', 'me.com', '163.com', '126.com', 'qq.com', 'sina.com', 'yeah.net', 'foxmail.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'protonmail.com', 'proton.me', 'zoho.com', 'gmx.com',
  'gmx.de', 'rediffmail.com',
]);
// Brands whose free mail spans country domains (yahoo.co.in, hotmail.fr).
const FREE_MAIL_BRANDS = new Set(['yahoo', 'hotmail', 'outlook', 'aol', 'gmx', 'yandex', 'rediffmail']);

/** The registrable domain if it belongs to a free mailbox provider, else null. */
export function freeMailProvider(domain: string): string | null {
  const reg = registrableDomain(domain);
  if (!reg) return null;
  if (FREE_MAIL_DOMAINS.has(reg) || FREE_MAIL_BRANDS.has(reg.split('.')[0])) return reg;
  return null;
}

export function isAcademicDomain(domain: string): boolean {
  return /(^|\.)edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(domain.toLowerCase());
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function utcDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/**
 * Deterministic parser for the date shapes invitations use: 2026-09-20, 20 September 2026,
 * 24-25 October 2026 (first day), September 20, 2026. Returns UTC midnight or null.
 */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return utcDate(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = s.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/,
  );
  if (dmy && monthIndex(dmy[2]) >= 0) return utcDate(+dmy[3], monthIndex(dmy[2]), +dmy[1]);
  const mdy = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?,?\s+(\d{4})\b/);
  if (mdy && monthIndex(mdy[1]) >= 0) return utcDate(+mdy[3], monthIndex(mdy[1]), +mdy[2]);
  return null;
}

const HONORIFIC = /^(prof|professor|dr|mr|mrs|ms|mx|sir|assoc|asst)\.?$/i;

/** Name without titles: "Prof. Jane Example" -> "Jane Example". */
export function plainName(name: string): string {
  return name
    .split(/\s+/)
    .filter((t) => t && !HONORIFIC.test(t))
    .join(' ')
    .replace(/,$/, '')
    .trim();
}

export function surnameOf(name: string): string | null {
  const tokens = stripDiacritics(plainName(name))
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^\p{L}'-]/gu, ''))
    .filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1] : null;
}

/** Whole-word, case- and accent-insensitive match. */
export function mentionsWord(text: string, word: string): boolean {
  const escaped = stripDiacritics(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(stripDiacritics(text));
}

export function editionNumber(venueName: string): number | null {
  const m = venueName.match(/\b(\d{1,3})(?:st|nd|rd|th)\b/i);
  return m ? Number(m[1]) : null;
}

// Umbrella acronyms that don't identify one venue.
const UMBRELLA_ACRONYMS = new Set(['IEEE', 'ACM', 'IFIP', 'IET', 'SPIE', 'AAAI', 'USENIX']);

/** "ICACES" from "... (ICACES-2026)"; otherwise a distinctive all-caps token in the name. */
export function venueAcronym(venueName: string): string | null {
  const pick = (s: string) =>
    s
      .split(/[^A-Za-z&]+/)
      .find((t) => /^[A-Z][A-Z&]{2,11}$/.test(t) && !UMBRELLA_ACRONYMS.has(t)) ?? null;
  for (const m of venueName.matchAll(/\(([^)]*)\)/g)) {
    const found = pick(m[1]);
    if (found) return found;
  }
  return pick(venueName.replace(/\([^)]*\)/g, ' '));
}

/** Venue name without edition, year, "annual" or parentheticals, for searching across years. */
export function baseVenueName(venueName: string): string {
  return venueName
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d{1,3}(st|nd|rd|th)\b/gi, ' ')
    .replace(/\bannual\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/['’]\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/i, '');
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
