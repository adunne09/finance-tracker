import { Schema } from "effect";

export class AppError extends Schema.TaggedError<AppError>()("AppError", {
  message: Schema.String,
  status: Schema.Int,
}) {}

export const Category = Schema.Literals([
  "housing",
  "utilities",
  "groceries",
  "dining",
  "transportation",
  "travel",
  "shopping",
  "entertainment",
  "health",
  "personal_care",
  "software",
  "memberships",
  "insurance",
  "taxes",
  "professional",
  "education",
  "gifts",
  "financial",
  "uncategorized",
]);

export const Movement = Schema.Literals([
  "expense",
  "refund",
  "income",
  "reimbursement",
  "transfer",
  "card_payment",
  "reward",
  "verification",
  "unknown",
]);

export const Classification = Schema.Struct({
  category: Category,
  movement: Movement,
  categoryConfidence: Schema.Number,
  movementConfidence: Schema.Number,
  model: Schema.String,
  version: Schema.String,
  source: Schema.optional(Schema.Literals(["jev", "pattern"])),
});

export type Classification = typeof Classification.Type;

export const Correction = Schema.Struct({
  category: Category,
  movement: Movement,
  label: Schema.String.check(Schema.isMaxLength(100)),
});

export type Correction = typeof Correction.Type;

export const Account = Schema.Struct({
  id: Schema.String,
  item: Schema.String,
  name: Schema.String,
  institution: Schema.String,
  mask: Schema.String,
  type: Schema.String,
  balance: Schema.NullOr(Schema.Int),
});

export type Account = typeof Account.Type;

export const Transaction = Schema.Struct({
  id: Schema.String,
  account: Schema.String,
  date: Schema.String,
  authorizedDate: Schema.NullOr(Schema.String),
  description: Schema.String,
  merchant: Schema.String,
  cents: Schema.Int,
  currency: Schema.String,
  pending: Schema.Boolean,
  pendingId: Schema.NullOr(Schema.String),
  bankCategory: Schema.String,
  bankConfidence: Schema.String,
});

export type Transaction = typeof Transaction.Type;

export const LedgerRow = Schema.Struct({
  transaction: Transaction,
  classification: Schema.NullOr(Classification),
  correction: Schema.NullOr(Correction),
});

export type LedgerRow = typeof LedgerRow.Type;

export const Connection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lastSync: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});

export const Snapshot = Schema.Struct({
  rows: Schema.Array(LedgerRow),
  accounts: Schema.Array(Account),
  connections: Schema.Array(Connection),
  processing: Schema.Boolean,
  unclassified: Schema.Int,
  classificationError: Schema.NullOr(Schema.String),
  lastClassification: Schema.NullOr(Schema.String),
});

export type Snapshot = typeof Snapshot.Type;

export const PlaidAccount = Schema.Struct({
  account_id: Schema.String,
  name: Schema.String,
  mask: Schema.NullOr(Schema.String),
  type: Schema.String,
  balances: Schema.Struct({ current: Schema.NullOr(Schema.Number) }),
});

export const PlaidTransaction = Schema.Struct({
  transaction_id: Schema.String,
  account_id: Schema.String,
  date: Schema.String,
  authorized_date: Schema.NullOr(Schema.String),
  name: Schema.String,
  merchant_name: Schema.NullOr(Schema.String),
  amount: Schema.Number,
  iso_currency_code: Schema.NullOr(Schema.String),
  pending: Schema.Boolean,
  pending_transaction_id: Schema.NullOr(Schema.String),
  personal_finance_category: Schema.NullOr(
    Schema.Struct({
      detailed: Schema.String,
      confidence_level: Schema.optional(Schema.String),
    }),
  ),
});

export const SyncPage = Schema.Struct({
  accounts: Schema.Array(PlaidAccount),
  added: Schema.Array(PlaidTransaction),
  modified: Schema.Array(PlaidTransaction),
  removed: Schema.Array(Schema.Struct({ transaction_id: Schema.String })),
  next_cursor: Schema.String,
  has_more: Schema.Boolean,
});

export type SyncPage = typeof SyncPage.Type;

export function moneyCents(amount: number): number {
  const result =
    Math.round((Math.abs(amount) + Number.EPSILON) * 100) * Math.sign(amount);

  if (!Number.isSafeInteger(result)) throw new Error("Invalid monetary amount");

  return result;
}
