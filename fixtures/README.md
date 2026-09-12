# Fixtures

All four are **synthetic**. Replace `predatory-1.txt` with a real (redacted) invitation when one is to hand.
The people in `predatory-1.txt` are invented. No fixture is ever used as an email recipient.

| Fixture | Scenario | Check it exercises |
|---|---|---|
| `predatory-1.txt` | Mass-mailed conference: fake ISSN, Gmail contact, 48-hour review, "final extension" | `indexing.scopus` absent (fatal), `contact.domain` free mail, `timeline.plausibility` |
| `hijacked-1.txt` | Real DOAJ journal (Scientific Reports, 2045-2322) at a lookalike site | `identity.url_match` DOAJ homepage mismatch (fatal) |
| `hijacked-2.txt` | Real Scopus-only journal (TPAMI, 0162-8828) with a made-up publisher | `identity.url_match` publisher fallback, clear mismatch (major) |
| `legit-1.txt` | Real journal (PLOS ONE, 1932-6203) on its real site and domain | Every applicable check `supported` |

Run with a fixed date so the date-based checks give the same result on every run:

```
node --no-warnings --env-file=.env scripts/run-check.ts fixtures/predatory-1.txt --now 2026-09-13
```
