export type Severity = 'fatal' | 'major' | 'minor' | 'info';
export type FindingVerdict = 'supported' | 'contradicted' | 'unverifiable';

export type Finding = {
  id: string; // 'indexing.scopus'
  label: string; // 'Scopus indexing claim'
  claim: string; // what the venue asserts
  verdict: FindingVerdict;
  severity: Severity;
  sourceUrl: string | null; // judge clicks this
  excerpt: string | null; // exact text that decided it
  note: string; // one sentence
  costCredits: number; // 0 for free checks
};

export type Person = { name: string; affiliation: string | null; role: string; email: string | null };

export type Claims = {
  venueName: string;
  venueType: 'journal' | 'conference' | 'unknown';
  venueUrl: string | null;
  issn: string | null;
  claimedIndexing: string[]; // ['scopus','wos','doaj','ugc-care']
  feeAmount: number | null;
  feeCurrency: string | null;
  deadlines: string[]; // verbatim phrases, e.g. 'Final extension: 20 September 2026'
  eventDate: string | null; // ISO start date; needed by timeline.plausibility
  promisedTurnaroundDays: number | null;
  people: Person[];
  contactEmail: string | null;
  publisher: string | null;
};

export type CaseVerdict = 'RED' | 'AMBER' | 'GREEN';
export type CaseStatus = 'running' | 'complete' | 'awaiting_reply';

export type Case = {
  id: string;
  createdAt: number;
  rawInput: string;
  claims: Claims | null;
  findings: Finding[] | null;
  verdict: CaseVerdict | null;
  narrative: string | null;
  status: CaseStatus;
};

export type ReplyClass = 'CONFIRMS' | 'DENIES' | 'UNAWARE' | 'UNCLEAR';
export type OutreachKind = 'speaker' | 'disposition';

export type Outreach = {
  id: string; // 6 hex chars; speaker emails carry it in the subject as [BF-<id>]
  caseId: string;
  kind: OutreachKind;
  toEmail: string; // '' when the invitation gave no address
  personName: string;
  subject: string;
  body: string;
  sentAt: number | null; // null = draft only (dry run, or not sendable)
  replyBody: string | null;
  replyClass: ReplyClass | null;
  replyAt: number | null;
};

export type CheckContext = {
  claims: Claims;
  rawText: string; // original invitation, for literal excerpts
  now: Date; // injectable so date checks reproduce against fixtures
};

export type Check = {
  id: string;
  stage: 1 | 2;
  appliesTo: (c: Claims) => boolean;
  run: (ctx: CheckContext) => Promise<Finding[]>;
};
