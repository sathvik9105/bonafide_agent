import type { Check } from '../types.ts';
import * as contactDomain from './contact-domain.ts';
import * as domainAge from './domain-age.ts';
import * as identityUrlMatch from './identity-url-match.ts';
import * as indexingDoaj from './indexing-doaj.ts';
import * as indexingScopus from './indexing-scopus.ts';
import * as peopleReality from './people-reality.ts';
import * as proceedingsExist from './proceedings-exist.ts';
import * as reportsPrior from './reports-prior.ts';
import * as timelinePlausibility from './timeline-plausibility.ts';

export const checks: Check[] = [
  // Stage 1: free registries and pure reasoning.
  identityUrlMatch,
  indexingScopus,
  indexingDoaj,
  domainAge,
  contactDomain,
  timelinePlausibility,
  // Stage 2: Anakin, costs credits.
  peopleReality,
  proceedingsExist,
  reportsPrior,
];
