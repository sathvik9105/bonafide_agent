CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  raw_input TEXT NOT NULL,
  claims_json TEXT,
  findings_json TEXT,
  verdict TEXT,
  narrative TEXT,
  status TEXT NOT NULL          -- running | complete | awaiting_reply
);

CREATE TABLE IF NOT EXISTS outreach (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  person_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER,
  reply_body TEXT,
  reply_class TEXT,             -- CONFIRMS | DENIES | UNAWARE | UNCLEAR
  reply_at INTEGER
);
