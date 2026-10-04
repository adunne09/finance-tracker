import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { ChoiceQuestion } from "@typesafe-ai/sdk";
import { Context, Effect, Layer, Redacted, Schedule, Schema } from "effect";
import { Settings } from "./config.ts";
import { AppError, Classification } from "./domain.ts";
import {
  appleDigitalBilling,
  classificationKey,
  evidence,
  policyVersion,
} from "./ai-policy.ts";
import type { Evidence } from "./ai-policy.ts";
import { Store } from "./store.ts";
import { categoryCriteria } from "./taxonomy.ts";
import { aiQuestions } from "./telemetry.ts";
import { learnPatterns, patternKey } from "./patterns.ts";

export const movementCriteria = {
  expense:
    "A debit for goods, services, rent, fees, donations or tax; not a card balance payment or transfer.",
  refund:
    "A credit reversing an earlier purchase, returned goods or canceled service. Not card payments, rewards, payroll or reimbursements.",
  income:
    "A credit explicitly identified as salary/payroll, earned interest/dividends, government benefits or payment for work. A generic deposit is not sufficient.",
  reimbursement:
    "A credit repaying expenses, especially employer Expensify expense reports. Not wages or sales income.",
  transfer:
    "Movement between the household's own financial accounts where ownership is explicit. Do not assume Venmo/Zelle transfers are internal.",
  card_payment:
    "Explicit CREDIT CARD balance settlement or its reversal: Card Payment, AMEX EPAYMENT, Discover E-Payment, AppleCard GSBANK, or AUTOPAY credit to a card. Utility bill payments (AT&T), merchant names containing PAYMENT, fees and card purchases are expenses, NOT card payments.",
  reward:
    "Cashback, points redemption or promotional statement credit; not merchant refunds or bank interest.",
  verification: "Explicit microdeposit or account-verification adjustment.",
  unknown:
    "Insufficient evidence of purpose; generic P2P transfers or deposits, unidentified movement. Prefer over inventing income or internal ownership.",
};

export function questionsFor(input: Evidence) {
  const applePolicy = appleDigitalBilling(input)
    ? "Household categorization preference: Apple.com/bill, iTunes, App Store and iCloud digital charges belong in software, including digital subscriptions. This evidence is digital billing, not an Apple hardware purchase."
    : "Apple.com/bill or Apple billing without product is uncategorized.";

  return {
    movement: choice(
      {
        task: "Classify the cash movement of this transaction.",
        transaction: input,
        policy: [
          "Explicit Card Payment on a credit account is card_payment regardless of generic Plaid transfer hints. Adjustment - Payments on a credit account reverses a card payment and is card_payment.",
          "A debit at a purchase merchant or service provider is expense, including utility bill payments and merchants with PAYMENTS in their name. A purchase-category bank hint supports expense even if the merchant is unfamiliar.",
          "A credit on a credit account from a purchase merchant is refund, unless explicitly cashback or rewards. AUTOPAY credits are card payments.",
          "Expensify credits are reimbursements; payroll, benefits, interest and dividends received are income. Interest charged is an expense.",
          "Generic P2P/Venmo or deposits without purpose are unknown. Never assume internal ownership from a bank transfer hint.",
        ],
      },
      movementCriteria,
    ),
    category: choice(
      {
        task: "Select the spending category of this transaction, assuming it represents a purchase or a purchase refund.",
        transaction: input,
        policy: `Use merchant, description and Plaid hint together; explicit merchant/product evidence overrides incorrect bank hints. Classify TypeSafe, Cloudflare, OpenAI, Anthropic, Fal and other developer/AI tools as software, not consulting/education. Recurring media and retail memberships belong in memberships. Education means actual instruction. Costco warehouse and general retailers belong in shopping unless fuel or membership is explicit. Uber rides belong in transportation; Uber Eats belongs in dining. ${applePolicy} Refunds use the original merchant category. Never infer personal/business purpose, gifts from gift-shop names, or groceries from general retailers. This is merchant-level classification, not a claim about items purchased.`,
      },
      categoryCriteria,
    ),
  };
}

export async function judge(
  client: TypeSafeClient,
  inputs: Evidence[],
  model: string,
  signal: AbortSignal,
) {
  const questions: Record<string, ChoiceQuestion<Record<string, string>>> = {};

  for (const [index, input] of inputs.entries()) {
    const id = `transaction_${index}`;
    const q = questionsFor(input);
    questions[`${id}_movement`] = q.movement;
    questions[`${id}_category`] = q.category;
  }

  return client.systemOne({ state: {}, questions, model }, { signal });
}

const Cached = Schema.Struct({ key: Schema.String, body: Schema.String });

const make = Effect.gen(function* () {
  const settings = yield* Settings;
  const store = yield* Store;

  const classify = Effect.gen(function* () {
    const snapshot = yield* store.snapshot;
    const accounts = new Map(snapshot.accounts.map((a) => [a.id, a]));
    const candidates = new Map<string, Evidence>();
    const keys = [];
    const patterns = learnPatterns(snapshot.rows, accounts, settings.model);
    const reused = new Map<string, string>();

    for (const row of snapshot.rows) {
      if (row.transaction.pending) continue;
      const account = accounts.get(row.transaction.account);

      if (!account) continue;
      const input = evidence(row.transaction, account);

      if (
        row.classification?.version === policyVersion(input) &&
        row.classification.model === settings.model
      )
        continue;
      const key = classificationKey(input, settings.model);

      keys.push({ id: row.transaction.id, key });
      candidates.set(key, input);
      const pattern = patternKey(row.transaction, account);
      const learned = pattern ? patterns.get(pattern) : undefined;

      if (learned)
        reused.set(key, JSON.stringify({ ...learned, source: "pattern" }));
    }

    const entries = [];
    const cached = yield* store.query("SELECT key,body FROM model_cache");

    const cacheRows = yield* Schema.decodeUnknownEffect(Schema.Array(Cached))(
      cached.results,
    );

    const cache = new Map(cacheRows.map((row) => [row.key, row.body]));

    const updates = keys.map((entry) => ({
      ...entry,
      body: cache.get(entry.key) ?? reused.get(entry.key) ?? null,
    }));

    yield* store.query(
      `UPDATE transactions SET
      evidence_key=(SELECT json_extract(value,'$.key') FROM json_each(?) WHERE json_extract(value,'$.id')=transactions.id),
      classification=(SELECT json_extract(value,'$.body') FROM json_each(?) WHERE json_extract(value,'$.id')=transactions.id)
      WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`,
      JSON.stringify(updates),
      JSON.stringify(updates),
      JSON.stringify(updates),
    );

    for (const [key, input] of candidates) {
      if (!cache.has(key) && !reused.has(key)) entries.push({ key, input });
    }

    const client = new TypeSafeClient({
      apiKey: Redacted.value(settings.apiKey),
      defaultModel: settings.model,
      timeout: 20000,
      retry: { maxRetries: 0 },
      logLevel: "off",
    });

    let count = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // Bound each run to fit the Workers Free D1 query budget, including all three syncs.
    for (let start = 0; start < Math.min(entries.length, 225); start += 25) {
      const chunk = entries.slice(start, start + 25);

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          judge(
            client,
            chunk.map((e) => e.input),
            settings.model,
            signal,
          ),
        catch: () =>
          new AppError({
            message: "Automatic classification will retry on the next sync",
            status: 502,
          }),
      }).pipe(
        Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
        Effect.withSpan("jev.classifyBatch"),
      );

      const judgments = [];

      for (const [index, entry] of chunk.entries()) {
        const movement = response.answers[`transaction_${index}_movement`];
        const category = response.answers[`transaction_${index}_category`];

        if (!movement || !category)
          return yield* new AppError({
            message: "Incomplete classification response",
            status: 502,
          });

        const value = yield* Schema.decodeUnknownEffect(Classification)({
          category: category.choice,
          movement: movement.choice,
          categoryConfidence: category.confidence,
          movementConfidence: movement.confidence,
          model: response.model,
          version: policyVersion(entry.input),
          source: "jev",
        });

        const body = JSON.stringify(value);
        judgments.push({ key: entry.key, body });
      }

      const encoded = JSON.stringify(judgments);

      yield* store.batch([
        store.db
          .prepare(
            `INSERT INTO model_cache(key,body) SELECT json_extract(value,'$.key'),json_extract(value,'$.body') FROM json_each(?) WHERE true ON CONFLICT(key) DO UPDATE SET body=excluded.body`,
          )
          .bind(encoded),
        store.db
          .prepare(
            `UPDATE transactions SET classification=(SELECT json_extract(value,'$.body') FROM json_each(?) WHERE json_extract(value,'$.key')=transactions.evidence_key) WHERE evidence_key IN (SELECT json_extract(value,'$.key') FROM json_each(?)) AND pending=0 AND removed=0`,
          )
          .bind(encoded, encoded),
      ]);
      count += chunk.length;
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      yield* Effect.succeed(chunk.length * 2).pipe(
        Effect.trackSuccesses(aiQuestions),
      );
    }

    yield* store.query(
      "INSERT INTO metadata(key,value) VALUES('last_classification',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      new Date().toISOString(),
    );
    yield* store.query("DELETE FROM metadata WHERE key='classification_error'");
    yield* Effect.logInfo("Automatic classification complete", {
      judgments: count * 2,
      exactCacheHits: keys.filter((entry) => cache.has(entry.key)).length,
      patternHits: keys.filter(
        (entry) => !cache.has(entry.key) && reused.has(entry.key),
      ).length,
      inputTokens,
      outputTokens,
    });

    return { classified: count };
  }).pipe(Effect.withSpan("classification.run"));

  return { classify };
});

export class Classifier extends Context.Service<
  Classifier,
  Effect.Success<typeof make>
>()("finance/Classifier") {
  static readonly layer = Layer.effect(Classifier, make);
}
