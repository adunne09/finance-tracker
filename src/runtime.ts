import { ConfigProvider, Layer } from "effect";
import type { Env } from "./config.ts";
import { Settings } from "./config.ts";
import { Database, Store } from "./store.ts";
import { Plaid } from "./plaid.ts";
import { Classifier } from "./classifier.ts";
import { Telemetry } from "./telemetry.ts";

export const Application = (env: Env) =>
  Layer.merge(Classifier.layer, Plaid.layer).pipe(
    Layer.provideMerge(Store.layer),
    Layer.provideMerge(Telemetry),
    Layer.provideMerge(Settings.layer),
    Layer.provideMerge(Layer.succeed(Database, env.DB)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  );
