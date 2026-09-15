// One-off: request a Wire build for the Retraction Watch Hijacked Journal Checker.
// Verified live 2026-09-14: POST /v1/wire/build-request, body {website_url, goal, visibility},
// 201 Created, response wraps the job in `build_request: { id, status, credits_charged, action_id }`.
// Run: node --env-file=.env scripts/file-wire-build.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = (process.env.ANAKIN_BASE_URL ?? '').replace(/\/$/, '');
const apiKey = process.env.ANAKIN_API_KEY ?? '';
if (!base || !apiKey) throw new Error('ANAKIN_BASE_URL and ANAKIN_API_KEY must be set');

const payload = {
  website_url: 'https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/',
  visibility: 'public',
  goal:
    'Given a journal title or ISSN, return whether it appears on the Retraction Watch Hijacked Journal ' +
    "Checker list, and if so return the legitimate journal's official title, ISSN and homepage URL " +
    'alongside the hijacked clone’s URL.',
};

type BuildRequest = { id: string; status: string; credits_charged?: number; action_id?: string | null };

async function main() {
  // Idempotency guard: re-running this script must not file a second build and spend credits twice.
  const cacheKey = createHash('sha256').update(`POST /v1/wire/build-request ${JSON.stringify(payload)}`).digest('hex');
  const cacheFile = `cache/${cacheKey}.json`;
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { build_request: BuildRequest };
    console.log('Already filed (cached), not re-submitting:');
    console.log(JSON.stringify(cached.build_request, null, 2));
    return;
  }

  const res = await fetch(`${base}/v1/wire/build-request`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (res.status !== 201 || typeof body !== 'object' || body === null || !('build_request' in body)) {
    console.error('\nBuild request did not return the expected shape. Not logging to docs/ENGINEERING_LOG.md.');
    process.exitCode = 1;
    return;
  }

  mkdirSync('cache', { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(body));

  const br = (body as { build_request: BuildRequest }).build_request;
  console.log(`\nBuild id:  ${br.id}`);
  console.log(`Status:    ${br.status}`);
  console.log(`Credits:   ${br.credits_charged ?? '(not reported)'}`);
  console.log(`\nPoll it with: node --env-file=.env scripts/check-wire-build.ts ${br.id}`);

  appendFileSync(
    'docs/ENGINEERING_LOG.md',
    `- **Wire build filed for Retraction Watch's Hijacked Journal Checker** (${new Date().toISOString().slice(0, 10)}): ` +
      `\`POST /v1/wire/build-request\` — id \`${br.id}\`, status \`${br.status}\`, ${br.credits_charged ?? '?'} credits charged. ` +
      `Poll with \`scripts/check-wire-build.ts ${br.id}\`.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
