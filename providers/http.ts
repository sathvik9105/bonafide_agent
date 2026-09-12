// Cached JSON GET for the free registries.
import { cached } from './cache.ts';

export type JsonResponse = { status: number; body: unknown };

const TIMEOUT_MS = 15_000;

function userAgent(): string {
  const mailto = process.env.CROSSREF_MAILTO;
  return `BonaFide/0.1 (academic invitation verifier${mailto ? `; mailto:${mailto}` : ''})`;
}

/** GET a JSON URL through the disk cache. 2xx and 404 are cached; anything else throws. */
export async function getJson(url: string): Promise<JsonResponse> {
  return cached(url, async () => {
    const host = new URL(url).host;
    const res = await fetch(url, {
      headers: { Accept: 'application/json, application/rdap+json', 'User-Agent': userAgent() },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as unknown };
    } catch {
      throw new Error(`non-JSON response from ${host}`);
    }
  });
}
