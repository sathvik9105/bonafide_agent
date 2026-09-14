# Check Specifications

Every check is a file in `core/checks/` that exports exactly `id`, `stage`,
`appliesTo(claims)` and `run(ctx)`, so the module itself satisfies `Check`.
`core/checks/index.ts` collects them.

```ts
export const id = 'indexing.scopus';
export const stage = 1;
export function appliesTo(c: Claims): boolean { return c.claimedIndexing.includes('scopus'); }
export async function run({ claims, rawText, now }: CheckContext): Promise<Finding[]> { … }
```

`CheckContext` is `{ claims, rawText, now }`. `rawText` is the original invitation, used to
quote literal excerpts. `now` can be injected so that date-based checks give the same result
on every run against a fixture (`scripts/run-check.ts --now 2026-09-13`).

**Universal rules**

- A check that cannot reach its source returns `verdict: 'unverifiable'`. It never
  throws. Wrap the body in `guard()` (`core/checks/finding.ts`), which turns any error
  into an unverifiable finding.
- `sourceUrl` must point at the page a human would open to check the finding manually.
- `excerpt` is the literal text that decided it — not a paraphrase. Truncate to ~200
  chars.
- `note` is one plain-English sentence with no hedging adverbs. Stage 1 notes are fixed
  templates filled in from the finding. `narrate.ts` may rewrite them for display later.
- `FindingVerdict` has no "info" value. Where this spec calls an outcome **info**,
  return `verdict: 'unverifiable'` with `severity: 'info'`. It is recorded but counts
  neither for nor against the venue.
- **One major per check.** Before scoring, if a check returns more than one
  `contradicted`/`major` finding, only the first stays major. The rest are shown at
  **minor**, with a note saying why. A single check can therefore never reach RED alone
  (two majors). Fatal findings are unaffected.
- Stage 1 checks must cost 0 credits. Stage 2 checks record their credit cost. One documented
  exception: `identity.url_match`'s hijacked-journal pre-check (1 credit, see its section below).
- **Credit accounting.** Every Anakin call goes through `providers/anakin.ts`, which
  prices it from the published price list: scrape 1 credit, search 3. The API reports no
  per-call usage, so the price list is the only source. Disk-cache hits, failed requests
  and Anakin-side cache hits cost 0.
  - The run's ledger reserves a call's price before making it and refuses the call if
    `MAX_CREDITS_PER_RUN` would be exceeded, so the check comes back `unverifiable`.
  - A check's total cost is written to its first finding's `costCredits`.
  - Stage 2 never uses Anakin's `generateJson` (+2 credits). Gemini reads the scraped
    markdown instead.
- Title lookups in Scopus and DOAJ are for journals only. A conference name is never
  matched against a journal registry.
- The **registrable domain** of a site is its last two labels, or its last three under
  common two-part suffixes (`ac.uk`, `edu.au`, `co.in`, …). This is deliberately done
  without a public-suffix dependency.

---

## Stage 1 — free, fast, reliable

### `identity.url_match` — **FATAL** (homepage mismatch) / **MAJOR** (publisher mismatch)

*The flagship check. This is the one that catches what indexing lookups miss.*

Applies when the venue claims indexing in any registry, or provides an ISSN.

**0. Retraction Watch's Hijacked Journal Checker, checked first.** A Wire action built for this
project (`act_retractionwatch_com_hijacked_journal_check`, 1 credit, no auth — see NOTES.md)
queries the list by `claims.issn`, or by title for journals only (never conferences, same
guard as the Scopus/DOAJ title lookups below). This is an authoritative external list, so a
hit needs no LLM judgment:

- On the list → `contradicted`, **fatal**, immediately, regardless of what DOAJ/Scopus would
  otherwise say. `sourceUrl` is the Retraction Watch checker page; `excerpt` names the
  hijacked title, the legitimate title/ISSN it clones, and the hijacking URL.
- Not on the list, or the lookup fails → fall through unchanged to steps 1–3 below. This step
  never produces an `unverifiable` finding of its own; a failure here is silent and
  supplementary, not a signal.

Exception to the "Stage 1 checks must cost 0 credits" universal rule above: this specific
sub-step is deliberately Stage 1 despite its bounded cost, because it belongs conceptually
with the identity check it feeds and only ever runs when that check would run anyway.

**Only DOAJ provides homepages.** The Scopus source list has no homepage or URL column.
The August 2026 list has 52 columns, and none of them contains a URL. Scopus can
therefore only confirm the publisher, not the site.

Look up by ISSN first. For journals, fall back to the title (exact match after
normalisation).

**1. DOAJ has the venue and lists a homepage.** Compare the registrable domain of that
homepage with the registrable domain of `claims.venueUrl`.

- Domains match → `supported`
- Domains differ → `contradicted`, **fatal**. This is the indexjacking signature: the
  registry knows a journal by this name, but it lives at a different address than the
  site that contacted you.
- No `venueUrl` in the invitation → `unverifiable`.

The contact email is not compared here. A real publisher can legitimately send mail from
a related domain (`nature.com` site, `springernature.com` mail), so a contact mismatch
does not prove indexjacking. `contact.domain` covers that signal at major severity.

Excerpt should show both URLs side by side. This is the single most persuasive row in
the table — make it read well.

**2. DOAJ has no homepage, but Scopus has the venue.** Use the publisher fallback, at
**major** severity. Compare `claims.publisher` with the Scopus `Publisher` column and the
`Publisher Imprints Grouped to Main Publisher` column, and take the better result.

- No publisher named in the invitation → `unverifiable`
- Clear match → `supported`. The note must say the website itself was not compared.
- Clear mismatch → `contradicted`, **major**. Excerpt shows both names.
- Anything in between (a near-miss) → `unverifiable`. Excerpt shows both names.

**3. Not found in any registry at all** → do **not** report fatal here. That is
`indexing.*`'s job. Return `unverifiable`.

**Publisher normalisation** (`core/publisher.ts`, no LLM):

- Lowercase, strip diacritics, and treat `&` and `+` as "and".
- Split into words and drop one-letter words.
- Treat a parenthetical as a separate alias. "Multidisciplinary Digital Publishing
  Institute (MDPI)" is compared both as the full name and as "MDPI".
- Drop stopwords (`of`, `and`, `the`, …) and corporate words (`ltd`, `inc`, `gmbh`,
  `publishing`, `publishers`, `press`, `group`, `media`, `sons`, …). The words left are
  **meaningful**.
- **Generic** words (`science`, `research`, `international`, `academic`, `society`,
  `institute`, `university`, `american`, …) are meaningful but not **distinctive**.

Classify a pair of names as follows:

- **Clear match**, either:
  - one name is an acronym of the other ("IEEE" = "Institute of Electrical and
    Electronics Engineers Inc.", "PLOS" = "Public Library of Science"), or
  - they share distinctive words and one side's distinctive words are all contained in
    the other's ("Wiley" vs "John Wiley & Sons", "Nature Research" vs "Springer
    Nature").
- **Clear mismatch:** no meaningful words in common, no acronym relation, and no pair of
  distinctive words spelled alike.
- **Near-miss:** everything else. That covers partial overlaps ("Wiley-Blackwell" vs
  "John Wiley & Sons"), overlap in generic words only ("Science Publishing Group" vs
  "Science Press"), near-spellings ("Elsevier" vs "Elsevir"), and a name with no
  meaningful words.

Known limit: a legitimate imprint that shares no words with its Scopus parent (e.g.
"Lippincott" vs "Wolters Kluwer") reads as a clear mismatch, unless the imprints column
lists it.

### `indexing.scopus` — **FATAL if fabricated**

Applies when `claimedIndexing` includes scopus.

Look up by ISSN, matching both the ISSN and EISSN columns. Otherwise look up by
normalised title in `data/scopus-sources.csv`.

- Present and `Active` → `supported`
- Present but `Inactive` → `contradicted`, **major**. Excerpt must quote the
  coverage end year. Journals that were delisted and still advertise indexing are a
  distinct and common pattern.
- Claimed ISSN absent, but a journal with this title is indexed → `contradicted`,
  **major**. Excerpt shows both ISSNs.
- Absent entirely → `contradicted`, **fatal**
- Conference with no ISSN → `unverifiable`. Scopus indexes proceedings one volume at a
  time after they are published, so a forthcoming edition cannot be looked up.
- CSV unreadable → `unverifiable`

Normalise titles before matching: lowercase, strip punctuation, strip leading "the",
collapse whitespace. Also compare with parenthetical qualifiers removed
("Sustainability (Switzerland)").

Match titles on **word-level** similarity (Jaccard ≥ 0.9), not character
similarity. Predatory titles are deliberately one word off real ones. "Advanced
Comput*ing* Research" against the real "Advanced Comput*er* Research" scores 0.93 on
character bigrams but 0.71 on words. **Report the matched or nearest title in the
excerpt** so a near-miss is visible rather than silently wrong.

### `indexing.doaj` — **MAJOR**

Applies when `claimedIndexing` includes doaj, or when the venue is a journal with an
ISSN (worth checking unprompted — free, and presence is positive evidence).

Query the DOAJ public API by ISSN. For journals, the title is a fallback, and it must
match exactly after normalisation, because DOAJ's own title search is fuzzy.

- Present → `supported`
- Claimed but absent → `contradicted`, major
- Not claimed and absent → **info**, not a contradiction
- Conference claiming DOAJ with no ISSN → `unverifiable`

### `domain.age` — **MAJOR**

Applies always, when `venueUrl` exists.

RDAP lookup (`https://rdap.org/domain/<registrable domain>`), free, no key. Extract the
registration date. The finding's `sourceUrl` is the ICANN lookup page for the domain.

- Age < 6 months → `contradicted`, major regardless of edition claims.
- Age < 12 months **and** the venue name claims an edition number ≥ 3, or the word
  "annual" → `contradicted`, **major**. A "15th Annual International Conference" on a
  five-month-old domain cannot be what it says it is. Put that reasoning in the note.
- Age > 3 years → `supported`
- Otherwise → **info**
- No RDAP record (404, or a TLD that rdap.org doesn't cover) → `unverifiable`

Also flag lookalikes of known publisher domains when trivially detectable. The test is
that the domain's first label has a publisher brand as a hyphen-separated segment
(`elsevier-journals.org`), but the domain is not one of that publisher's real domains.
Report it as a separate `contradicted` finding, **minor**. It is minor because legitimate
society conferences sometimes use such domains (`ieee-icc.org`). Don't build a full
typosquat detector.

### `contact.domain` — **MAJOR**

No network. Compare the registrable domain of `claims.contactEmail` with that of
`claims.venueUrl`.

- Free mail provider (gmail/yahoo/outlook/hotmail/163/qq and similar) → `contradicted`,
  **major**. A legitimate indexed venue does not run submissions through a Gmail address.
- Academic institutional domain (`.edu`, `.ac.xx`, `.edu.xx`) → `supported`, even
  when it differs from the venue site, because conferences are often run from a
  university.
- No `venueUrl` to compare against → `unverifiable`.
- Different domain from the venue site → `contradicted`, major.
- Same registrable domain as the venue site → `supported`.

### `timeline.plausibility` — **MAJOR**

No network. Pure reasoning over extracted claims. It needs `claims.eventDate` (ISO start
date, added to `Claims` for the second rule). Dates are parsed by a fixed parser in
code, never by the LLM at check time. Each rule that fires produces its own finding. Under the one-major-per-check rule,
only the first major counts as major.

- `promisedTurnaroundDays` ≤ 7 for a peer-reviewed venue → `contradicted`, **major**.
  Quote the promise from `rawText`. Real peer review does not complete in 48 hours.
- The next upcoming deadline is within 14 days of `now`, and `eventDate` is under 60 days
  away → `contradicted`, major.
- Deadline language containing "final extension", "last chance", or an extension count
  → `contradicted`, minor.
- Nothing anomalous, and at least one of turnaround, deadline or event date was stated
  → `supported`.
- No timeline information at all → **info**.

---

## Stage 2 — Anakin-backed, costs credits, cache hard

### `people.reality` — **MAJOR**

*The second-most persuasive check. Worth the credits.*

Applies when `claims.people` is non-empty.

1. If the venue has a speakers/committee page, scrape it (1–3 credits) and reconcile
   against the extracted names.
2. For the top two named people with an affiliation, search for their institutional
   page, scrape it.
3. Call `assessSupport(personPage, venueName)` — does this person's own page mention
   this venue in any form?

- Person's page lists the venue → `supported`
- Person is clearly real and active in the field, page makes no mention → `contradicted`,
  **major**. Note must be careful: absence of mention is suggestive, not proof. Word it
  as "no mention found on the listed affiliation's page", never as "this person is not
  involved".
- Person cannot be found to exist at the stated affiliation → `contradicted`, **major**
- Page unreachable → `unverifiable`

Budget: cap at 2 people, 4 scrapes total.

Implementation rules, all deterministic except `assessSupport()`:

- **Venue site.** Scrape `venueUrl`. If a checked person's surname is missing from it,
  follow one same-domain link whose text says keynote, speaker, committee, editorial or
  board. Each person's note records whether they were named on the venue site. This
  informs the note but not the verdict.
- **Search.** One search per person: `"<name without titles>" <affiliation>`, 5 results.
  - A result is **about the person** if its title, snippet or URL contains their surname
    as a whole word.
  - It is **at the stated affiliation** if its domain is named after the affiliation
    (`stanford.edu`, `iitb.ac.in`, `kth.se`) or its title or snippet names the affiliation
    (a `tuni.fi` page saying "Tampere University").
  - An academic domain alone is **not** enough: a same-name academic at another
    university is a different person. Found by `flip-1`, where a real same-name academic
    at a US university was judged as the invitation's speaker at a Finnish university.
  - Profile aggregators (LinkedIn, ResearchGate, Google Scholar, ORCID, academia.edu, …)
    never count.
- **Outcomes, in order:**
  - No result names them, but a result at the stated affiliation names someone with the
    same given name followed by a near-identical surname → `unverifiable`.
    - "Near-identical" means one surname starts with the other, or they are within 1
      letter (2 for surnames of 6+ letters): "Anna Berg" vs "Anna Bergman".
    - A close-but-different name is ambiguous, not a denial.
    - **Trade-off, accepted deliberately:** a fake speaker named one letter off a real
      person at that university is not flagged by this check.
  - Otherwise, when no result is about the person → "cannot be found at the stated
    affiliation": `contradicted`, **major**. The source link is a repeatable web search.
  - Results name them, but none is at the stated affiliation → `unverifiable`.
  - The first result at the affiliation is scraped and passed to `assessSupport()`. If the page
    mentions the venue and the quoted line is literally on the page → `supported`, with
    that line as the excerpt.
  - The page is the person's own but has no mention → `contradicted`, **major**.
  - The page isn't clearly theirs → `unverifiable`.
- **One finding per person.** Two contradictions from this check are capped by the
  one-major-per-check rule.

### `proceedings.exist` — **MAJOR**

Applies to conferences whose name claims an edition number ≥ 2 or the word "annual".
Journals are skipped: `Claims` has no archive claim to test, and DOAJ and Scopus already
cover journal history.

1. Find last year's edition page (search + scrape).
2. Extract a sample of paper DOIs.
3. Resolve them via the Crossref API (free) — do they exist, and does the registered
   publisher match the claimed one?

- DOIs resolve, publisher matches → `supported`
- No prior edition findable despite an edition-number claim → `contradicted`, **major**
- DOIs don't resolve → `contradicted`, major
- Can't determine → `unverifiable`

Implementation rules:

- **Which year.** The previous edition is the event year minus one, where the event year
  comes from `eventDate`, a year in the name, or `now`.
- **Search.** `<acronym> <year> proceedings`. Without an acronym, use the quoted base name
  (edition, year and "annual" removed). 5 results.
- **Picking the prior edition.** A result counts when its title, snippet or URL mentions
  the venue (acronym as a whole word, or ≥ 60% of its distinctive words) and contains that
  year. None → `contradicted`, major.
- **DOIs.** Scrape that page and take up to 3 DOIs from its markdown.
  - None listed → `unverifiable`.
  - None exist in Crossref → `contradicted`, major.
  - They resolve, but none of their container titles mention this venue →
    `unverifiable`. Listing other people's DOIs is a known trick, but a mismatched title
    alone is not proof.
- **Publisher.** A clear publisher mismatch against `claims.publisher` →
  `contradicted`, major. Otherwise `supported`.

### `venue.structure` — **MAJOR, never fatal**

Applies only to conferences with a `venueUrl`. Never applies to journals: journals have no
committee/programme page structure to check, and DOAJ/Scopus already cover journal history.

A single Anakin Map call (1 credit) discovers the venue site's same-domain URLs (depth 2,
limit 100). Classify each URL's path into content categories by keyword: **committee**
(committee, chairs, organizers, organisers, keynote, speaker), **cfp** (cfp, call-for-papers,
submission, papers), **dates** (dates, deadline, schedule, program, programme, agenda),
**proceedings** (proceedings, publication, archive, past), **venue/contact** (venue, contact,
about, location, register, registration).

This is a weak, corroborating signal, not proof — a real small workshop can legitimately have
very few pages. The threshold is deliberately conservative so it only fires on a genuinely bare
site:

- **2 or more categories matched** → `supported`
- **0 categories matched and 2 or fewer same-domain links total** (a single-page or near-empty
  site) → `contradicted`, **major**. The note must say something to the effect of "few
  structured pages found — this alone doesn't prove anything, small legitimate venues can look
  thin too; treat as corroborating, not decisive." Never fatal: this check alone must never be
  enough to condemn a venue.
- **Anything in between** (1 category matched, or few links with no categorized structure) →
  `unverifiable`, severity **info**. Ambiguous is not evidence either way.
- Map call fails (domain doesn't resolve, timeout, etc.) → `unverifiable`.

`sourceUrl` is the venue homepage. `excerpt` lists the matched categories (or "no structured
pages found among N links").

### `reports.prior` — **MINOR**

One Anakin Search call (3 credits): `"<venueName>" predatory OR scam OR fake`. It
uses the base name, with edition, year, "annual" and the parenthetical removed, because an
exact quoted "15th … (ICACES-2026)" matches almost nothing. 10 results.

A hit is **credible** when all three hold:

- It is from a university or library domain, a library guide, or a research-integrity or
  academic-press source (Retraction Watch, Beall's list, Cabell's, Think.Check.Submit,
  Times Higher Education, Nature, Science, UGC).
- Its title or snippet uses warning language (predatory, scam, fake, hijacked, fraud,
  beware, …).
- It mentions this venue.

- Credible hits (academic blogs, library guides, Retraction Watch, university warning
  pages) → `contradicted`, **minor**, with the strongest link as `sourceUrl`
- Nothing → `info`, not `supported` — absence of complaints is weak evidence

Deliberately minor. Search results are not authority, and this check exists to add
colour, not to drive the verdict. **First to cut if credits run short.**

---

## Stage 3 — the callback

### Speaker targeting and `people.outreach` — **MINOR**

Applies when `claims.people` is non-empty. Until `people.reality` (Stage 2) exists,
addresses come only from the invitation text (`Person.email`).

Contact up to two people, in the order the invitation lists them, whose address:

- is present and parseable,
- is not a free mail provider (same list as `contact.domain`),
- is not on the registrable domain of the venue site or of the contact address, since a
  reply from there would come from the organisers.

- At least one person qualifies → one outreach email each, using the template below, with
  subject token `[BF-<outreach id>]`. No finding is added. The emails appear in their own
  panel, and the case status becomes `awaiting_reply`.
- People are listed but none qualifies → `contradicted`, **minor**, id `people.outreach`.
  The excerpt lists each person and why they were skipped. "No listed speaker has a
  discoverable institutional address" is a signal, but a weak one.

### `people.callback` — **overrides everything**

Not a normal check; produced by the reply handler, appended after the fact.

`excerpt` holds the classification verbatim: `CONFIRMS`, `DENIES`, `UNAWARE`, `UNCLEAR`.
`sourceUrl` is null. `note` quotes the relevant sentence from the reply.

- `DENIES` or `UNAWARE` → forces **RED**, regardless of every other finding. A named
  keynote saying "I never agreed to this" is the strongest evidence obtainable. Recorded
  as `contradicted`, **fatal**.
- `CONFIRMS` → `supported`, major severity, counts toward the GREEN threshold.
- `UNCLEAR` → `unverifiable`, severity info, no effect.

Outreach email template — keep it this short:

> Subject: Quick verification — [Venue Name] [Year] [BF-token]
>
> Dear Prof. [Name],
>
> I'm a student verifying a conference invitation before submitting. The website for
> [Venue Name] lists your role as "[role]". Could you confirm whether you agreed to take part?
>
> If your name is being used without your knowledge, I'd be glad to send you the page.
>
> Thank you,
> [User name]

No branding, no automated-message footer, no HTML. It has to read like a student wrote
it, because a student did — the agent is acting on their behalf, and a marketing-shaped
email gets binned.

The subject, token and body are all built in code from the template above. There is no
LLM, so every speaker gets exactly this wording. Emails are signed with
`BONAFIDE_USER_NAME`.

### Reply handling

- **Polling.** The poller (`instrumentation.ts` → `startReplyPoller`, every 30s) searches
  INBOX only when a speaker email was actually sent and has no reply yet. In dry mode
  nothing is sent, so it never connects.
- **Matching.** A message matches by the `[BF-<id>]` token in its subject. Our own
  outgoing email (sent from our address, subject without `Re:`) is ignored.
- **Classifying.** Quoted history is stripped first (`>` lines, "On … wrote:",
  "Original Message"). `classifyReply()` returns the class and the sentence that decided
  it. If that sentence isn't literally in the reply, the reply's first sentence is quoted
  instead.
- **Classification failures.** If classification fails (network error, invalid model
  output), **nothing is recorded**. The first reply per outreach wins, so recording
  UNCLEAR would lose the speaker's real answer permanently. The poller retries on its next
  sweep, and the simulate endpoint returns an error so the reply can be sent again.
- **Re-scoring.** The first reply per outreach wins. It appends a `people.callback`
  finding, re-applies the one-major cap, and re-scores the case. The status returns to
  `complete` once every contacted speaker has replied.
- **Dry-mode testing.** The UI can simulate a reply
  (`POST /api/outreach/<id>/simulate-reply`), which runs exactly the same path.

### Disposition email

- RED → a decline. AMBER → a hold note. GREEN → nothing.
- It is addressed to `claims.contactEmail`. If the invitation has no contact address, it
  is drafted but never sent.
- The fast LLM model drafts it, with a fixed template as fallback. It names what could
  not be verified, using neutral phrases for the fatal and major contradictions, and
  never accuses anyone of fraud. A decline also asks the sender to remove the address from
  their list.
- It is drafted once when the run completes, and again whenever a reply changes the
  verdict to RED or AMBER.

### Sending

- `MAIL_MODE=dry` (the default) writes every email to the `outreach` table and logs it.
  Nothing is sent.
- Live sending needs **both** `MAIL_MODE=live` on the server and the run's own opt-in
  (`sendMail: true`, the UI checkbox). This is hard rule 7: live is opt-in per run.
- `MAIL_REDIRECT_TO`, when set, delivers every live email to that address instead, so
  live sending can be tested without contacting real people. The intended recipient stays
  in the database.
