// Deterministic orchestrator: extract claims → plan checks → run stages → score → persist.
// The LLM only extracts claims here. The verdict comes from core/scoring.ts.
import { extractClaims } from '../providers/llm.ts';
import { createCase, getCase, updateCase } from '../store/db.ts';
import { checks as registry } from './checks/index.ts';
import { truncate } from './normalise.ts';
import { capMajorsPerCheck, score } from './scoring.ts';
import type { Case, Check, CheckContext, Claims, Finding } from './types.ts';

export type PlanEntry = { id: string; stage: 1 | 2; scheduled: boolean };
export type Plan = { claimCount: number; scheduledCount: number; entries: PlanEntry[] };
export type VerifyResult = { case: Case; plan: Plan | null };

/** How many substantive claims the invitation made (name and type are always present). */
export function countClaims(c: Claims): number {
  const present = [
    c.venueUrl !== null,
    c.issn !== null,
    c.claimedIndexing.length > 0,
    c.feeAmount !== null,
    c.deadlines.length > 0,
    c.eventDate !== null,
    c.promisedTurnaroundDays !== null,
    c.people.length > 0,
    c.contactEmail !== null,
    c.publisher !== null,
  ];
  return present.filter(Boolean).length;
}

/** The claims decide which checks run. */
export function planChecks(claims: Claims, checks: Check[] = registry): Plan {
  const entries = checks.map((check) => {
    let scheduled = false;
    try {
      scheduled = check.appliesTo(claims);
    } catch {
      scheduled = false;
    }
    return { id: check.id, stage: check.stage, scheduled };
  });
  return {
    claimCount: countClaims(claims),
    scheduledCount: entries.filter((e) => e.scheduled).length,
    entries,
  };
}

function crashFinding(check: Check, reason: unknown): Finding {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    id: check.id,
    label: check.id,
    claim: '',
    verdict: 'unverifiable',
    severity: 'info',
    sourceUrl: null,
    excerpt: null,
    note: `The check failed unexpectedly: ${truncate(message, 160)}.`,
    costCredits: 0,
  };
}

async function runStage(scheduled: Check[], ctx: CheckContext): Promise<Finding[]> {
  const settled = await Promise.allSettled(scheduled.map((check) => check.run(ctx)));
  return settled.flatMap((r, i) => (r.status === 'fulfilled' ? r.value : [crashFinding(scheduled[i], r.reason)]));
}

export async function verifyInvitation(rawInput: string, opts: { now?: Date } = {}): Promise<VerifyResult> {
  const now = opts.now ?? new Date();
  const created = createCase(rawInput);

  let claims: Claims;
  try {
    claims = await extractClaims(rawInput);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const findings: Finding[] = [
      {
        id: 'extract.claims',
        label: 'Claim extraction',
        claim: '',
        verdict: 'unverifiable',
        severity: 'info',
        sourceUrl: null,
        excerpt: null,
        note: `The invitation's claims could not be extracted, so no checks ran: ${truncate(message, 160)}.`,
        costCredits: 0,
      },
    ];
    updateCase(created.id, { findings, verdict: score(findings), status: 'complete' });
    return { case: getCase(created.id) ?? created, plan: null };
  }
  updateCase(created.id, { claims });

  const plan = planChecks(claims);
  const scheduledIds = new Set(plan.entries.filter((e) => e.scheduled).map((e) => e.id));
  const ctx: CheckContext = { claims, rawText: rawInput, now };

  const findings: Finding[] = [];
  for (const stage of [1, 2] as const) {
    const scheduled = registry.filter((check) => check.stage === stage && scheduledIds.has(check.id));
    findings.push(...(await runStage(scheduled, ctx)));
  }

  const capped = capMajorsPerCheck(findings);
  updateCase(created.id, { findings: capped, verdict: score(capped), status: 'complete' });
  return { case: getCase(created.id) ?? created, plan };
}
