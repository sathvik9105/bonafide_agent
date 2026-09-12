# CLAUDE.md — BonaFide

Read this before every task. It overrides your defaults.

## What this is

BonaFide is an agent that investigates academic conference and journal invitations,
determines whether the venue is legitimate, contacts named speakers to verify their
involvement, and disposes of the invitation on the user's behalf.

Built solo for the Anakin Forge hackathon. **Deadline: 14 September 2026.**
Roughly two days of build time. Optimise for _finished and demoable_, never for
_complete_.

## The single most important rule

**Nothing in the critical path may be non-deterministic.**

This is a fraud-verdict product demoed live to judges. If the same input produces a
different verdict on two runs, the demo fails and the product is worthless. Therefore:

- The LLM extracts claims, assesses semantic support, and writes prose.
- **The LLM never decides the verdict.** A hardcoded rule engine does (`core/scoring.ts`).
- Every finding must carry a `sourceUrl` a judge can click and an `excerpt` that
  shows the exact text the decision rested on.

If you are ever tempted to "let the model reason about the overall verdict" — don't.
That is the thing we are specifically not building.

## Architecture in one paragraph

A deterministic orchestrator calls an LLM at the leaves. Input (invitation text or URL)
→ LLM extracts structured claims → claims determine which checks get scheduled →
checks run in parallel within their stage → each returns `Finding[]` → rule engine
computes a verdict → LLM writes the narrative and the disposition email → agent sends
it. Separately, an IMAP poller watches for speaker replies and reopens cases, which can
flip a verdict after the fact.

## Hard rules

1. **Every check is independently fallible.** A check that throws returns
   `verdict: 'unverifiable'` — it never kills the run. On an unknown venue, half the
   checks coming back unverifiable is a correct outcome, not a bug.

2. **Cache every network call from the first commit.** `cache/<sha256(url)>.json`,
   infinite TTL in dev. We have 300 Anakin credits total for the entire hackathon.
   Without caching we run out today. A `--no-cache` / `?fresh=1` escape hatch exists
   for the live demo run only.

3. **Prefer free sources over Anakin.** DOAJ, Crossref, RDAP and the Scopus source-list
   CSV cost zero credits and are more reliable than scraping. Only spend Anakin credits
   on the venue's own site, speaker homepages, proceedings pages, and one search sweep.

4. **Never hardcode a model name, endpoint, or provider.** All in env vars, all behind
   `providers/`. We will swap things at 2am.

5. **No secrets in code, logs, commits, or test fixtures.** `.env` is gitignored before
   the first commit. This repo goes public (the hackathon has a GitHub raffle).

6. **Ask before adding a dependency.** The stack below is the stack.

7. **Never send email to a real third party without an explicit instruction in the
   task.** Default `MAIL_MODE=dry` writes the message to the DB and logs it. Live
   sending is opt-in per run.

## Stack — do not deviate

- Next.js 16 (App Router) + TypeScript, single process
- Tailwind for styling. No component library.
- SQLite via `better-sqlite3`. One file, no migrations tooling, schema in `store/schema.sql`.
- Gemini via `@google/genai` for all LLM work
- `nodemailer` (send) + `imapflow` (read) for the callback
- Anakin via plain `fetch` — no SDK, the SDKs are alpha
- No Docker, no queue, no Redis, no ORM, no auth

## Code conventions

- Named exports. No default exports except Next.js pages/routes.
- All external I/O lives in `providers/`. Business logic in `core/` imports from
  `providers/` and never calls `fetch` directly.
- Every check file exports exactly: `id`, `stage`, `appliesTo(claims)`, `run(ctx)`.
- Each check's contract lives in `SPEC.md` at the repo root. Change the spec first,
  then the check.
- Zod for every LLM response and every external JSON payload. Parse, don't trust.
- `console.log` is fine. Don't add a logging library.

## What "done" means for any task

- It runs end to end without throwing.
- Its output is visible in the UI.
- Its failure mode is graceful and produces `unverifiable`, not a 500.

## When you get stuck

Stop and say so rather than building an elaborate workaround. Time is the scarce
resource, and `IMPLEMENTATION.md` has a pre-agreed cut order for exactly this reason.
Cutting scope is always the right call over debugging something off the critical path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
