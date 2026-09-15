# Fixtures

All fixtures are **synthetic** except where a row names a real journal. Replace `predatory-1.txt` with a real (redacted) invitation when one is to hand.
The people in `predatory-1.txt` are invented. No fixture is ever used as an email recipient.

| Fixture | Scenario | Check it exercises |
|---|---|---|
| `predatory-1.txt` | Mass-mailed conference: fake ISSN, Gmail contact, 48-hour review, "final extension" | `indexing.scopus` absent (fatal), `contact.domain` free mail, `timeline.plausibility` |
| `hijacked-1.txt` | Real DOAJ journal (Scientific Reports, 2045-2322) at a lookalike site | `identity.url_match` DOAJ homepage mismatch (fatal) |
| `hijacked-2.txt` | Real Scopus-only journal (TPAMI, 0162-8828) with a made-up publisher | `identity.url_match` publisher fallback, clear mismatch (major) |
| `predatory-2-no-issn.txt` | `predatory-1` with the ISSN removed ("published in the conference proceedings") | Scopus claim becomes unverifiable; verdict rests on contact + timeline |
| `predatory-3-polished.txt` | Fake conference with no ISSN, its own-domain email, a 6-week review and no pressure language | The Stage 1 blind spot: nothing to contradict |
| `speakers-1.txt` | Plausible fake symposium naming speakers with addresses on reserved `example.edu` / `example.ac.uk` domains, plus one Gmail | Speaker targeting (2 contacted, the Gmail one skipped), AMBER that a simulated DENIES/UNAWARE reply flips to RED |
| `flip-1.txt` | Obscure, genuine-reading workshop: no edition number, no indexing claims, own-domain contact, 8-week review. Two invented speakers at Stockholm University and KTH, with addresses on the reserved `.example` TLD. Their surnames are campus names (Frescati, Albano): pre-screened so no real academic with either surname surfaces at the stated affiliation, but university pages still mention the word | The demo flip. Stage 1 and Stage 2 leave it AMBER with nothing contradicted and `people.reality` unverifiable. Only a speaker reply resolves it: DENIES/UNAWARE → RED, two CONFIRMS → GREEN |
| `legit-1.txt` | Real journal (PLOS ONE, 1932-6203) on its real site and domain | Every applicable check `supported` |

Run with a fixed date so the date-based checks give the same result on every run:

```
node --no-warnings --env-file=.env scripts/run-check.ts fixtures/predatory-1.txt --now 2026-09-13
```
