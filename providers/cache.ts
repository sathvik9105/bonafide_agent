// Disk cache for every network call: cache/<sha256(key)>.json, infinite TTL.
// For HTTP the key is the URL. USE_CACHE=0 (or setCacheEnabled(false)) skips reads but still
// writes, so a fresh demo run refreshes the cache.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = path.join(process.cwd(), 'cache');

let enabled = process.env.USE_CACHE !== '0';

export function setCacheEnabled(on: boolean): void {
  enabled = on;
}

export function cacheKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

type Entry<T> = { key: string; storedAt: string; value: T };

const fileFor = (key: string) => path.join(CACHE_DIR, `${cacheKey(key)}.json`);

/** The cached value for `key`, or undefined on a miss (or when reads are disabled). */
export async function readCache<T>(key: string): Promise<T | undefined> {
  if (!enabled) return undefined;
  try {
    return (JSON.parse(await readFile(fileFor(key), 'utf8')) as Entry<T>).value;
  } catch {
    return undefined;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry: Entry<T> = { key, storedAt: new Date().toISOString(), value };
  await writeFile(fileFor(key), JSON.stringify(entry));
}

/** Return the cached value for `key`, or produce, store and return it. Failures are not cached. */
export async function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const hit = await readCache<T>(key);
  if (hit !== undefined) return hit;
  const value = await produce();
  await writeCache(key, value);
  return value;
}
