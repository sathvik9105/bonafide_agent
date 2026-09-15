// domain.age — see docs/SPEC.md. RDAP registration age, plus a trivial publisher-lookalike flag.
import { domainLookupUrl, rdapDomain } from '../../providers/registries.ts';
import { DAY_MS, registrableDomain } from '../normalise.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, type CheckMeta } from './finding.ts';

export const id = 'domain.age';
export const stage = 1;

const meta: CheckMeta = { id, label: 'Website domain age', severity: 'major' };
const lookalikeMeta: CheckMeta = { id, label: 'Publisher lookalike domain', severity: 'minor' };

const PUBLISHER_DOMAINS: Record<string, string[]> = {
  elsevier: ['elsevier.com', 'sciencedirect.com'],
  sciencedirect: ['sciencedirect.com'],
  scopus: ['scopus.com', 'elsevier.com'],
  springer: ['springer.com', 'springernature.com', 'nature.com'],
  wiley: ['wiley.com'],
  ieee: ['ieee.org'],
  acm: ['acm.org'],
  tandfonline: ['tandfonline.com'],
  taylorfrancis: ['taylorfrancis.com', 'tandfonline.com'],
  sagepub: ['sagepub.com'],
  mdpi: ['mdpi.com'],
  plos: ['plos.org'],
  frontiersin: ['frontiersin.org'],
  hindawi: ['hindawi.com'],
  emerald: ['emerald.com', 'emeraldgrouppublishing.com'],
  clarivate: ['clarivate.com', 'webofscience.com'],
};
const REAL_DOMAINS = new Set(Object.values(PUBLISHER_DOMAINS).flat());

export function appliesTo(c: Claims): boolean {
  return c.venueUrl !== null;
}

function lookalikeOf(domain: string): { brand: string; real: string[] } | null {
  if (REAL_DOMAINS.has(domain)) return null;
  const segments = domain.split('.')[0].split(/[-_\d]+/).filter(Boolean);
  for (const [brand, real] of Object.entries(PUBLISHER_DOMAINS)) {
    const hit = segments.some((s) => s === brand || (brand.length >= 6 && (s.startsWith(brand) || s.endsWith(brand))));
    if (hit) return { brand, real };
  }
  return null;
}

function editionPhrase(venueName: string): { phrase: string; qualifies: boolean } | null {
  const m = venueName.match(/\b(\d{1,3})(?:st|nd|rd|th)\b(\s+annual\b)?/i);
  if (m) return { phrase: m[0], qualifies: Number(m[1]) >= 3 || Boolean(m[2]) };
  const annual = venueName.match(/\bannual\b/i);
  return annual ? { phrase: annual[0], qualifies: true } : null;
}

export async function run({ claims, now }: CheckContext): Promise<Finding[]> {
  const claim = `${claims.venueName} runs from ${claims.venueUrl}`;
  const domain = registrableDomain(claims.venueUrl);
  if (!domain) {
    return [finding(meta, { claim, verdict: 'unverifiable', note: 'The website address could not be parsed.' })];
  }

  const findings: Finding[] = [];
  const lookalike = lookalikeOf(domain);
  if (lookalike) {
    findings.push(
      finding(lookalikeMeta, {
        claim,
        verdict: 'contradicted',
        sourceUrl: claims.venueUrl,
        excerpt: `Invitation domain: ${domain} | ${lookalike.brand} domains: ${lookalike.real.join(', ')}`,
        note: `${domain} borrows the "${lookalike.brand}" name but is not one of that publisher's domains.`,
      }),
    );
  }

  const age = await guard(meta, claim, async () => {
    const sourceUrl = domainLookupUrl(domain);
    const rdap = await rdapDomain(domain);
    if (!rdap?.registeredAt) {
      return [
        finding(meta, { claim, verdict: 'unverifiable', sourceUrl, note: `No RDAP registration record was found for ${domain}.` }),
      ];
    }
    const months = (now.getTime() - new Date(rdap.registeredAt).getTime()) / (DAY_MS * 30.44);
    const whole = Math.max(0, Math.floor(months));
    const excerpt = `${domain} registration date: ${rdap.registeredAt.slice(0, 10)} (checked ${now.toISOString().slice(0, 10)})`;
    const base = { claim, sourceUrl, excerpt };
    const edition = editionPhrase(claims.venueName);

    if (months < 6) {
      return [
        finding(meta, {
          ...base,
          verdict: 'contradicted',
          note: `${domain} was registered ${whole} months ago, too recently for an established venue.`,
        }),
      ];
    }
    if (months < 12 && edition?.qualifies) {
      return [
        finding(meta, {
          ...base,
          verdict: 'contradicted',
          note: `A venue billing itself as "${edition.phrase}" runs on a domain registered ${whole} months ago, which cannot match its claimed history.`,
        }),
      ];
    }
    if (months > 36) {
      return [
        finding(meta, { ...base, verdict: 'supported', note: `${domain} has been registered for ${Math.floor(months / 12)} years.` }),
      ];
    }
    return [
      finding(meta, {
        ...base,
        verdict: 'unverifiable',
        severity: 'info',
        note: `${domain} is ${whole} months old, neither new enough to flag nor old enough to count as established.`,
      }),
    ];
  });

  return [...findings, ...age];
}
