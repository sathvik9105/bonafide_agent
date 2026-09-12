// Phase 0 smoke test: one Anakin scrape of a known conference URL, one search call.
// Run: node --env-file=.env scripts/smoke-anakin.ts [--no-cache]
// Responses are cached in cache/<sha256>.json so re-runs spend zero credits.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SCRAPE_URL = 'https://neurips.cc/';
const SEARCH_PROMPT = '"NeurIPS 2025" conference proceedings';
const NO_CACHE = process.argv.includes('--no-cache');

const base = (process.env.ANAKIN_BASE_URL ?? '').replace(/\/$/, '');
const apiKey = process.env.ANAKIN_API_KEY ?? '';

type Call = { status: number; ms: number; body: unknown; creditHeaders: Record<string, string>; cached: boolean };

async function post(path: string, payload: unknown, cacheable: boolean): Promise<Call> {
  const key = createHash('sha256').update(`POST ${path} ${JSON.stringify(payload)}`).digest('hex');
  const file = `cache/${key}.json`;
  if (cacheable && !NO_CACHE && existsSync(file)) {
    return { ...(JSON.parse(readFileSync(file, 'utf8')) as Call), cached: true };
  }
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  const creditHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (/credit|ratelimit|quota|usage/i.test(k)) creditHeaders[k] = v;
  });
  const call: Call = { status: res.status, ms: Date.now() - t0, body, creditHeaders, cached: false };
  if (cacheable && res.status === 200) {
    mkdirSync('cache', { recursive: true });
    writeFileSync(file, JSON.stringify(call));
  }
  return call;
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { 'X-API-Key': apiKey } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function creditFields(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) if (/credit|cost|usage/i.test(k)) out[k] = v;
  }
  return out;
}

async function probePaths() {
  // Empty body: a real route should answer 400/422 (validation), a missing one 404. No scrape happens.
  for (const path of ['/v1/scrape', '/v1/url-scraper', '/v1/url-scraper/scrape']) {
    const r = await post(path, {}, false);
    console.log(`[probe] POST ${path} {} -> ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
}

async function smokeScrape(): Promise<boolean> {
  let r = await post('/v1/url-scraper/scrape', { url: SCRAPE_URL }, true);
  let body = r.body as any;
  if (r.status === 202 && body?.id) {
    console.log(`[scrape] 202 after ${r.ms}ms, polling job ${body.id}`);
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      await new Promise((res) => setTimeout(res, 3000));
      const p = await get(`/v1/url-scraper/${body.id}`);
      if (p.body?.status === 'completed' || p.body?.status === 'failed') {
        body = p.body;
        r = { ...r, status: p.status, ms: r.ms + (Date.now() - t0) };
        break;
      }
    }
  }
  const md: string = body?.markdown ?? '';
  const ok = r.status === 200 && body?.status === 'completed' && md.length > 0;
  console.log(
    `[scrape] ${ok ? 'PASS' : 'FAIL'} status=${r.status} jobStatus=${body?.status} ${r.ms}ms cached=${r.cached} ` +
      `markdown=${md.length} chars durationMs=${body?.durationMs}`,
  );
  console.log(`  credit headers: ${JSON.stringify(r.creditHeaders)} credit fields: ${JSON.stringify(creditFields(body))}`);
  if (!ok) console.log(`  body: ${JSON.stringify(body).slice(0, 400)}`);
  else console.log(`  markdown head: ${md.slice(0, 200).replace(/\n/g, ' ')}`);
  return ok;
}

async function smokeSearch(): Promise<boolean> {
  const r = await post('/v1/search', { prompt: SEARCH_PROMPT, limit: 3 }, true);
  const body = r.body as any;
  const results = Array.isArray(body?.results) ? body.results : [];
  const ok = r.status === 200 && results.length > 0;
  console.log(`[search] ${ok ? 'PASS' : 'FAIL'} status=${r.status} ${r.ms}ms cached=${r.cached} results=${results.length}`);
  console.log(`  credit headers: ${JSON.stringify(r.creditHeaders)} credit fields: ${JSON.stringify(creditFields(body))}`);
  if (!ok) console.log(`  body: ${JSON.stringify(body).slice(0, 400)}`);
  for (const x of results) console.log(`  - ${x.title} <${x.url}>`);
  return ok;
}

async function main() {
  if (!apiKey || !base) {
    console.log('FAIL ANAKIN_API_KEY and ANAKIN_BASE_URL must be set in .env');
    process.exit(1);
  }
  await probePaths();
  const s = await smokeScrape();
  const q = await smokeSearch();
  console.log(`\nRESULT: scrape ${s ? 'PASS' : 'FAIL'}, search ${q ? 'PASS' : 'FAIL'}`);
  process.exit(s && q ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
