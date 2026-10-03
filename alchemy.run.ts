import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import type { WorkerProps } from "alchemy/Cloudflare";
import { Config, Effect } from "effect";

export default Alchemy.Stack(
  process.env.ALCHEMY_STACK_NAME ?? "FinanceTracker",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { dev } = yield* AlchemyContext;
    const allowedEmails = yield* Config.String("ALLOWED_EMAILS");

    const emails = allowedEmails
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    if (!dev && emails.length === 0)
      return yield* Effect.die(new Error("ALLOWED_EMAILS must not be empty"));

    const database = yield* Cloudflare.D1.Database("Ledger", {
      migrations: "./migrations",
    });

    const access = dev
      ? undefined
      : yield* Cloudflare.Access.Application("HouseholdAccess", {
          type: "self_hosted",
          name: yield* Config.String("ACCESS_APPLICATION_NAME").pipe(
            Config.withDefault("Finance tracker"),
          ),
          allowedIdps: [yield* Config.String("ACCESS_IDENTITY_PROVIDER_ID")],
          sessionDuration: "168h",
          policies: [
            {
              name: "Household only",
              decision: "allow",
              include: emails.map((email) => ({ email })),
            },
          ],
        });

    const props: WorkerProps = {
      name: yield* Config.String("WORKER_NAME").pipe(
        Config.withDefault("finance-tracker"),
      ),
      main: "./src/server.ts",
      compatibility: { date: "2026-09-25", flags: ["nodejs_compat"] },
      assets: { directory: "./dist/public", runWorkerFirst: true },
      dev: { host: "127.0.0.1", port: 4317 },
      crons: ["17 * * * *"],
      env: {
        DB: database,
        PLAID_CLIENT_ID: yield* Config.Redacted("PLAID_CLIENT_ID"),
        PLAID_SECRET: yield* Config.Redacted("PLAID_SECRET"),
        PLAID_ITEMS: yield* Config.Redacted("PLAID_ITEMS"),
        TYPESAFE_API_KEY: yield* Config.Redacted("TYPESAFE_API_KEY"),
        TYPESAFE_MODEL: "jev-1.13.0",
        ACCESS_TEAM_DOMAIN: dev
          ? ""
          : yield* Config.String("ACCESS_TEAM_DOMAIN"),
        ACCESS_AUD: access?.aud ?? "",
        LOCAL_DEV: dev ? "true" : "false",
        ALLOWED_EMAILS: yield* Config.Redacted("ALLOWED_EMAILS"),
      },
    };

    if (access) props.access = access;
    const worker = yield* Cloudflare.Worker("Dashboard", props);

    return { url: worker.url, database: database.databaseId };
  }),
);
