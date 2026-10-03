import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Context, Effect, Layer, Schema } from "effect";
import {
  Account,
  AppError,
  Classification,
  Correction,
  Snapshot,
  Transaction,
} from "./domain.ts";

export class Database extends Context.Service<Database, D1Database>()(
  "finance/Database",
) {}

const Saved = Schema.Struct({
  body: Schema.String,
  classification: Schema.NullOr(Schema.String),
  correction: Schema.NullOr(Schema.String),
});

const Body = Schema.Struct({ body: Schema.String });

const ConnectionRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  last_sync: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});

const Value = Schema.Struct({ value: Schema.String });

export const StoreLive = Effect.gen(function* () {
  const db = yield* Database;

  const operation = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: () =>
        new AppError({ message: "Database operation failed", status: 503 }),
    }).pipe(Effect.withSpan("database.query"));

  const query = (text: string, ...values: (string | number | null)[]) =>
    operation(() =>
      db
        .prepare(text)
        .bind(...values)
        .all(),
    );

  const batch = (statements: D1PreparedStatement[]) =>
    operation(() => db.batch(statements));

  const snapshot = Effect.gen(function* () {
    const results = yield* batch([
      db.prepare(
        "SELECT body, classification, correction FROM transactions WHERE removed=0 ORDER BY date DESC, id",
      ),
      db.prepare("SELECT body FROM accounts ORDER BY item, id"),
      db.prepare(
        "SELECT id,name,last_sync,error FROM connections ORDER BY name",
      ),
      db
        .prepare("SELECT owner AS value FROM sync_lock WHERE expires > ?")
        .bind(Date.now()),
      db.prepare("SELECT value FROM metadata WHERE key='classification_error'"),
      db.prepare("SELECT value FROM metadata WHERE key='last_classification'"),
    ]);

    const saved = yield* Schema.decodeUnknownEffect(Schema.Array(Saved))(
      results[0]?.results,
    );

    const accountBodies = yield* Schema.decodeUnknownEffect(Schema.Array(Body))(
      results[1]?.results,
    );

    const connections = yield* Schema.decodeUnknownEffect(
      Schema.Array(ConnectionRow),
    )(results[2]?.results);

    const errors = yield* Schema.decodeUnknownEffect(Schema.Array(Value))(
      results[4]?.results,
    );

    const times = yield* Schema.decodeUnknownEffect(Schema.Array(Value))(
      results[5]?.results,
    );

    const rows = [];

    for (const row of saved) {
      rows.push({
        transaction: yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Transaction),
        )(row.body),
        classification: row.classification
          ? yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(Classification),
            )(row.classification)
          : null,
        correction: row.correction
          ? yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(Correction),
            )(row.correction)
          : null,
      });
    }

    const accounts = [];

    for (const account of accountBodies)
      accounts.push(
        yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Account))(
          account.body,
        ),
      );

    return {
      rows,
      accounts,
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        lastSync: c.last_sync,
        error: c.error,
      })),
      processing: Boolean(results[3]?.results.length),
      unclassified: rows.filter(
        (r) => !r.transaction.pending && !r.classification && !r.correction,
      ).length,
      classificationError: errors[0]?.value || null,
      lastClassification: times[0]?.value ?? null,
    } satisfies Snapshot;
  }).pipe(
    Effect.mapError(
      () => new AppError({ message: "Could not read ledger", status: 503 }),
    ),
  );

  const correct = (id: string, correction: Correction | null) =>
    Effect.gen(function* () {
      const result = yield* query(
        "UPDATE transactions SET correction=? WHERE id=? AND removed=0",
        correction ? JSON.stringify(correction) : null,
        id,
      );

      if (!result.meta.changes)
        return yield* new AppError({
          message: "Transaction no longer available",
          status: 404,
        });
    });

  return { db, query, batch, snapshot, correct };
});

export class Store extends Context.Service<
  Store,
  Effect.Success<typeof StoreLive>
>()("finance/Store") {
  static readonly layer = Layer.effect(Store, StoreLive);
}
