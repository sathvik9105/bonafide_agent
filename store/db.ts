// SQLite store. One file, schema applied on open (every statement is IF NOT EXISTS).
import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Case,
  CaseStatus,
  CaseVerdict,
  Claims,
  Finding,
  Outreach,
  OutreachKind,
  ReplyClass,
} from '../core/types.ts';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(process.env.DB_PATH || path.join(process.cwd(), 'bonafide.db'));
    db.pragma('journal_mode = WAL');
    db.exec(readFileSync(path.join(process.cwd(), 'store', 'schema.sql'), 'utf8'));
    // Databases created before outreach.kind existed.
    const columns = db.prepare('PRAGMA table_info(outreach)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'kind')) {
      db.exec("ALTER TABLE outreach ADD COLUMN kind TEXT NOT NULL DEFAULT 'speaker'");
    }
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

type OutreachRow = {
  id: string;
  case_id: string;
  kind: string;
  to_email: string;
  person_name: string;
  subject: string;
  body: string;
  sent_at: number | null;
  reply_body: string | null;
  reply_class: string | null;
  reply_at: number | null;
};

function toOutreach(r: OutreachRow): Outreach {
  return {
    id: r.id,
    caseId: r.case_id,
    kind: r.kind as OutreachKind,
    toEmail: r.to_email,
    personName: r.person_name,
    subject: r.subject,
    body: r.body,
    sentAt: r.sent_at,
    replyBody: r.reply_body,
    replyClass: r.reply_class as ReplyClass | null,
    replyAt: r.reply_at,
  };
}

/** Short unique id; speaker emails carry it in the subject as [BF-<id>]. */
export function newOutreachId(): string {
  const exists = getDb().prepare('SELECT 1 FROM outreach WHERE id = ?');
  for (;;) {
    const id = randomBytes(3).toString('hex');
    if (!exists.get(id)) return id;
  }
}

export type NewOutreach = Pick<Outreach, 'id' | 'caseId' | 'kind' | 'toEmail' | 'personName' | 'subject' | 'body'>;

export function createOutreach(o: NewOutreach): Outreach {
  getDb()
    .prepare(
      `INSERT INTO outreach (id, case_id, kind, to_email, person_name, subject, body)
       VALUES (@id, @caseId, @kind, @toEmail, @personName, @subject, @body)`,
    )
    .run(o);
  return { ...o, sentAt: null, replyBody: null, replyClass: null, replyAt: null };
}

export function markOutreachSent(id: string, at: number): void {
  getDb().prepare('UPDATE outreach SET sent_at = ? WHERE id = ?').run(at, id);
}

export function recordOutreachReply(id: string, reply: { body: string; replyClass: ReplyClass; at: number }): void {
  getDb()
    .prepare('UPDATE outreach SET reply_body = ?, reply_class = ?, reply_at = ? WHERE id = ?')
    .run(reply.body, reply.replyClass, reply.at, id);
}

export function getOutreach(id: string): Outreach | null {
  const row = getDb().prepare('SELECT * FROM outreach WHERE id = ?').get(id) as OutreachRow | undefined;
  return row ? toOutreach(row) : null;
}

export function listOutreach(caseId: string): Outreach[] {
  const rows = getDb().prepare('SELECT * FROM outreach WHERE case_id = ? ORDER BY rowid').all(caseId) as OutreachRow[];
  return rows.map(toOutreach);
}

/** Speaker emails that were actually sent and have no reply yet. */
export function listAwaitingReplies(): Outreach[] {
  const rows = getDb()
    .prepare("SELECT * FROM outreach WHERE kind = 'speaker' AND sent_at IS NOT NULL AND reply_at IS NULL ORDER BY rowid")
    .all() as OutreachRow[];
  return rows.map(toOutreach);
}
