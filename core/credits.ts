// Per-run Anakin credit ledger. A paid call reserves its price first, refunds whatever wasn't charged,
// and is refused once MAX_CREDITS_PER_RUN would be exceeded, so a runaway loop can't drain the budget.

export type CreditAction = 'scrape' | 'search';

export type CreditEntry = {
  checkId: string;
  action: CreditAction;
  target: string;
  credits: number;
  cached: boolean; // served from our disk cache: always 0 credits
};

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export type CreditLedger = {
  limit: number;
  spent: () => number;
  spentBy: (checkId: string) => number;
  entries: () => CreditEntry[];
  reserve: (credits: number, what: string) => void;
  refund: (credits: number) => void;
  record: (entry: CreditEntry) => void;
};

export type CreditSummary = { spent: number; limit: number; byCheck: Record<string, number>; calls: CreditEntry[] };

function defaultLimit(): number {
  const n = Number(process.env.MAX_CREDITS_PER_RUN);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export function createLedger(limit: number = defaultLimit()): CreditLedger {
  let committed = 0;
  const log: CreditEntry[] = [];
  return {
    limit,
    spent: () => committed,
    spentBy: (checkId) => log.filter((e) => e.checkId === checkId).reduce((n, e) => n + e.credits, 0),
    entries: () => [...log],
    reserve(credits, what) {
      if (committed + credits > limit) {
        throw new BudgetExceededError(`credit budget reached (${committed} of ${limit} spent) before ${what}`);
      }
      committed += credits;
    },
    refund(credits) {
      committed -= credits;
    },
    record(entry) {
      log.push(entry);
    },
  };
}

export function summarise(ledger: CreditLedger): CreditSummary {
  const byCheck: Record<string, number> = {};
  for (const e of ledger.entries()) byCheck[e.checkId] = (byCheck[e.checkId] ?? 0) + e.credits;
  return { spent: ledger.spent(), limit: ledger.limit, byCheck, calls: ledger.entries() };
}
