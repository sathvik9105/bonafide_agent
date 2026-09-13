// Deterministic publisher-name comparison for identity.url_match's Scopus fallback.
// Conservative by design: only 'match' and 'mismatch' are decisive; anything else is 'near-miss'.
import { editDistance, stripDiacritics } from './normalise.ts';

export type PublisherOutcome = 'match' | 'mismatch' | 'near-miss';
export type PublisherComparison = {
  outcome: PublisherOutcome;
  claimed: string;
  registry: string;
  reason: string;
};

const STOPWORDS = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'an', 'de', 'la', 'und', 'et']);

const CORPORATE = new Set([
  'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'gmbh', 'co', 'company', 'corp', 'corporation',
  'plc', 'bv', 'nv', 'sa', 'ag', 'srl', 'spa', 'pvt', 'private', 'pte', 'pty', 'kg', 'kgaa', 'oy', 'ab',
  'publishing', 'publishers', 'publisher', 'publications', 'publication', 'press', 'group', 'media',
  'house', 'sons', 'verlag', 'editions', 'imprint', 'holdings', 'enterprises', 'services',
]);

const GENERIC = new Set([
  'science', 'sciences', 'scientific', 'research', 'academic', 'academy', 'international', 'global',
  'journal', 'journals', 'world', 'open', 'access', 'society', 'association', 'institute', 'institution',
  'university', 'college', 'national', 'american', 'european', 'asian', 'africa', 'african', 'indian',
  'india', 'china', 'chinese', 'advanced', 'engineering', 'technology', 'technologies', 'medical',
  'medicine', 'health', 'education', 'educational', 'knowledge', 'innovation', 'innovative', 'foundation',
  'center', 'centre', 'council', 'network',
]);

type Variant = { meaningful: string[]; core: string[]; initials: Set<string> };

function words(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[&+]/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function variant(name: string): Variant {
  const all = words(name);
  const meaningful = all.filter((w) => !STOPWORDS.has(w) && !CORPORATE.has(w));
  const initials = new Set<string>();
  const filters = [
    (w: string) => !STOPWORDS.has(w) && !CORPORATE.has(w),
    (w: string) => !CORPORATE.has(w),
    (w: string) => !STOPWORDS.has(w),
  ];
  for (const keep of filters) {
    const kept = all.filter(keep);
    if (kept.length >= 2) initials.add(kept.map((w) => w[0]).join(''));
  }
  return { meaningful, core: meaningful.filter((w) => !GENERIC.has(w)), initials };
}

/** The full name without parentheticals, plus each parenthetical as its own alias. */
function variants(name: string): Variant[] {
  const aliases = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  return [name.replace(/\([^)]*\)/g, ' '), ...aliases].map(variant).filter((v) => v.meaningful.length > 0);
}

function spelledAlike(x: string, y: string): boolean {
  if (x.length < 4 || y.length < 4) return false;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return editDistance(x, y) <= (Math.max(x.length, y.length) >= 8 ? 2 : 1);
}

function isAcronymOf(full: Variant, short: Variant): boolean {
  return short.meaningful.length === 1 && full.initials.has(short.meaningful[0]);
}

function compareVariants(a: Variant, b: Variant): { outcome: PublisherOutcome; reason: string } {
  if (isAcronymOf(a, b) || isAcronymOf(b, a)) return { outcome: 'match', reason: 'acronym' };

  const aCore = new Set(a.core);
  const bCore = new Set(b.core);
  const sharedCore = a.core.filter((w) => bCore.has(w));
  if (sharedCore.length > 0) {
    const contained = a.core.every((w) => bCore.has(w)) || b.core.every((w) => aCore.has(w));
    return contained
      ? { outcome: 'match', reason: `shared distinctive words: ${sharedCore.join(', ')}` }
      : { outcome: 'near-miss', reason: `partial overlap: ${sharedCore.join(', ')}` };
  }

  const bMeaningful = new Set(b.meaningful);
  const sharedGeneric = a.meaningful.filter((w) => bMeaningful.has(w));
  if (sharedGeneric.length > 0) {
    return { outcome: 'near-miss', reason: `only generic words in common: ${sharedGeneric.join(', ')}` };
  }
  if (a.core.some((x) => b.core.some((y) => spelledAlike(x, y)))) {
    return { outcome: 'near-miss', reason: 'similar spelling' };
  }
  return { outcome: 'mismatch', reason: 'no words in common' };
}

const RANK: Record<PublisherOutcome, number> = { match: 2, 'near-miss': 1, mismatch: 0 };

/** Compare a claimed publisher against every registry name; the most favourable outcome wins. */
export function comparePublishers(claimed: string, registryNames: string[]): PublisherComparison {
  const claimedVariants = variants(claimed);
  let best: PublisherComparison = {
    outcome: 'near-miss',
    claimed,
    registry: registryNames[0] ?? '(none listed)',
    reason: 'no comparable publisher names',
  };
  let bestRank = -1;
  for (const registry of registryNames) {
    for (const a of claimedVariants) {
      for (const b of variants(registry)) {
        const r = compareVariants(a, b);
        if (RANK[r.outcome] > bestRank) {
          best = { ...r, claimed, registry };
          bestRank = RANK[r.outcome];
        }
      }
    }
  }
  return best;
}
