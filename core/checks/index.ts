import type { Check } from '../types.ts';
import * as contactDomain from './contact-domain.ts';
import * as domainAge from './domain-age.ts';
import * as identityUrlMatch from './identity-url-match.ts';
import * as indexingDoaj from './indexing-doaj.ts';
import * as indexingScopus from './indexing-scopus.ts';
import * as timelinePlausibility from './timeline-plausibility.ts';

export const checks: Check[] = [
  identityUrlMatch,
  indexingScopus,
  indexingDoaj,
  domainAge,
  contactDomain,
  timelinePlausibility,
];
