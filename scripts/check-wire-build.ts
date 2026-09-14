// Poll a Wire build request filed by scripts/file-wire-build.ts.
// Verified live 2026-09-14: no single get-by-id endpoint exists; GET /v1/wire/build-requests
// returns { build_requests: [...], pagination, status } and must be filtered client-side by id.
// Run: node --env-file=.env scripts/check-wire-build.ts <buildId>
const base = (process.env.ANAKIN_BASE_URL ?? '').replace(/\/$/, '');
const apiKey = process.env.ANAKIN_API_KEY ?? '';
if (!base || !apiKey) throw new Error('ANAKIN_BASE_URL and ANAKIN_API_KEY must be set');

type BuildRequest = {
  id: string;
  status: string;
  credits_charged?: number;
  action_id?: string | null;
  error?: string | null;
};
type ListResponse = { build_requests: BuildRequest[]; pagination?: { limit: number; page: number; total: number } };

async function fetchPage(page: number): Promise<ListResponse> {
  const res = await fetch(`${base}/v1/wire/build-requests?page=${page}`, { headers: { 'X-API-Key': apiKey } });
  if (res.status !== 200) throw new Error(`GET /v1/wire/build-requests failed: HTTP ${res.status}`);
  return (await res.json()) as ListResponse;
}

async function findBuild(id: string): Promise<BuildRequest | null> {
  for (let page = 1; page <= 20; page++) {
    const { build_requests, pagination } = await fetchPage(page);
    const hit = build_requests.find((b) => b.id === id);
    if (hit) return hit;
    if (!pagination || page * pagination.limit >= pagination.total) break;
  }
  return null;
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.log('Usage: node --env-file=.env scripts/check-wire-build.ts <buildId>');
    process.exit(1);
  }

  const build = await findBuild(id);
  if (!build) {
    console.log(`No build request with id ${id} found in the account's build-requests list.`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(build, null, 2));
  if (build.status === 'success') {
    console.log(`\nBuild succeeded. action_id: ${build.action_id}`);
    console.log('Run it via wire_discover / wire_read_action (or POST /v1/wire/task), not this script.');
  } else if (build.status === 'failed') {
    console.log(`\nBuild failed: ${build.error ?? '(no error message returned)'}`);
    console.log('Credits should have been refunded automatically per the docs.');
  } else {
    console.log(`\nStill ${build.status}. Wire builds can take a while; re-run this script later.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
