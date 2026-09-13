# BonaFide — Implementation Plan

Build in phases. **Each phase ends with something that runs.** Do not start a phase
until the previous one is demoable. If time runs out, the cut order at the bottom is
already decided — follow it rather than improvising at 3am.

## Repository layout

```
bonafide/
  SPEC.md                       # per-check contracts — the source of truth for every check
  app/
    page.tsx                    # single screen: input → live feed → dossier
    case/[id]/page.tsx          # permalink to a stored case
    api/verify/route.ts         # POST, streams findings via SSE
    api/case/[id]/route.ts      # GET case state
    api/poll-replies/route.ts   # GET, triggers one IMAP sweep (the timer calls pollReplies directly)
    api/outreach/[id]/simulate-reply/route.ts  # POST, dry-mode stand-in for a real reply
  instrumentation.ts            # starts the 30s reply poller once per server process
  core/
    types.ts                    # Finding, Claims, Case, Verdict
    extract.ts                  # Stage 0 — claims from raw text
    orchestrator.ts             # plan → run stages → synthesize
    scoring.ts                  # the rule engine. NO LLM.
    normalise.ts                # pure helpers: titles, ISSNs, domains, dates
    publisher.ts                # deterministic publisher-name comparison
    credits.ts                  # per-run Anakin credit ledger (MAX_CREDITS_PER_RUN)
    narrate.ts                  # LLM writes the summary + disposition email
    callback.ts                 # speaker targeting, outreach, disposition, replies, poller
    checks/
      index.ts                  # registry of all checks
      finding.ts                # finding builder, guard(), quoteLine()
      web.ts                    # shared helpers for the Stage 2 web checks
      identity-url-match.ts
      indexing-scopus.ts
      indexing-doaj.ts
      domain-age.ts
      contact-domain.ts
      timeline-plausibility.ts
      people-reality.ts
      proceedings-exist.ts
      reports-prior.ts
  providers/
    anakin.ts                   # scrape + search, with disk cache
    registries.ts               # DOAJ, Crossref, RDAP, Scopus CSV
    llm.ts                      # extractClaims, assessSupport, classifyReply, write*
    mail.ts                     # send + IMAP poll
    cache.ts                    # sha256(url) → cache/*.json
    http.ts                     # cached JSON GET for the free registries
  store/
    db.ts
    schema.sql
  data/
    scopus-sources.csv          # downloaded once, committed
  scripts/
    smoke-mail.ts               # prove send+read works
    smoke-llm.ts                # prove structured JSON output works
    smoke-anakin.ts             # prove scrape + search work
    smoke-scopus.ts             # xlsx → CSV, prove ISSN + title lookup
    run-check.ts                # run one or all checks against a fixture
  cache/                        # gitignored
  fixtures/
    predatory-1.txt             # a real predatory invite (redact personal info)
    legit-1.txt                 # a real IEEE/ACM CFP
```

## Core types — write these first, in `core/types.ts`

```ts
export type Severity = 'fatal' | 'major' | 'minor' | 'info';
export type FindingVerdict = 'supported' | 'contradicted' | 'unverifiable';

export type Finding = {
  id: string;               // 'indexing.scopus'
  label: string;            // 'Scopus indexing claim'
  claim: string;            // what the venue asserts
  verdict: FindingVerdict;
  severity: Severity;
  sourceUrl: string | null; // judge clicks this
  excerpt: string | null;   // exact text that decided it
  note: string;             // one sentence, LLM-written
  costCredits: number;      // 0 for free checks
};

export type Claims = {
  venueName: string;
  venueType: 'journal' | 'conference' | 'unknown';
  venueUrl: string | null;
  issn: string | null;
  claimedIndexing: string[];      // ['scopus','wos','doaj','ugc-care']
  feeAmount: number | null;
  feeCurrency: string | null;
  deadlines: string[];            // verbatim phrases, e.g. 'Final extension: 20 September 2026'
  eventDate: string | null;       // ISO start date; needed by timeline.plausibility
  promisedTurnaroundDays: number | null;
  people: { name: string; affiliation: string | null; role: string }[];
  contactEmail: string | null;
  publisher: string | null;
};

export type CaseVerdict = 'RED' | 'AMBER' | 'GREEN';

export type CheckContext = {
  claims: Claims;
  rawText: string;                // original invitation, for literal excerpts
  now: Date;                      // injectable so date checks reproduce against fixtures
};

export type Check = {
  id: string;
  stage: 1 | 2;
  appliesTo: (c: Claims) => boolean;
  run: (ctx: CheckContext) => Promise<Finding[]>;
};
```

`Check.appliesTo` is what makes the plan dynamic. The orchestrator filters the registry
through it before running anything — this is the agentic behaviour, and it should be
visible in the UI ("Planned 7 checks based on 4 claims").

## DB schema — keep it this small

```sql
CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  raw_input TEXT NOT NULL,
  claims_json TEXT,
  findings_json TEXT,
  verdict TEXT,
  narrative TEXT,
  status TEXT NOT NULL          -- running | complete | awaiting_reply
);

CREATE TABLE outreach (
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
```

Thread matching: put the `outreach.id` in the subject line as a short token
(`[BF-a3f9c1]`). Matching replies by subject token is far more reliable than parsing
`In-Reply-To` headers across mail clients.

---

## Phase 0 — Smoke tests (45 min, before any product code)

Do not skip this. Every one of these is a dependency that can fail for reasons outside
your control, and you want to know now.

1. `scripts/smoke-llm.ts` — send a real invitation body to Gemini, request JSON matching
   the `Claims` schema, confirm it parses. **Check specifically whether the response
   comes back wrapped in markdown fences.** If it does, add a strip step in `llm.ts` now.
2. `scripts/smoke-mail.ts` — nodemailer sends to yourself; imapflow connects and lists
   the inbox. Confirm both.
3. `scripts/smoke-anakin.ts` — one scrape of a known conference URL, one search call.
   Record actual latency and credits consumed. Confirm the endpoint path against the
   live API reference; the docs contradict themselves on `/v1/scrape` vs
   `/v1/url-scraper`.
4. Download the Scopus source list CSV into `data/`, commit it, and confirm you can
   look up a journal by ISSN and by title.

**Gate:** if any of 1–3 fails, report it immediately before proceeding.

---

## Phase 1 — The spine (core deliverable)

Goal: paste an invitation, get a verdict with an evidence table. No email, no Anakin,
no streaming.

1. `core/types.ts`, `store/` + schema, `providers/cache.ts`.
2. `providers/llm.ts` → `extractClaims()`. Zod-validate the result.
3. `providers/registries.ts` — DOAJ API, Crossref, RDAP, Scopus CSV lookup. All free.
4. The four zero-credit checks: `identity-url-match`, `indexing-scopus`,
   `indexing-doaj`, `domain-age`. Plus `contact-domain` and `timeline-plausibility`,
   which need no network at all. Each one implements its contract in `SPEC.md` exactly.
5. `core/orchestrator.ts` — plan, run Stage 1 in parallel via `Promise.allSettled`,
   collect findings.
6. `core/scoring.ts` — the rule below, verbatim.
7. `app/page.tsx` — textarea, submit, evidence table. Ugly is fine.

**Phase 1 is the product.** If everything after this is cut, you still have a working,
honest, demoable agent that costs zero Anakin credits to run.

### The scoring rule — implement exactly this

```ts
export function score(findings: Finding[]): CaseVerdict {
  const contradicted = findings.filter(f => f.verdict === 'contradicted');
  const fatal = contradicted.filter(f => f.severity === 'fatal');
  const major = contradicted.filter(f => f.severity === 'major');
  const verified = findings.filter(f => f.verdict === 'supported');

  if (findings.some(f => f.id === 'people.callback' && (f.excerpt === 'DENIES' || f.excerpt === 'UNAWARE'))) return 'RED';
  if (fatal.length >= 1) return 'RED';
  if (major.length >= 2) return 'RED';
  if (major.length === 1) return 'AMBER';
  if (contradicted.length === 0 && verified.length >= 4) return 'GREEN';
  return 'AMBER';                                  // insufficient evidence
}
```

Before scoring, `capMajorsPerCheck()` keeps only the first major contradiction from each
check. Any extras stay in the table at minor, so no single check can reach RED on its own.

Note the final fallthrough: **AMBER means "not enough evidence", not "slightly
suspicious"**. Say that in the UI. It is the honest answer for an obscure but real
regional conference, and it is what stops you generating false accusations.

---

## Phase 2 — The act layer (the differentiator — do not cut this)

1. `providers/mail.ts` — `sendOutreach()` and `pollReplies()`.
2. `core/narrate.ts` — LLM drafts the speaker email. Short, polite, plain. Three
   sentences: who you are, what you saw, one question.
3. Pick targets: up to two people from `claims.people` who have a findable
   institutional email. If none are findable, record that as its own finding —
   "no listed speaker has a discoverable institutional address" is itself a signal.
4. `MAIL_MODE=dry|live`. Dry writes to `outreach` and logs. Live actually sends.
5. `api/poll-replies` — sweep IMAP, match by subject token, classify via
   `classifyReply()` into CONFIRMS/DENIES/UNAWARE/UNCLEAR, append a `people.callback`
   finding, **re-score the case**, persist.
6. Call the poll endpoint from a `setInterval` in a server module every 30s. Don't build
   a job queue.
7. Disposition: on completion, `narrate.ts` drafts the decline (RED) or a hold note
   (AMBER). Send it per `MAIL_MODE`. Show the sent message in the UI.

**Phase 2 is what turns a research tool into an agent.** The hackathon brief rewards
action; this is the action.

---

## Phase 3 — Anakin checks (upside)

1. `providers/anakin.ts` — `scrape(url)` and `search(q)`, both through `cache.ts`.
   Schema-based JSON extraction where it helps (+2 credits), plain markdown where it
   doesn't.
2. `people-reality` — scrape the venue's speakers page; for the top two people, find and
   scrape their institutional page; use `assessSupport()` to judge whether the person's
   own page mentions this venue. Semantic, not string match — "Program Committee,
   ICCSE'26" should match "International Conference on Computer Science and Engineering
   2026".
3. `proceedings-exist` — find last year's edition; resolve a sample DOI via Crossref
   (free) to confirm the proceedings are real.
4. `reports-prior` — one Anakin Search for `"<venue name>" predatory OR scam OR fake`.
   One call, 3 credits. Do not use Agentic Search; at 10 credits minimum it buys nothing
   a plain search plus a scrape doesn't.

Budget check: a full uncached run should be 10–15 credits. If it's more, cut
`reports-prior` first.

---

## Phase 4 — Demo polish (only if Phases 1–3 are solid)

1. SSE streaming so findings appear one at a time as they resolve.
2. Verdict banner, severity colour coding, expandable excerpt rows.
3. A "plan" panel showing which checks were scheduled and why — this makes the dynamic
   planning visible, which is otherwise invisible and is a big part of the agentic story.
4. `/case/[id]` permalink.
5. README with architecture diagram and the engineering log (see below).

---

## The engineering log — start it in Phase 0

Keep `NOTES.md` from the first hour. Every time Anakin surprises you — a rate limit, a
schema inconsistency, a blocked site, a retry you had to add, a doc that contradicted
the API — write one line. Publish it as a section of the README.

This costs nothing because you will hit these problems anyway. For an infrastructure
company evaluating an intern, a candidate who documented the edge cases of their API is
a much stronger signal than one who shipped a prettier UI.

---

## Cut order — agreed now, follow it without renegotiating

Cut from the bottom up:

1. `/case/[id]` permalink
2. SSE streaming → fall back to a spinner and a single render
3. `reports-prior`
4. `proceedings-exist`
5. `people-reality` → speaker emails then come straight from extracted claims
6. Disposition email → show the draft without sending

**Never cut:** Stage 1 checks, the evidence table, the scoring rule, or the speaker
callback. Those four are the product.

## Demo-day rules

- Record a full working demo video the moment Phase 2 is green. Before polish, not after.
- For the live run, the "keynote speaker" address must be one you control, so the reply
  is guaranteed to arrive on cue. Genuine outreach to real academics stays in the
  recorded segment.
- Run the live demo with `?fresh=1` so the judge sees real network calls, but have the
  cached run ready as a fallback if the venue site is slow.
- Have one legitimate venue queued to demo alongside the predatory one. Showing GREEN on
  a real IEEE conference is what proves you built a detector rather than a red-light
  generator.
