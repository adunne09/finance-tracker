import { Effect, Schema } from "effect";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type {
  ExecutionContext,
  ScheduledController,
} from "@cloudflare/workers-types";
import type { Env } from "./config.ts";
import { AppError, Correction } from "./domain.ts";
import { Application } from "./runtime.ts";
import { Store } from "./store.ts";
import { synchronize } from "./sync.ts";

const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const CorrectionRequest = Schema.Struct({
  id: Schema.String,
  correction: Schema.NullOr(Correction),
});

const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function authorized(request: Request, env: Env): Promise<boolean> {
  const url = new URL(request.url);

  if (
    env.LOCAL_DEV === "true" &&
    ["127.0.0.1", "localhost"].includes(url.hostname)
  )
    return true;

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAILS)
    return false;

  const allowed = new Set(
    env.ALLOWED_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  const token = request.headers.get("cf-access-jwt-assertion");

  if (!token) return false;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let keys = keysets.get(issuer);

  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keysets.set(issuer, keys);
  }

  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: env.ACCESS_AUD,
    });

    const identity = Schema.decodeUnknownSync(
      Schema.Struct({ email: Schema.String }),
    )(payload);

    return allowed.has(identity.email.toLowerCase());
  } catch {
    return false;
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (!(await authorized(request, env)))
      return new Response("Unauthorized", { status: 401, headers });
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      const asset = await env.ASSETS.fetch(request);

      const response = new Response(asset.body, {
        status: asset.status,
        headers: asset.headers,
      });

      for (const [key, value] of Object.entries(headers))
        response.headers.set(key, value);

      return response;
    }

    const action = Effect.gen(function* () {
      const store = yield* Store;

      if (request.method === "GET" && url.pathname === "/api/ledger")
        return Response.json(yield* store.snapshot, { headers });

      if (request.method === "POST") {
        if (
          request.headers.get("origin") !== url.origin ||
          request.headers.get("x-finance-request") !== "1" ||
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          return yield* new AppError({
            message: "Same-origin JSON request required",
            status: 403,
          });

        if (url.pathname === "/api/sync") {
          const result = yield* synchronize;

          return Response.json(result, { headers });
        }

        if (url.pathname === "/api/correct") {
          const text = yield* Effect.tryPromise({
            try: () => request.text(),
            catch: () => new AppError({ message: "Invalid body", status: 400 }),
          });

          if (text.length > 4096)
            return yield* new AppError({
              message: "Body too large",
              status: 413,
            });

          const body = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(CorrectionRequest),
          )(text).pipe(
            Effect.mapError(
              () =>
                new AppError({ message: "Invalid correction", status: 400 }),
            ),
          );

          yield* store.correct(body.id, body.correction);

          return Response.json({ saved: true }, { headers });
        }
      }

      return new Response("Not found", { status: 404, headers });
    }).pipe(
      Effect.catchTag("AppError", (e) =>
        Effect.succeed(
          Response.json({ error: e.message }, { status: e.status, headers }),
        ),
      ),
      Effect.catchCause(() =>
        Effect.succeed(
          Response.json({ error: "Request failed" }, { status: 500, headers }),
        ),
      ),
      Effect.provide(Application(env)),
    );

    return Effect.runPromise(action);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await Effect.runPromise(synchronize.pipe(Effect.provide(Application(env))));
  },
};
