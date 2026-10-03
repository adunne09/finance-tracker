import { Context, Effect, Layer, Redacted, Schema, Schedule } from "effect";
import { Settings } from "./config.ts";
import type { Item } from "./config.ts";
import { AppError, moneyCents, SyncPage } from "./domain.ts";
import type { Account, Transaction } from "./domain.ts";
import { Store } from "./store.ts";
import { classificationKey, evidence } from "./ai-policy.ts";

class PlaidError extends Schema.TaggedError<PlaidError>()("PlaidError", {
  code: Schema.String,
}) {}

const ErrorBody = Schema.Struct({ error_code: Schema.String });

const CursorRow = Schema.Struct({ cursor: Schema.String });

const make = Effect.gen(function* () {
  const settings = yield* Settings;
  const store = yield* Store;

  const syncItem = (item: Item) =>
    Effect.gen(function* () {
      yield* store.query(
        "INSERT INTO connections(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
        item.id,
        item.name,
      );

      const cursors = yield* store.query(
        "SELECT cursor FROM connections WHERE id=?",
        item.id,
      );

      const saved = yield* Schema.decodeUnknownEffect(Schema.Array(CursorRow))(
        cursors.results,
      );

      const initialCursor = saved[0]?.cursor ?? "";

      // Retry the whole pagination sequence on mutation. Nothing is committed until the final page.
      const pull = Effect.gen(function* () {
        let cursor = initialCursor;
        let more = true;
        const added: SyncPage["added"][number][] = [];
        const removed = new Set<string>();
        const accountMap = new Map<string, Account>();

        for (let pageNumber = 0; more; pageNumber++) {
          if (pageNumber >= 100)
            return yield* new PlaidError({ code: "PAGINATION_LIMIT" });

          const page = yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(
                "https://production.plaid.com/transactions/sync",
                {
                  method: "POST",
                  signal,
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    client_id: Redacted.value(settings.clientId),
                    secret: Redacted.value(settings.secret),
                    access_token: item.token,
                    cursor,
                    count: 500,
                    options: { personal_finance_category_version: "v2" },
                  }),
                },
              );

              const json = await response.json();

              if (!response.ok) {
                const err = Schema.decodeUnknownSync(ErrorBody)(json);
                throw new PlaidError({ code: err.error_code });
              }

              return Schema.decodeUnknownSync(SyncPage)(json);
            },
            catch: (error) =>
              error instanceof PlaidError
                ? error
                : new PlaidError({ code: "CONNECTION_FAILED" }),
          }).pipe(
            Effect.timeout("25 seconds"),
            Effect.withSpan("plaid.transactions.sync"),
          );

          for (const account of page.accounts)
            accountMap.set(account.account_id, {
              id: account.account_id,
              item: item.id,
              name: account.name,
              institution: item.name,
              mask: account.mask ?? "",
              type: account.type,
              balance:
                account.balances.current === null
                  ? null
                  : moneyCents(account.balances.current),
            });
          added.push(...page.added, ...page.modified);

          for (const row of page.removed) removed.add(row.transaction_id);
          cursor = page.next_cursor;
          more = page.has_more;
        }

        return { cursor, added, removed, accountMap };
      }).pipe(
        Effect.retry({
          times: 2,
          schedule: Schedule.exponential("500 millis"),
          while: (e) =>
            e instanceof PlaidError &&
            e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        }),
      );

      const pulled = yield* pull;
      const statements = [];

      statements.push(
        store.db
          .prepare(
            `INSERT INTO accounts(id,item,body)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.item'),value FROM json_each(?) WHERE true
        ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
          )
          .bind(JSON.stringify([...pulled.accountMap.values()])),
      );

      const changes = [];

      for (const row of pulled.added) {
        const account = pulled.accountMap.get(row.account_id);

        if (!account)
          return yield* new AppError({
            message: "Plaid returned an unknown account",
            status: 502,
          });

        const tx: Transaction = {
          id: row.transaction_id,
          account: row.account_id,
          date: row.date,
          authorizedDate: row.authorized_date,
          description: row.name,
          merchant: row.merchant_name ?? "",
          cents: -moneyCents(row.amount),
          currency: row.iso_currency_code ?? "UNKNOWN",
          pending: row.pending,
          pendingId: row.pending_transaction_id,
          bankCategory: row.personal_finance_category?.detailed ?? "",
          bankConfidence: row.personal_finance_category?.confidence_level ?? "",
        };

        const key = classificationKey(evidence(tx, account), settings.model);
        changes.push({ tx, key });

        if (tx.pendingId) pulled.removed.add(tx.pendingId);
      }

      statements.push(
        store.db
          .prepare(
            `INSERT INTO transactions(id,account,date,body,pending,evidence_key,correction)
        SELECT json_extract(value,'$.tx.id'),json_extract(value,'$.tx.account'),json_extract(value,'$.tx.date'),
        json_extract(value,'$.tx'),json_extract(value,'$.tx.pending'),json_extract(value,'$.key'),
        (SELECT correction FROM transactions WHERE id=json_extract(value,'$.tx.pendingId'))
        FROM json_each(?) WHERE true
        ON CONFLICT(id) DO UPDATE SET account=excluded.account,date=excluded.date,body=excluded.body,
        pending=excluded.pending,removed=0,
        classification=CASE WHEN transactions.evidence_key=excluded.evidence_key THEN transactions.classification ELSE NULL END,
        evidence_key=excluded.evidence_key,correction=COALESCE(transactions.correction,excluded.correction)`,
          )
          .bind(JSON.stringify(changes)),
      );
      statements.push(
        store.db
          .prepare(
            "UPDATE transactions SET removed=1 WHERE id IN (SELECT value FROM json_each(?))",
          )
          .bind(JSON.stringify([...pulled.removed])),
      );
      statements.push(
        store.db
          .prepare(
            "UPDATE connections SET cursor=?,last_sync=?,error=NULL WHERE id=?",
          )
          .bind(pulled.cursor, new Date().toISOString(), item.id),
      );
      yield* store.batch(statements);

      return { changed: pulled.added.length, removed: pulled.removed.size };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const error =
            "Sync failed. Check the Plaid connection and try again.";

          yield* store.query(
            "UPDATE connections SET error=? WHERE id=?",
            error,
            item.id,
          );
          yield* Effect.logWarning("Institution sync failed", {
            institution: item.name,
          });

          return yield* Effect.failCause(cause);
        }),
      ),
      Effect.withSpan("plaid.syncItem"),
    );

  return { syncItem };
});

export class Plaid extends Context.Service<
  Plaid,
  Effect.Success<typeof make>
>()("finance/Plaid") {
  static readonly layer = Layer.effect(Plaid, make);
}
