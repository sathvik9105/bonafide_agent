// Free registries: DOAJ, Crossref, RDAP and the Scopus source list CSV. Zero Anakin credits.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  formatIssn,
  normaliseIssn,
  normaliseTitle,
  normaliseTitleCore,
  wordSimilarity,
} from '../core/normalise.ts';
import { getJson } from './http.ts';

// ---------------------------------------------------------------- DOAJ

const DoajSearchSchema = z.object({
  total: z.number(),
  results: z.array(
    z.object({
      bibjson: z.object({
        title: z.string(),
        pissn: z.string().optional(),
        eissn: z.string().optional(),
        publisher: z.object({ name: z.string().optional() }).optional(),
        ref: z.object({ journal: z.string().optional() }).optional(),
      }),
    }),
  ),
});

export type DoajRecord = {
  title: string;
  pissn: string | null;
  eissn: string | null;
  publisher: string | null;
  homepage: string | null;
  sourceUrl: string;
};

export type DoajLookup = { record: DoajRecord | null; query: string; queryUrl: string };

/** Look up a journal by ISSN, else by exact normalised title (DOAJ's own title search is fuzzy). */
export async function doajLookup(q: { issn: string | null; title: string | null }): Promise<DoajLookup> {
  const issn = normaliseIssn(q.issn);
  // Strip Elasticsearch query-string syntax from the title.
  const title = q.title?.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim() || null;
  const query = issn ? `issn:${formatIssn(issn)}` : title ? `bibjson.title:"${title}"` : null;
  if (!query) return { record: null, query: '', queryUrl: '' };

  const queryUrl = `https://doaj.org/api/search/journals/${encodeURIComponent(query)}?pageSize=10`;
  const res = await getJson(queryUrl);
  if (res.status === 404) return { record: null, query, queryUrl };
  const parsed = DoajSearchSchema.parse(res.body);

  const wanted = q.title ? new Set([normaliseTitle(q.title), normaliseTitleCore(q.title)]) : new Set<string>();
  const hit = parsed.results.find(({ bibjson: b }) =>
    issn
      ? [b.pissn, b.eissn].some((x) => normaliseIssn(x) === issn)
      : wanted.has(normaliseTitle(b.title)) || wanted.has(normaliseTitleCore(b.title)),
  );
  if (!hit) return { record: null, query, queryUrl };

  const b = hit.bibjson;
  const tocIssn = b.eissn ?? b.pissn;
  return {
    query,
    queryUrl,
    record: {
      title: b.title,
      pissn: b.pissn ?? null,
      eissn: b.eissn ?? null,
      publisher: b.publisher?.name ?? null,
      homepage: b.ref?.journal ?? null,
      sourceUrl: tocIssn ? `https://doaj.org/toc/${tocIssn}` : queryUrl,
    },
  };
}

// ---------------------------------------------------------------- Scopus source list

const SCOPUS_CSV = path.join(process.cwd(), 'data', 'scopus-sources.csv');
export const SCOPUS_SEARCH_URL = 'https://www.scopus.com/sources';

export type ScopusRecord = {
  sourceId: string;
  title: string;
  issn: string | null;
  eissn: string | null;
  active: boolean;
  coverage: string;
  coverageEndYear: number | null;
  discontinuedNote: string | null;
  sourceType: string | null;
  publisher: string | null;
  publisherGroup: string | null;
};

type ScopusIndex = {
  byIssn: Map<string, ScopusRecord>;
  titles: { key: string; core: string; record: ScopusRecord }[];
};

let scopusIndex: Promise<ScopusIndex> | null = null;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function buildScopusIndex(): Promise<ScopusIndex> {
  const [header, ...rows] = parseCsv(await readFile(SCOPUS_CSV, 'utf8'));
  const col = (re: RegExp) => {
    const i = header.findIndex((h) => re.test(h.trim()));
    if (i < 0) throw new Error(`Scopus CSV has no column matching ${re}`);
    return i;
  };
  const c = {
    id: col(/^sourcerecord id$/i),
    title: col(/^source title$/i),
    issn: col(/^issn$/i),
    eissn: col(/^eissn$/i),
    status: col(/^active or inactive$/i),
    coverage: col(/^coverage$/i),
    discontinued: col(/^titles discontinued/i),
    type: col(/^source type$/i),
    publisher: col(/^publisher$/i),
    group: col(/^publisher imprints grouped/i),
  };
  // Excel can drop leading zeros from numeric-looking ISSNs.
  const issnOf = (v: string | undefined) => (v ? normaliseIssn(v.trim().padStart(8, '0')) : null);

  const byIssn = new Map<string, ScopusRecord>();
  const titles: ScopusIndex['titles'] = [];
  for (const r of rows) {
    const title = r[c.title]?.trim();
    if (!title) continue;
    const coverage = r[c.coverage]?.trim() ?? '';
    const years = [...coverage.matchAll(/\b(?:18|19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    const record: ScopusRecord = {
      sourceId: r[c.id]?.trim() ?? '',
      title,
      issn: issnOf(r[c.issn]),
      eissn: issnOf(r[c.eissn]),
      active: /^active$/i.test(r[c.status]?.trim() ?? ''),
      coverage,
      coverageEndYear: years.length ? Math.max(...years) : null,
      discontinuedNote: r[c.discontinued]?.trim() || null,
      sourceType: r[c.type]?.trim() || null,
      publisher: r[c.publisher]?.trim() || null,
      publisherGroup: r[c.group]?.trim() || null,
    };
    for (const issn of [record.issn, record.eissn]) {
      if (issn && !byIssn.has(issn)) byIssn.set(issn, record);
    }
    titles.push({ key: normaliseTitle(title), core: normaliseTitleCore(title), record });
  }
  return { byIssn, titles };
}

function loadScopus(): Promise<ScopusIndex> {
  scopusIndex ??= buildScopusIndex().catch((e) => {
    scopusIndex = null;
    throw e;
  });
  return scopusIndex;
}

export async function scopusByIssn(issn: string): Promise<ScopusRecord | null> {
  const n = normaliseIssn(issn);
  if (!n) return null;
  return (await loadScopus()).byIssn.get(n) ?? null;
}

/** Best title match by word-level similarity; the first source wins ties. */
export async function scopusByTitle(title: string): Promise<{ record: ScopusRecord; score: number } | null> {
  const { titles } = await loadScopus();
  const key = normaliseTitle(title);
  const core = normaliseTitleCore(title);
  let best: ScopusRecord | null = null;
  let score = 0;
  for (const t of titles) {
    const s = Math.max(wordSimilarity(key, t.key), wordSimilarity(core, t.core));
    if (s > score) {
      score = s;
      best = t.record;
      if (s === 1) break;
    }
  }
  return best ? { record: best, score } : null;
}

export function scopusSourceUrl(r: ScopusRecord): string {
  return r.sourceId ? `https://www.scopus.com/sourceid/${r.sourceId}` : SCOPUS_SEARCH_URL;
}

// ---------------------------------------------------------------- RDAP

const RdapSchema = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).optional(),
});

export type RdapRecord = { domain: string; registeredAt: string | null; sourceUrl: string };

/** Human-readable page for a domain's registration data. */
export function domainLookupUrl(domain: string): string {
  return `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`;
}

/** Registration data for a registrable domain, or null when RDAP has no record. */
export async function rdapDomain(domain: string): Promise<RdapRecord | null> {
  const res = await getJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (res.status === 404) return null;
  const parsed = RdapSchema.parse(res.body);
  const registeredAt = parsed.events?.find((e) => e.eventAction === 'registration')?.eventDate ?? null;
  return { domain, registeredAt, sourceUrl: domainLookupUrl(domain) };
}

// ---------------------------------------------------------------- Crossref

const CrossrefJournalSchema = z.object({
  message: z.object({ title: z.string(), publisher: z.string(), ISSN: z.array(z.string()).optional() }),
});

export type CrossrefJournal = { title: string; publisher: string; issns: string[]; sourceUrl: string };

export async function crossrefJournal(issn: string): Promise<CrossrefJournal | null> {
  const n = normaliseIssn(issn);
  if (!n) return null;
  const url = `https://api.crossref.org/journals/${formatIssn(n)}`;
  const res = await getJson(url);
  if (res.status === 404) return null;
  const { message: m } = CrossrefJournalSchema.parse(res.body);
  return { title: m.title, publisher: m.publisher, issns: m.ISSN ?? [], sourceUrl: url };
}

const CrossrefWorkSchema = z.object({
  message: z.object({
    DOI: z.string(),
    title: z.array(z.string()).optional(),
    publisher: z.string().optional(),
    'container-title': z.array(z.string()).optional(),
  }),
});

export type CrossrefWork = {
  doi: string;
  title: string | null;
  publisher: string | null;
  containerTitle: string | null;
  sourceUrl: string;
};

export async function crossrefWork(doi: string): Promise<CrossrefWork | null> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const res = await getJson(`https://api.crossref.org/works/${encodeURIComponent(clean)}`);
  if (res.status === 404) return null;
  const { message: m } = CrossrefWorkSchema.parse(res.body);
  return {
    doi: m.DOI,
    title: m.title?.[0] ?? null,
    publisher: m.publisher ?? null,
    containerTitle: m['container-title']?.[0] ?? null,
    sourceUrl: `https://doi.org/${m.DOI}`,
  };
}
