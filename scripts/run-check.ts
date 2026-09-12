// Run Stage 1 checks against a fixture, individually, without the orchestrator.
// Usage:
//   node --no-warnings --env-file=.env scripts/run-check.ts <fixture> [checkId ...] [--now YYYY-MM-DD] [--no-cache]
// Examples:
//   node --no-warnings --env-file=.env scripts/run-check.ts fixtures/hijacked-1.txt identity.url_match
//   node --no-warnings --env-file=.env scripts/run-check.ts fixtures/predatory-1.txt --now 2026-09-13
import { readFileSync } from 'node:fs';
import { checks } from '../core/checks/index.ts';
import type { Check, CheckContext, Finding } from '../core/types.ts';
import { setCacheEnabled } from '../providers/cache.ts';
import { extractClaims } from '../providers/llm.ts';

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let now = new Date();
  let noCache = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-cache') noCache = true;
    else if (arg === '--now') {
      now = new Date(`${argv[++i]}T00:00:00Z`);
      if (Number.isNaN(now.getTime())) throw new Error('--now expects YYYY-MM-DD');
    } else positional.push(arg);
  }
  const [fixture, ...ids] = positional;
  return { fixture, ids, now, noCache };
}

const MARK = { supported: '✔', contradicted: '✘', unverifiable: '?' } as const;

function printFinding(f: Finding) {
  console.log(`  ${MARK[f.verdict]} ${f.verdict.toUpperCase()} [${f.severity}] ${f.label}`);
  console.log(`      claim:   ${f.claim}`);
  console.log(`      excerpt: ${f.excerpt ?? '(none)'}`);
  console.log(`      source:  ${f.sourceUrl ?? '(none)'}`);
  console.log(`      note:    ${f.note}`);
}

async function runCheck(check: Check, ctx: CheckContext): Promise<Finding[]> {
  if (!check.appliesTo(ctx.claims)) {
    console.log(`\n■ ${check.id}: not scheduled (appliesTo = false)`);
    return [];
  }
  const t0 = Date.now();
  try {
    const findings = await check.run(ctx);
    console.log(`\n■ ${check.id}: ${findings.length} finding(s) in ${Date.now() - t0}ms`);
    findings.forEach(printFinding);
    return findings;
  } catch (e) {
    // Checks must never throw. If this prints, the check has a bug.
    console.log(`\n■ ${check.id}: THREW (bug) ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return [];
  }
}

async function main() {
  const { fixture, ids, now, noCache } = parseArgs(process.argv.slice(2));
  const known = checks.map((c) => c.id).join(', ');
  if (!fixture) {
    console.log(`Usage: scripts/run-check.ts <fixture> [checkId ...] [--now YYYY-MM-DD] [--no-cache]\nChecks: ${known}`);
    process.exit(1);
  }
  const unknown = ids.filter((id) => !checks.some((c) => c.id === id));
  if (unknown.length) {
    console.log(`Unknown check id(s): ${unknown.join(', ')}\nChecks: ${known}`);
    process.exit(1);
  }
  setCacheEnabled(!noCache);

  const rawText = readFileSync(fixture, 'utf8');
  const t0 = Date.now();
  const claims = await extractClaims(rawText);
  console.log(`Fixture: ${fixture}   now: ${now.toISOString().slice(0, 10)}   cache: ${noCache ? 'off' : 'on'}`);
  console.log(`Claims (${Date.now() - t0}ms):\n${JSON.stringify(claims, null, 2)}`);

  const selected = ids.length ? checks.filter((c) => ids.includes(c.id)) : checks;
  const ctx: CheckContext = { claims, rawText, now };
  const all: Finding[] = [];
  for (const check of selected) all.push(...(await runCheck(check, ctx)));

  const count = (pred: (f: Finding) => boolean) => all.filter(pred).length;
  const contradicted = (sev: string) => count((f) => f.verdict === 'contradicted' && f.severity === sev);
  console.log(
    `\nSummary: ${count((f) => f.verdict === 'supported')} supported, ` +
      `${count((f) => f.verdict === 'contradicted')} contradicted ` +
      `(fatal ${contradicted('fatal')}, major ${contradicted('major')}, minor ${contradicted('minor')}), ` +
      `${count((f) => f.verdict === 'unverifiable')} unverifiable`,
  );
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
