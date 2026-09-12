# BonaFide — Demo Script

Three minutes. The goal is not to explain the architecture. It is to make a judge feel
the problem in the first fifteen seconds and see an agent do something irreversible in
the last forty-five.

## Before you start

- [ ] Demo video recorded and uploaded (do this the moment Phase 2 works)
- [ ] `MAIL_MODE=live`
- [ ] The "keynote" address is one you control — a friend or second account — with the
      reply already drafted and ready to send on cue
- [ ] Both fixtures loaded: one predatory invitation, one genuine IEEE/ACM CFP
- [ ] A cached run ready as fallback if the network dies
- [ ] Browser zoomed so the evidence table is readable on a projector

## 0:00–0:20 — The problem, in their words not yours

> "Last month a friend in my department got this email. Accepted in 48 hours,
> Scopus-indexed, ₹28,000 registration fee. It's fake. There are over fifteen thousand
> journals like this, and one study found a single junior researcher got a hundred and
> sixty-two of these invitations in six months."

Have the invitation on screen while you say it. Don't describe the product yet.

## 0:20–0:35 — The insight

> "You can look up whether a journal is in Scopus. Free tools do that. But predators
> hijack real journals now — they clone the site and swap the URL in the database. So
> the indexing check passes and the venue is still fake.
>
> The one check that actually settles it is asking the keynote speaker whether they
> agreed to be there. Every guide recommends it. Nobody does it, because it means
> emailing strangers."

This is your whole differentiation. Say it before the demo, so the judge knows what to
watch for.

## 0:35–0:50 — One input

Paste the invitation. Hit Verify. While claims extract:

> "One input. It reads the email, pulls out every claim the venue makes about itself,
> and builds a check plan from those claims — no Scopus claim, no Scopus check."

Point at the plan panel as it populates. This is the agentic bit and it's otherwise
invisible.

## 0:50–1:40 — Findings land live

Narrate as rows appear. Do not read the table aloud — pick the two strongest:

> "The site says Scopus-indexed. Here's Scopus's own record for that journal. Different
> domain. That's the hijack.
>
> Domain registered nineteen days ago — for a conference calling itself the fifteenth
> annual."

Then click one source link and let the judge see the real registry page.

> "Every row links to the source. You can check any of these yourself. That's
> deliberate — a fraud verdict nobody can audit is worthless."

## 1:40–2:10 — The act

> "It's also done something. It found two people listed as keynotes, found their
> university pages, and emailed them."

Show the sent message. Then switch to the mailbox.

> "One replied."

Read the reply. Switch back — **the verdict flips amber to red on screen**, without you
touching anything.

> "That happened while I was talking. Nobody clicked anything."

This is the moment. Let it sit for two seconds before continuing.

## 2:10–2:35 — The false-positive proof

Load the legitimate IEEE conference. Run it.

> "And it isn't just a red-light generator."

Green. Move on quickly — ten seconds is enough. This pre-empts the question every
thoughtful judge is about to ask, and answering it before they ask is worth more than
answering it after.

## 2:35–3:00 — Close

> "Built solo in two days. Anakin for the web reads, free registries where they're more
> reliable, and about twelve credits per run. The repo has an engineering log of every
> place the API surprised me.
>
> The part I'd keep building is the callback. An agent that reads pages is common now.
> An agent that contacts a human witness and changes its mind based on the answer is
> the part I haven't seen anywhere else."

## Questions to have answers ready for

**"How do you know it's not just guessing?"**
The verdict is five lines of deterministic code — show `scoring.ts`. The model extracts
claims and writes sentences. It doesn't vote.

**"What about false positives on small regional conferences?"**
That's why amber exists and means *insufficient evidence*, not *suspicious*. Show a
genuine obscure venue producing amber rather than red.

**"Isn't this just a scraper with an LLM on top?"**
The verdict doesn't exist on any page it scrapes. It's in the disagreement between a
registry record and the site that sent the mail. And it emails people.

**"Why not just use Scopus's own site?"**
Because indexjacking means the Scopus entry itself can point at the fake. The check that
catches it is comparing that entry's URL to the sender's domain — which is exactly what
nothing else does.

## Things that will go wrong, and what to do

- **Live run is slow** → keep talking about the insight; the findings stream in behind
  you. Never watch the screen in silence.
- **A check errors** → it shows unverifiable, which is the designed behaviour. Say so:
  "that one couldn't reach its source, so it reports unverified rather than guessing."
  This lands as rigour, not failure.
- **Network dies** → switch to the cached run. Say you're using cached results. Don't
  pretend.
- **Everything dies** → play the video. This is why you recorded it first.
