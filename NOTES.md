# Engineering log

One line per surprise. Newest at the bottom.

## Phase 0 — 2026-09-13

- **Anakin docs:** `docs.anakin.io` does not resolve (ENOTFOUND). The real docs live at `anakin.io/docs/api-reference`.
- **Anakin scrape path:** the docs contradict themselves. The overview names routes `/scrape` and `/submit-scrape-job`, a third-party snippet uses `POST /v1/scrape`, and the URL Scraper page lists `POST /v1/url-scraper` (async job), `POST /v1/url-scraper/scrape` (inline) and `GET /v1/url-scraper/{id}` (poll).
- **Anakin inline scrape** holds the connection for up to about 90s and returns 202 with a job `id` if it runs over. It is limited to 20 req/min, tighter than the async route, so callers must handle a 202 by polling.
- **Anakin search:** `POST /v1/search` takes a `prompt` field (not `query`) and an optional `limit` (default 5, max 20). It is synchronous and returns `results[].{url,title,snippet,date,last_updated}`. The docs list no credit cost.
- **Gemini:** `gemini-2.5-flash` returns 404 "no longer available to new users" on a fresh AI Studio key. `gemini-3.6-flash` works. The model names stay in `.env`, which is why this was a one-line fix.
- **Gemini JSON:** with `responseMimeType: application/json` the output has no fences. With a plain prompt it comes back wrapped in ```` ```json ```` fences. `llm.ts` must set JSON mode *and* strip fences defensively.
- **Gemini latency:** about 10–12s per extraction call on `gemini-3.6-flash` with a short invitation. Too slow to run sequentially per check.
- **Scopus list:** it ships only as `.xlsx` (26 MB zipped, 110 MB main sheet, 390k shared strings, 7 sheets), not CSV. We convert it once with `unzip` plus a regex XML reader to avoid adding an xlsx dependency.
- **Scopus xlsx quirks:** after conversion the list has 49,009 sources and 1,178 discontinued titles. Header cells contain embedded newlines ("Top level:\n\nLife Sciences"), so the CSV parser must respect quotes. ISSNs are stored as 8 digits without hyphens.
- **Fuzzy title match near-miss:** a character-bigram Dice score ≥ 0.92 matched the made-up "International Journal of Advanced *Computing* Research" to the real, inactive "…Advanced *Computer* Research" (0.931). Predatory titles are deliberately one word off real ones, so matching must be word-level and the matched title must always go in the excerpt.

- **Anakin scrape path, verified live:** `POST /v1/scrape` returns 404 "Cannot POST /v1/scrape". `POST /v1/url-scraper` and `POST /v1/url-scraper/scrape` both exist; given an empty body, both return 400 "URL is required". The URL Scraper page is right, and the snippet using `/v1/scrape` is wrong.
- **Anakin latency, live:** an inline scrape of neurips.cc took 3.5s round trip (`durationMs` 1829, 12.6k chars of markdown). A search took 0.76s.
- **Anakin reports no credit usage per call.** Responses carry only `x-ratelimit-limit/remaining/reset` headers, with 20/min for inline scrape and 120/min for search, and no credit field in the body. Per-call cost must come from the published price table.

## Phase 1 — 2026-09-13

- **Scopus has no homepage URL.** None of the 52 columns in the Aug 2026 list holds a URL, and the whole workbook contains one web address, in a single cell. `identity.url_match` gets homepages from DOAJ only (`bibjson.ref.journal`) and falls back to comparing publishers for Scopus-only journals.
- **DOAJ coverage is patchy for big OA publishers.** Sustainability (MDPI, 2071-1050) returns 0 hits by ISSN, while Scientific Reports, eLife and IEEE Access are all listed.
- **DOAJ title search is fuzzy.** `bibjson.title:"Sustainability"` returns "Journal of Transport and Sustainability" first, so title hits must match exactly after normalisation.
- **Registries name the same publisher differently.** DOAJ says "IEEE" and Scopus says "Institute of Electrical and Electronics Engineers Inc.". Without acronym handling, the publisher fallback would wrongly flag legitimate IEEE journals.
- **Scopus marks eLife as Inactive (coverage 2012–2024).** A real, well-known journal will produce `indexing.scopus` = contradicted/major if an invitation claims Scopus indexing, which is correct under the rule, but worth knowing before a demo.
- **RDAP returns 404 for unregistered domains** (all our fake fixture domains). `domain.age` treats that as unverifiable, not as evidence of anything.
- **Phase 2 (the act layer):**
  - The IMAP poller searches per `[BF-xxxxxx]` token rather than scanning the inbox, so a busy personal Gmail stays cheap (about 4.7s per sweep, most of it connecting). Message bodies must be downloaded after the `fetch()` iterator finishes, because imapflow can't run other commands mid-stream.
  - Gemini's fast model writes serviceable outreach emails but not always grammatical ones ("verifying an invitation details"). Speaker emails therefore use the fixed SPEC.md template only. The LLM still drafts the disposition email, with the template as fallback.
  - Without `BONAFIDE_USER_NAME`, emails are signed with `MAIL_FROM_NAME` ("BonaFide Verification"), which is exactly the branding SPEC.md says gets binned. Set it before any live run.
- **Phase 3 (Anakin checks), measured 2026-09-13:**
  - **No balance or usage endpoint.** `GET /v1/credits`, `/v1/usage`, `/v1/account`, `/v1/me`, `/v1/balance` and similar all return 404. Credit figures come from the anakin.io/pricing table (scrape 1, search 3, +2 for `generateJson`; failures and Anakin-side cache hits are free). Reconcile totals against the dashboard.
  - **Scrape responses have a `cached` boolean.** Anakin runs its own cache, and a hit there is free, so the provider charges 0 when it is true.
  - **A scrape of an unregistered domain** (`icaces-conference.org`) fails without a charge. The provider caches the failure, so reruns don't retry it.
  - **Anakin search matches loosely.** `"Jane Example" Stanford University` returned five pages about Jane Stanford, and `ICACES 2025 proceedings` returned ICCAS 2025 pages. Whole-word surname and venue matching is what stops these becoming false "found" results.
  - **Actual cost, `predatory-1` Stage 2:** people.reality 6 (2 searches; the venue scrape failed free), proceedings.exist 3 (search found no prior edition, so no scrape), reports.prior 3. **12 credits.** On `legit-1`, only reports.prior applies: **3 credits**. The same run again from disk cache: **0**.
  - **Session spend:** 4 (smoke test) + 12 + 3 = **19 credits**.
  - **flip-1 exposed a false-accusation bug** (10 credits). For an invented speaker at Tampere University, Anakin's only hit naming the surname was a *real* academic with the same full name at a US university (`.edu`). Because any `.edu` counted as institutional, the check scraped that person's page and reported "no mention … on <name>'s page at Tampere University", a false statement about a real person. The fix: a page must be tied to the *stated* affiliation by its domain or its own title/snippet.
  - **Same-name collisions are the normal case for people search.** A search for an invented name at KTH returned only real KTH profiles of people with the same first name, one of them with a near-identical surname. Any realistic invented name will collide with someone real.
  - **Near-name rule (user decision, 2026-09-13):** when no result names the person, but a result at the stated affiliation shows the same given name followed by a near-identical surname, people.reality returns unverifiable instead of contradicted. Deliberate trade-off: a fake speaker named one letter off a real colleague is no longer flagged by this check.
  - **flip-1 speakers renamed to avoid real people.** Pre-screening with a free web search rejected Kauppi and Linna (Tampere) and Kumpula (Helsinki): each surname belongs to real academics at that university. Campus names with no same-surname staff were kept: Frescati (Stockholm University) and Albano (KTH).
    - The `?fresh=1` API run cost **11 credits**: people.reality 8 (2 searches, 2 campus-page scrapes, venue site failed free), reports.prior 3. Both speakers are unverifiable because the only surname hits are campus pages, not people.
    - The KTH results do incidentally list real people (a maths department calendar), but none shares or resembles the speaker's name.
    - **Session spend: 40 credits.**
  - **A transient Gemini `fetch failed` during reply classification** used to record UNCLEAR. Because the first reply wins, that speaker's real CONFIRMS was then lost for good. It surfaced while testing flip-1 and would have killed a live-demo flip. The reply is now left unrecorded and retried.
- **Node 22 can run the TypeScript sources directly** once imports use `.ts` extensions (`allowImportingTsExtensions` in tsconfig). No tsx or build step is needed for scripts.
