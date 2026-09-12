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
- Stage 1 checks must cost 0 credits. Stage 2 checks record their credit cost.
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

### `proceedings.exist` — **MAJOR**

Applies to conferences claiming a prior edition, or journals claiming archives.

1. Find last year's edition page (search + scrape).
2. Extract a sample of paper DOIs.
3. Resolve them via the Crossref API (free) — do they exist, and does the registered
   publisher match the claimed one?

- DOIs resolve, publisher matches → `supported`
- No prior edition findable despite an edition-number claim → `contradicted`, **major**
- DOIs don't resolve → `contradicted`, major
- Can't determine → `unverifiable`

### `reports.prior` — **MINOR**

One Anakin Search call (3 credits): `"<venueName>" predatory OR scam OR fake`.

- Credible hits (academic blogs, library guides, Retraction Watch, university warning
  pages) → `contradicted`, **minor**, with the strongest link as `sourceUrl`
- Nothing → `info`, not `supported` — absence of complaints is weak evidence

Deliberately minor. Search results are not authority, and this check exists to add
colour, not to drive the verdict. **First to cut if credits run short.**

---

## Stage 3 — the callback

### `people.callback` — **overrides everything**

Not a normal check; produced by the reply handler, appended after the fact.

`excerpt` holds the classification verbatim: `CONFIRMS`, `DENIES`, `UNAWARE`, `UNCLEAR`.
`sourceUrl` is null. `note` quotes the relevant sentence from the reply.

- `DENIES` or `UNAWARE` → forces **RED**, regardless of every other finding. A named
  keynote saying "I never agreed to this" is the strongest evidence obtainable.
- `CONFIRMS` → `supported`, major severity, counts toward the GREEN threshold.
- `UNCLEAR` → `unverifiable`, no effect.

Outreach email template — keep it this short:

> Subject: Quick verification — [Venue Name] [Year] [BF-token]
>
> Dear Prof. [Name],
>
> I'm a student verifying a conference invitation before submitting. The website for
> [Venue Name] lists you as [role]. Could you confirm whether you agreed to take part?
>
> If your name is being used without your knowledge, I'd be glad to send you the page.
>
> Thank you,
> [User name]

No branding, no automated-message footer, no HTML. It has to read like a student wrote
it, because a student did — the agent is acting on their behalf, and a marketing-shaped
email gets binned.
