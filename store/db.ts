// SQLite store. One file, schema applied on open (every statement is IF NOT EXISTS).
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Case, CaseStatus, CaseVerdict, Claims, Finding } from '../core/types.ts';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(process.env.DB_PATH || path.join(process.cwd(), 'bonafide.db'));
    db.pragma('journal_mode = WAL');
    db.exec(readFileSync(path.join(process.cwd(), 'store', 'schema.sql'), 'utf8'));
  }
  return db;
}

type CaseRow = {
  id: string;
  created_at: number;
  raw_input: string;
  claims_json: string | null;
  findings_json: string | null;
  verdict: string | null;
  narrative: string | null;
  status: string;
};

function toCase(r: CaseRow): Case {
  return {
    id: r.id,
    createdAt: r.created_at,
    rawInput: r.raw_input,
    claims: r.claims_json ? (JSON.parse(r.claims_json) as Claims) : null,
    findings: r.findings_json ? (JSON.parse(r.findings_json) as Finding[]) : null,
    verdict: r.verdict as CaseVerdict | null,
    narrative: r.narrative,
    status: r.status as CaseStatus,
  };
}

export function createCase(rawInput: string): Case {
  const c: Case = {
    id: randomUUID(),
    createdAt: Date.now(),
    rawInput,
    claims: null,
    findings: null,
    verdict: null,
    narrative: null,
    status: 'running',
  };
  getDb()
    .prepare('INSERT INTO cases (id, created_at, raw_input, status) VALUES (?, ?, ?, ?)')
    .run(c.id, c.createdAt, c.rawInput, c.status);
  return c;
}

export function getCase(id: string): Case | null {
  const row = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined;
  return row ? toCase(row) : null;
}

export type CasePatch = Partial<Pick<Case, 'claims' | 'findings' | 'verdict' | 'narrative' | 'status'>>;

export function updateCase(id: string, patch: CasePatch): void {
  const sets: string[] = [];
  const params: Record<string, string | null> = { id };
  if ('claims' in patch) {
    sets.push('claims_json = @claims');
    params.claims = patch.claims ? JSON.stringify(patch.claims) : null;
  }
  if ('findings' in patch) {
    sets.push('findings_json = @findings');
    params.findings = patch.findings ? JSON.stringify(patch.findings) : null;
  }
  if ('verdict' in patch) {
    sets.push('verdict = @verdict');
    params.verdict = patch.verdict ?? null;
  }
  if ('narrative' in patch) {
    sets.push('narrative = @narrative');
    params.narrative = patch.narrative ?? null;
  }
  if ('status' in patch && patch.status) {
    sets.push('status = @status');
    params.status = patch.status;
  }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = @id`).run(params);
}
