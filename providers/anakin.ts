// Anakin via plain fetch (no SDK): inline URL scrape and web search.
// Every call goes through the disk cache and the run's credit ledger.
import { z } from 'zod';
import type { CreditLedger } from '../core/credits.ts';
import { readCache, writeCache } from './cache.ts';

// anakin.io/pricing (Sep 2026): scrape 1 credit, search 3. Failed requests and Anakin-side cache hits
// are free. The API reports no per-call usage, so these constants are the source of every credit figure.
export const SCRAPE_CREDITS = 1;
export const SEARCH_CREDITS = 3;

const REQUEST_TIMEOUT_MS = 100_000; // the inline scrape holds the connection for up to ~90s
const POLL_INTERVAL_MS = 3_000;
const POLL_LIMIT_MS = 120_000;

export type CallContext = { ledger: CreditLedger; checkId: string };

function config(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.ANAKIN_BASE_URL?.trim().replace(/\/$/, '');
  const apiKey = process.env.ANAKIN_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error('ANAKIN_BASE_URL and ANAKIN_API_KEY must be set');
  return { baseUrl, apiKey };
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const { baseUrl, apiKey } = config();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'X-API-Key': apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const ErrorSchema = z.object({ message: z.string().optional(), error: z.string().optional() });

function errorMessage(json: unknown, status: number): string {
  const parsed = ErrorSchema.safeParse(json);
  return (parsed.success && (parsed.data.message ?? parsed.data.error)) || `HTTP ${status}`;
}

const isTransient = (status: number) => status === 429 || status >= 500;

// ---------------------------------------------------------------- scrape

const ScrapeJobSchema = z.object({
  id: z.string().optional(),
  status: z.string(),
  markdown: z.string().nullable().optional(),
  cached: z.boolean().optional(),
  error: z.string().nullable().optional(),
});

export type ScrapedPage = { url: string; markdown: string };
export type ScrapeResult = { page: ScrapedPage | null; failure: string | null; credits: number; cached: boolean };
type StoredScrape = { page: ScrapedPage | null; failure: string | null };

async function waitForJob(id: string): Promise<{ status: number; json: unknown }> {
  const started = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const res = await call('GET', `/v1/url-scraper/${encodeURIComponent(id)}`);
    const status = ScrapeJobSchema.safeParse(res.json).data?.status;
    if (res.status !== 200 || status === 'completed' || status === 'failed') return res;
    if (Date.now() - started > POLL_LIMIT_MS) throw new Error(`scrape job ${id} did not finish within ${POLL_LIMIT_MS / 1000}s`);
  }
}

/**
 * Scrape one URL to markdown. A definitive failure returns page null, is cached, and costs nothing.
 * Transient errors (429, 5xx, timeouts) throw and are not cached.
 */
export async function scrape(url: string, ctx: CallContext): Promise<ScrapeResult> {
  const key = `anakin:scrape:${url}`;
  const stored = await readCache<StoredScrape>(key);
  if (stored) {
    ctx.ledger.record({ checkId: ctx.checkId, action: 'scrape', target: url, credits: 0, cached: true });
    return { ...stored, credits: 0, cached: true };
  }

  ctx.ledger.reserve(SCRAPE_CREDITS, `scraping ${url}`);
  let charged = 0;
  try {
    let res = await call('POST', '/v1/url-scraper/scrape', { url });
    if (res.status === 202) {
      const jobId = ScrapeJobSchema.safeParse(res.json).data?.id;
      if (!jobId) throw new Error('Anakin returned 202 without a job id');
      res = await waitForJob(jobId);
    }
    if (isTransient(res.status)) throw new Error(`Anakin scrape failed: ${errorMessage(res.json, res.status)}`);

    const job = ScrapeJobSchema.safeParse(res.json);
    let result: StoredScrape;
    if (res.status >= 400 || !job.success) {
      result = { page: null, failure: errorMessage(res.json, res.status) };
    } else if (job.data.status !== 'completed') {
      result = { page: null, failure: job.data.error ?? `scrape ${job.data.status}` };
    } else {
      charged = job.data.cached ? 0 : SCRAPE_CREDITS;
      const markdown = job.data.markdown?.trim() ?? '';
      result = markdown ? { page: { url, markdown }, failure: null } : { page: null, failure: 'the page had no readable content' };
    }
    await writeCache(key, result);
    return { ...result, credits: charged, cached: false };
  } finally {
    ctx.ledger.refund(SCRAPE_CREDITS - charged);
    ctx.ledger.record({ checkId: ctx.checkId, action: 'scrape', target: url, credits: charged, cached: false });
  }
}

// ---------------------------------------------------------------- search

const SearchSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable().optional(),
      snippet: z.string().nullable().optional(),
    }),
  ),
});

export type SearchHit = { url: string; title: string; snippet: string };
export type SearchResult = { hits: SearchHit[]; credits: number; cached: boolean };

export async function search(prompt: string, limit: number, ctx: CallContext): Promise<SearchResult> {
  const key = `anakin:search:${limit}:${prompt}`;
  const stored = await readCache<SearchHit[]>(key);
  if (stored) {
    ctx.ledger.record({ checkId: ctx.checkId, action: 'search', target: prompt, credits: 0, cached: true });
    return { hits: stored, credits: 0, cached: true };
  }

  ctx.ledger.reserve(SEARCH_CREDITS, `searching "${prompt}"`);
  let charged = 0;
  try {
    const res = await call('POST', '/v1/search', { prompt, limit });
    if (res.status !== 200) throw new Error(`Anakin search failed: ${errorMessage(res.json, res.status)}`);
    const hits = SearchSchema.parse(res.json).results.map((r) => ({
      url: r.url,
      title: r.title ?? '',
      snippet: r.snippet ?? '',
    }));
    charged = SEARCH_CREDITS;
    await writeCache(key, hits);
    return { hits, credits: charged, cached: false };
  } finally {
    ctx.ledger.refund(SEARCH_CREDITS - charged);
    ctx.ledger.record({ checkId: ctx.checkId, action: 'search', target: prompt, credits: charged, cached: false });
  }
}
