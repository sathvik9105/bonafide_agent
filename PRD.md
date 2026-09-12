# BonaFide — Product Requirements

## The problem

Predatory journals and conferences farm early-career researchers. One study tracked a
single junior researcher's inbox for six months after their first corresponding-author
paper: 162 invitations, of which only 11% disclosed publication fees. Cabell's counts
over 15,500 active predatory journals as of early 2026, most with professional-looking
websites and convincing indexing statements.

Getting it wrong costs a student their registration fee, their paper (unpublishable
elsewhere afterwards), and sometimes degree credit. The victims are concentrated among
final-year B.Tech/M.Tech students, PhD candidates and junior faculty — heavily in India,
where UGC-CARE and Scopus requirements create the exact incentive predators exploit.

## Why existing tools don't solve it

Indexing-lookup tools exist and are free. So "is this journal in Scopus?" is already a
solved, non-novel problem. **The attack has moved past it.**

- **Indexjacking**: attackers hijack a real journal's database entry by substituting a
  lookalike URL. Scopus presence no longer proves authenticity — at least 67 compromised
  journals have been added to the Scopus list since 2013.
- **Conferences are far less tooled than journals.** Existing checkers are journal- and
  ISSN-centric. Conference vetting is manual checklists (Think.Check.Attend).
- **The single most damning check is never automated**: contacting a named keynote
  speaker to ask whether they actually agreed to appear. It's the recommended step in
  every guide and essentially nobody does it, because it means emailing strangers.

BonaFide targets exactly these three gaps.

## Users

Primary: a final-year engineering or PhD student who has just received an invitation
email and has no supervisor available to ask.

Secondary: a lab or department that wants a shared record of vetted and rejected venues.

## The core loop

1. User pastes an invitation email body, or a conference/journal URL. Nothing else.
2. Agent extracts every checkable claim the venue makes about itself.
3. Agent verifies each claim against an independent authoritative source.
4. Agent emails two named speakers asking whether they agreed to appear.
5. Agent returns a verdict with an evidence table where every row links to its source.
6. Agent drafts and sends the disposition — a decline for RED, a hold for AMBER.
7. When a speaker replies, the agent wakes up, classifies the reply, and updates the
   verdict without the user present.

## What makes the verdict trustworthy

Every finding is **falsifiable**. The user can click through and check it themselves.
A verdict nobody can audit is worthless for fraud, so the scoring is a visible rule, not
a model's opinion. "The site claims Scopus indexing; here is the official source record;
the URLs do not match" is a checkable statement. "The AI thinks this looks suspicious"
is not.

## Functional requirements

### Must have (the demo fails without these)

- **FR1** Accept invitation text or a URL as the sole input.
- **FR2** Extract structured claims: venue name, type, URL, ISSN, claimed indexing,
  fees, deadlines, promised acceptance turnaround, named editors/keynotes with
  affiliations, contact email, publisher.
- **FR3** Build the check plan at runtime from the extracted claims. No Scopus claim →
  no Scopus check. Named speakers present → speaker branch activates.
- **FR4** Run all Stage 1 (free registry) checks. See `SPEC.md`.
- **FR5** Compute a RED/AMBER/GREEN verdict from a deterministic rule.
- **FR6** Render an evidence table: claim, verdict, severity, source link, excerpt.
- **FR7** Send verification emails to up to two named speakers.
- **FR8** Poll IMAP, classify replies, reopen the case, update the verdict.
- **FR9** Draft and send the disposition email.

### Should have

- **FR10** Stage 2 Anakin checks: speaker reality, proceedings existence, prior reports.
- **FR11** Stream findings to the UI as they resolve (SSE), so the run reads as an agent
  working rather than a form submitting.
- **FR12** Persist cases; a shareable `/case/[id]` URL.

### Won't have (explicitly out of scope)

- Accounts, login, multi-user
- Bulk/batch processing
- A browser-automation checkout inspection (interesting, but not in two days)
- Any paid data source
- Mobile-specific layout

## Non-functional requirements

- **Full run completes in 20–30 seconds.** It must fit inside a three-minute demo with
  room to narrate over it.
- **Total Anakin spend under 60 credits across the whole hackathon** (budget: 300).
  Achieved by caching and by preferring free registries.
- **A single check failing degrades the result, never the run.**
- **Runs on localhost.** Deployment is optional polish.

## How this satisfies the hackathon brief

The brief asks for agents that *read the web, reason through problems, and take useful
action without a human clicking every button.*

- **Read**: live registry lookups, venue site, proceedings, institutional homepages, a
  web search sweep. Not a static dataset.
- **Reason**: the verdict exists only in the *disagreement between sources*. No single
  page contains it. Indexjacking detection in particular compares an authoritative
  record's URL against the domain that actually sent the mail — neither source states
  the conclusion alone.
- **Act**: sends real email to real third parties, interprets their unstructured
  replies, and disposes of the invitation. This is an irreversible external side effect,
  not a report.
- **Autonomous**: one input, then no human interaction until an outcome. The check plan
  is built at runtime, not fixed. The reply handler wakes the agent later, with the user
  absent, and can flip the verdict.

## Success criteria

1. A real predatory invitation produces a RED verdict with at least two fatal or major
   contradictions, each linked to a checkable source.
2. A real legitimate venue (use a well-known IEEE or ACM conference) produces GREEN.
   **If it doesn't, the product is useless — false positives are the failure mode that
   matters most here.**
3. A speaker reply arrives during the demo and visibly flips the verdict.
4. The repo is public, documented, and readable by an engineer in five minutes.
