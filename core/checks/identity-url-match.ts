// identity.url_match — see docs/SPEC.md. Retraction Watch hijacked-journal list first (fatal, authoritative);
// then DOAJ homepage vs invitation site (fatal); Scopus publisher fallback when DOAJ has no homepage (major).
import { hijackedJournalCheck, type HijackedMatch } from '../../providers/anakin.ts';
import {
  doajLookup,
  scopusByIssn,
  scopusByTitle,
  scopusSourceUrl,
  type DoajRecord,
  type ScopusRecord,
} from '../../providers/registries.ts';
import { registrableDomain } from '../normalise.ts';
import { comparePublishers } from '../publisher.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';

export const id = 'identity.url_match';
export const stage = 1;

const meta: CheckMeta = { id, label: 'Venue identity vs registry record', severity: 'fatal' };
const TITLE_MATCH = 0.9;

export function appliesTo(c: Claims): boolean {
  return c.claimedIndexing.length > 0 || c.issn !== null;
}

export async function run({ claims, ledger }: CheckContext): Promise<Finding[]> {
  const claim =
    `${claims.venueName}${claims.issn ? ` (ISSN ${claims.issn})` : ''} is the registered venue` +
    (claims.venueUrl ? ` at ${claims.venueUrl}` : '');
  return guard(meta, claim, async () => {
    const title = claims.venueType === 'conference' ? null : claims.venueName;

    // Authoritative external list, checked first: no LLM judgment involved. A failure (caught
    // here, not by the outer guard) or "not on the list" both fall straight through to the
    // DOAJ/Scopus comparison below, unchanged.
    const hijackQuery = claims.issn ?? title;
    if (hijackQuery) {
      try {
        const { onList, matches } = await hijackedJournalCheck(hijackQuery, { ledger, checkId: id });
        if (onList && matches.length > 0) return [hijackedFinding(claim, matches[0])];
      } catch {
        // Supplementary signal; the DOAJ/Scopus comparison below still runs.
      }
    }

    const { record: doaj } = await doajLookup({ issn: claims.issn, title });
    if (doaj?.homepage) return [compareHomepage(claims, claim, doaj, doaj.homepage)];

    let scopus: ScopusRecord | null = null;
    if (claims.issn) scopus = await scopusByIssn(claims.issn);
    else if (title) {
      const hit = await scopusByTitle(title);
      scopus = hit && hit.score >= TITLE_MATCH ? hit.record : null;
    }
    if (scopus) return [comparePublisher(claims, claim, scopus)];

    return [
      finding(meta, {
        claim,
        verdict: 'unverifiable',
        note: 'Neither DOAJ nor Scopus has a record for this venue, so there is no registry identity to compare against.',
      }),
    ];
  });
}

const HIJACKED_LIST_URL = 'https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/';

function hijackedFinding(claim: string, m: HijackedMatch): Finding {
  return finding(meta, {
    claim,
    verdict: 'contradicted',
    sourceUrl: HIJACKED_LIST_URL,
    excerpt:
      `Retraction Watch: "${m.title}" is a hijacked clone of "${m.legitimateTitle}"` +
      `${m.legitimateIssn ? ` (ISSN ${m.legitimateIssn})` : ''}${m.hijackedUrl ? ` at ${m.hijackedUrl}` : ''}`,
    note: `This venue matches a known hijacked-journal record on Retraction Watch's list — the real journal is "${m.legitimateTitle}", not this one.`,
  });
}

function compareHomepage(claims: Claims, claim: string, doaj: DoajRecord, homepage: string): Finding {
  const registryDomain = registrableDomain(homepage);
  const venueDomain = registrableDomain(claims.venueUrl);
  const base = {
    claim,
    sourceUrl: doaj.sourceUrl,
    excerpt: `DOAJ homepage: ${homepage} | Invitation site: ${claims.venueUrl ?? '(none given)'}`,
  };
  if (!venueDomain || !registryDomain) {
    return finding(meta, {
      ...base,
      verdict: 'unverifiable',
      note: `DOAJ lists "${doaj.title}" at ${homepage}, but the invitation gives no website to compare it with.`,
    });
  }
  if (venueDomain === registryDomain) {
    return finding(meta, {
      ...base,
      verdict: 'supported',
      note: `The invitation's website is on ${venueDomain}, the same domain DOAJ lists for "${doaj.title}".`,
    });
  }
  return finding(meta, {
    ...base,
    verdict: 'contradicted',
    note: `DOAJ lists "${doaj.title}" at ${registryDomain}, but this invitation points to ${venueDomain}, the signature of a hijacked journal.`,
  });
}

function comparePublisher(claims: Claims, claim: string, rec: ScopusRecord): Finding {
  const registryNames = [rec.publisher, rec.publisherGroup].filter((n): n is string => Boolean(n));
  const base = { claim, severity: 'major' as const, sourceUrl: scopusSourceUrl(rec) };
  if (!claims.publisher) {
    return finding(meta, {
      ...base,
      verdict: 'unverifiable',
      excerpt: `Scopus publisher: ${registryNames[0] ?? '(none listed)'} | Invitation publisher: (none named)`,
      note: `Scopus lists "${rec.title}" but records no homepage, and the invitation names no publisher to compare.`,
    });
  }
  const cmp = comparePublishers(claims.publisher, registryNames);
  const excerpt = `Scopus publisher: ${cmp.registry} | Invitation publisher: ${claims.publisher}`;
  switch (cmp.outcome) {
    case 'match':
      return finding(meta, {
        ...base,
        excerpt,
        verdict: 'supported',
        note: `The invitation's publisher matches Scopus's record for "${rec.title}"; Scopus has no homepage URL, so the website itself was not compared.`,
      });
    case 'mismatch':
      return finding(meta, {
        ...base,
        excerpt,
        verdict: 'contradicted',
        note: `Scopus records "${rec.title}" as published by ${cmp.registry}, not ${claims.publisher}.`,
      });
    default:
      return finding(meta, {
        ...base,
        excerpt,
        verdict: 'unverifiable',
        note: `The invitation's publisher resembles Scopus's record but is not clearly the same (${cmp.reason}), so this is left undecided.`,
      });
  }
}
