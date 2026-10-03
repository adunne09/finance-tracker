# Finance tracker

A self-hosted, Plaid-backed finance dashboard with automatic Jev classification.
Built with TypeScript, Effect, Cloudflare Workers and D1.

## Features

- Unified accounts, spending, income, reimbursements and transaction filters.
- Current-month default, responsive layout and automatic synchronization.
- Separate movement/category judgments, evidence caching and learned repeat patterns.
- Inline category, movement and label edits that survive synchronization.
- Stable Plaid identities, atomic cursor updates and pending-transaction handling.
- Access JWT verification and a configurable email allowlist.

Payments and internal transfers are excluded from spending/income. Refunds reduce
spending; reimbursements are reported separately. Only connected account histories
are included. There are no CSV/PDF imports or payment-initiation features.

## Local development

Requires Node.js 22.18+ and pnpm.

```sh
pnpm install
cp .env.example .dev.vars
# Fill in your own Plaid and TypeSafe credentials in .dev.vars.
pnpm dev
```

Open the loopback URL printed by the development server. `PLAID_ITEMS` is a JSON
array of `{ "id": "item-id", "name": "Bank name", "token": "access-token" }`
using your own linked Plaid Items. The current integration uses Plaid production.
Alchemy dev emulates Worker/D1 and applies the declared migrations, keeping local
state under the ignored `.alchemy/` directory. Its `local` stage is independent
of production; existing data from other local emulators is not imported.
Authentication is bypassed only with `LOCAL_DEV=true` on loopback hostnames.

## Configuration and privacy

Server-only bindings include `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ITEMS`,
`TYPESAFE_API_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ALLOWED_EMAILS`.
The allowlist is a comma-separated list of email addresses. Production requests
fail closed if Access configuration or the allowlist is missing. Configure both
Access policies and the Worker allowlist for your own instance.

`alchemy.run.ts` is the single development and production infrastructure definition.
Configure your own stack/Worker name, Access team domain, email-code provider ID,
application name and email allowlist using `.dev.vars`. Retain existing stack and
Worker names when adopting this source for an already-managed deployment.
Instance-specific values, deployment state, operational notes, credentials, bank
records and generated assets are excluded from Git.

`pnpm plan` previews production changes; `pnpm run deploy` applies them.
`pnpm run destroy` removes the production stack and prompts for confirmation.
Development uses `pnpm dev`, with no separate Wrangler configuration or migration
command. Rebuild frontend assets with `pnpm build` after editing HTML/CSS/client code.

Jev receives sanitized merchant/description evidence, direction, account type and
bank category hints. It does not receive amounts, dates, account identifiers,
balances or complete histories. Exact results are cached by evidence, policy and
model. Consistent normalized patterns reuse prior judgments; conflicting or novel
patterns fall back to Jev. Manual changes remain transaction-specific.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm build
```

Lefthook runs lint and typecheck before commits. Vendored lint rules retain their
upstream notices. Validate the UI and synchronization manually with your own data.
