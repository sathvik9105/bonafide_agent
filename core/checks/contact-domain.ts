// contact.domain — see SPEC.md. No network.
import { emailDomain, freeMailProvider, isAcademicDomain, registrableDomain } from '../normalise.ts';
import type { CheckContext, Claims, Finding } from '../types.ts';
import { finding, guard, quoteLine, type CheckMeta } from './finding.ts';

export const id = 'contact.domain';
export const stage = 1;

const meta: CheckMeta = { id, label: 'Contact email domain', severity: 'major' };

export function appliesTo(c: Claims): boolean {
  return c.contactEmail !== null;
}

export async function run({ claims, rawText }: CheckContext): Promise<Finding[]> {
  const email = claims.contactEmail ?? '';
  const claim = `Correspondence for ${claims.venueName} goes to ${email}`;
  return guard(meta, claim, async () => {
    const domain = emailDomain(email);
    const quoted = quoteLine(rawText, email) ?? email;
    if (!domain) {
      return [finding(meta, { claim, verdict: 'unverifiable', excerpt: quoted, note: 'The contact address could not be parsed.' })];
    }

    const free = freeMailProvider(domain);
    if (free) {
      return [
        finding(meta, {
          claim,
          verdict: 'contradicted',
          sourceUrl: claims.venueUrl,
          excerpt: quoted,
          note: `Submissions go to a ${free} mailbox; an indexed venue runs its mail from its own domain.`,
        }),
      ];
    }

    const contactReg = registrableDomain(domain);
    const venueReg = registrableDomain(claims.venueUrl);
    const excerpt = `Contact: ${email} | Venue site: ${claims.venueUrl ?? '(none given)'}`;

    if (isAcademicDomain(domain)) {
      return [
        finding(meta, {
          claim,
          verdict: 'supported',
          sourceUrl: claims.venueUrl,
          excerpt,
          note: `The contact address is on the academic domain ${contactReg}.`,
        }),
      ];
    }
    if (!venueReg) {
      return [
        finding(meta, {
          claim,
          verdict: 'unverifiable',
          excerpt,
          note: 'The invitation gives no venue website to compare the contact domain against.',
        }),
      ];
    }
    if (contactReg === venueReg) {
      return [
        finding(meta, {
          claim,
          verdict: 'supported',
          sourceUrl: claims.venueUrl,
          excerpt,
          note: `The contact address is on ${venueReg}, the same domain as the venue website.`,
        }),
      ];
    }
    return [
      finding(meta, {
        claim,
        verdict: 'contradicted',
        sourceUrl: claims.venueUrl,
        excerpt,
        note: `The contact address is on ${contactReg}, a different domain from the venue website on ${venueReg}.`,
      }),
    ];
  });
}
