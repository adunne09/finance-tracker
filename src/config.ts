import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  PLAID_ITEMS: string;
  TYPESAFE_API_KEY: string;
  TYPESAFE_MODEL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  LOCAL_DEV?: string;
  OTEL_SERVICE_NAME?: string;
  OTEL_SERVICE_VERSION?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

const Item = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  token: Schema.String,
});

export type Item = typeof Item.Type;

const config = Config.all({
  clientId: Config.Redacted("PLAID_CLIENT_ID"),
  secret: Config.Redacted("PLAID_SECRET"),
  items: Config.Redacted("PLAID_ITEMS"),
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
  model: Config.String("TYPESAFE_MODEL").pipe(Config.withDefault("jev-1.13.0")),
  serviceName: Config.String("OTEL_SERVICE_NAME").pipe(
    Config.withDefault("household-finances"),
  ),
  serviceVersion: Config.String("OTEL_SERVICE_VERSION").pipe(
    Config.withDefault("0.2.0"),
  ),
  otlpEndpoint: Config.String("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
    Config.withDefault(""),
  ),
});

export class Settings extends Context.Service<
  Settings,
  Config.Success<typeof config>
>()("finance/Settings") {
  static readonly layer = Layer.effect(Settings, config);
}

export const configuredItems = Effect.gen(function* () {
  const settings = yield* Settings;

  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(Item)),
  )(Redacted.value(settings.items));
});
