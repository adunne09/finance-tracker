import type {
  Account,
  Classification,
  LedgerRow,
  Transaction,
} from "./domain.ts";
import { evidence, questionVersion, sanitize } from "./ai-policy.ts";

// Controlled normalization, not model-generated regexes. Preserve meaningful
// product words (Eats, fuel, membership, etc.) even when the merchant is shared.
function normalize(text: string): string {
  return sanitize(text)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function patternKey(
  transaction: Transaction,
  account: Account,
): string | null {
  const input = evidence(transaction, account);

  // Generic P2P/deposits can represent unrelated purposes. Keep their exact
  // evidence caching, but do not generalize them into reusable patterns.
  if (/VENMO|ZELLE|CASH APP|BANK MOVEMENT/i.test(input.description))
    return null;
  const merchant = normalize(input.merchant);
  const description = normalize(input.description);

  if (
    !merchant &&
    !/EXPENSIFY|PAYROLL|DIVIDEND|INTEREST|EPAYMENT|E PAYMENT|AUTOPAY|CARD PAYMENT/.test(
      description,
    )
  )
    return null;

  return JSON.stringify([
    merchant,
    description,
    input.direction,
    input.accountType,
    input.bankCategory,
  ]);
}

export function learnPatterns(
  rows: readonly LedgerRow[],
  accounts: ReadonlyMap<string, Account>,
  model: string,
) {
  const patterns = new Map<string, Classification | null>();

  for (const row of rows) {
    const value = row.classification;
    const account = accounts.get(row.transaction.account);

    if (
      row.transaction.pending ||
      !account ||
      !value ||
      value.version !== questionVersion ||
      value.model !== model
    )
      continue;
    const key = patternKey(row.transaction, account);

    if (!key) continue;

    // An explicit correction vetoes a conflicting learned pattern; it never
    // silently becomes a household-wide rule. Label-only edits are irrelevant.
    if (
      row.correction &&
      (row.correction.movement !== value.movement ||
        row.correction.category !== value.category)
    ) {
      patterns.set(key, null);
      continue;
    }

    // Reused results must not become independent evidence for their own rule.
    if (value.source === "pattern") continue;
    const previous = patterns.get(key);

    if (
      value.movement === "unknown" ||
      value.category === "uncategorized" ||
      previous === null ||
      (previous &&
        (previous.movement !== value.movement ||
          previous.category !== value.category))
    ) {
      patterns.set(key, null);
    } else {
      patterns.set(key, previous ?? value);
    }
  }

  return patterns;
}
