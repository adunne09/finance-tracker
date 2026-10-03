import { createHash } from "node:crypto";
import type { Account, Transaction } from "./domain.ts";

export const questionVersion = "plaid-household-v6";

export function sanitize(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/(?:HTTPS?:\/\/|WWW\.)\S+/gi, "")
    .replace(/\b\d{3}[- .]\d{3}[- .]\d{4}\b/g, "")
    .replace(/\b(?=(?:[A-Z_-]*\d){3})[A-Z0-9_-]{5,}\b/gi, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function evidence(transaction: Transaction, account: Account) {
  let description = transaction.description;
  let merchant = transaction.merchant;

  // Counterparty identities add no useful category evidence. Retain only movement signals.
  if (
    /VENMO|ZELLE|CASH APP|TRANSFER|DEPOSIT|PAYROLL|DIVIDEND|INTEREST|EPAYMENT|E-PAYMENT|AUTOPAY|PAYMENT RECEIVED|EXPENSIFY|BENEFITS/i.test(
      description,
    ) ||
    /^(TRANSFER_|INCOME_)/.test(transaction.bankCategory)
  ) {
    const signals = description.match(
      /VENMO|ZELLE|CASH APP|TRANSFER|DEPOSIT|PAYROLL|DIVIDEND|INTEREST|EPAYMENT|E-PAYMENT|AUTOPAY|PAYMENT RECEIVED|CARD PAYMENT|AMEX|DISCOVER|APPLECARD|VISA|EXPENSIFY|BENEFITS/gi,
    );

    description = signals?.join(" ") ?? "Bank movement";
    merchant = "";
  }

  return {
    merchant: sanitize(merchant),
    description: sanitize(description),
    direction: transaction.cents > 0 ? "credit" : "debit",
    accountType: account.type,
    bankCategory: transaction.bankCategory,
    bankConfidence: transaction.bankConfidence,
  };
}

export type Evidence = ReturnType<typeof evidence>;

export function classificationKey(input: Evidence, model: string): string {
  return createHash("sha256")
    .update(JSON.stringify([questionVersion, model, input]))
    .digest("hex");
}
