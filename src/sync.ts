import { Effect } from "effect";
import { configuredItems } from "./config.ts";
import { Store } from "./store.ts";
import { Plaid } from "./plaid.ts";
import { Classifier } from "./classifier.ts";

export const synchronize = Effect.gen(function* () {
  const store = yield* Store;
  const owner = crypto.randomUUID();

  const lock = yield* store.query(
    "INSERT INTO sync_lock(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE sync_lock.expires < ?",
    owner,
    Date.now() + 900000,
    Date.now(),
  );

  if (!lock.meta.changes) return { busy: true };

  return yield* Effect.gen(function* () {
    const plaid = yield* Plaid;

    for (const item of yield* configuredItems)
      yield* plaid.syncItem(item).pipe(Effect.catchCause(() => Effect.void));
    const classifier = yield* Classifier;
    yield* classifier.classify.pipe(
      Effect.catchCause(() =>
        store.query(
          "INSERT INTO metadata(key,value) VALUES('classification_error',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          "Classification interrupted; next sync will retry.",
        ),
      ),
    );

    return { busy: false };
  }).pipe(
    Effect.timeout("12 minutes"),
    Effect.ensuring(
      store
        .query("DELETE FROM sync_lock WHERE owner=?", owner)
        .pipe(Effect.orDie),
    ),
  );
}).pipe(Effect.withSpan("finance.synchronize"));
