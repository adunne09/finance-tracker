# Finance tracker

## Mission and invariants

Build a private Plaid-backed household finance dashboard. Keep this public
repository free of household data, credentials and instance-specific identifiers.
Use integer USD cents and stable Plaid transaction IDs. Apply cursor/data changes
atomically; exclude pending transactions from posted totals. Transfers and card
payments are not spending or income. Refunds reduce spending; reimbursements are
separate. Missing account coverage must remain visible. No CSV/PDF ingestion.

All posted transactions are eligible for Jev movement/category classification.
Cache sanitized evidence by policy/model; reuse consistent learned patterns.
Send no amounts, dates, account IDs, balances, personal counterparties or histories
to Jev. Preserve manual overrides. No review queue or payment initiation.

## Stack and infrastructure

Use pnpm, Node.js >=22.18, strict TypeScript, Effect 4 and the compatible Node
platform package. Effect owns configuration, typed errors, services/Layers,
boundary parsing and telemetry. No tests, test scripts or test-only dependencies.

Alchemy is the sole dev/prod infrastructure definition: one Worker with static
assets, one D1 database/migrations, hourly synchronization, Access with an email
allowlist and a configured existing email-code identity provider. Cloudflare
provider/state; local Alchemy dev emulates Worker/D1 on loopback. No Wrangler
configuration, queues or additional services. Preserve stack/resource identities
when working with an existing deployment. Never run destroy without authorization.

Secrets are server-only bindings from ignored local configuration. Parameterize
instance names, Access domains/provider IDs and email allowlists. Protect both
production and preview URLs. LOCAL_DEV bypass is only for loopback development.

Provide structured Effect logs, spans and metrics through the telemetry Layer;
service name/version and optional OTLP use Config. Default to local/no-export.
Never log credentials or transaction payloads.

## Validation

Run `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm plan`
when IaC changes. Smoke-check real desktop/mobile UI and repeated synchronization.
Keep generic and Effect anti-slop rules enabled. Lefthook pre-commit runs lint and
typecheck. Deploy only with explicit approval; check authentication afterward.
Review staged files for private data before committing or pushing.
