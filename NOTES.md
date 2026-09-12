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

## Phase 1 — 2026-09-13

- **Scopus has no homepage URL.** None of the 52 columns in the Aug 2026 list holds a URL, and the whole workbook contains one web address, in a single cell. `identity.url_match` gets homepages from DOAJ only (`bibjson.ref.journal`) and falls back to comparing publishers for Scopus-only journals.
- **DOAJ coverage is patchy for big OA publishers.** Sustainability (MDPI, 2071-1050) returns 0 hits by ISSN, while Scientific Reports, eLife and IEEE Access are all listed.
- **DOAJ title search is fuzzy.** `bibjson.title:"Sustainability"` returns "Journal of Transport and Sustainability" first, so title hits must match exactly after normalisation.
- **Registries name the same publisher differently.** DOAJ says "IEEE" and Scopus says "Institute of Electrical and Electronics Engineers Inc.". Without acronym handling, the publisher fallback would wrongly flag legitimate IEEE journals.
- **Scopus marks eLife as Inactive (coverage 2012–2024).** A real, well-known journal will produce `indexing.scopus` = contradicted/major if an invitation claims Scopus indexing, which is correct under the rule, but worth knowing before a demo.
- **RDAP returns 404 for unregistered domains** (all our fake fixture domains). `domain.age` treats that as unverifiable, not as evidence of anything.
- **Node 22 can run the TypeScript sources directly** once imports use `.ts` extensions (`allowImportingTsExtensions` in tsconfig). No tsx or build step is needed for scripts.
