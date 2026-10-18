## 2026-10-18 · FOLLOW-1331 — remove Stripe (R9)

Removed the Stripe lib + webhook route + env/secrets rows, kept `tenants.plan` and the `stripe_*`
columns (no migration; marked `@deprecated`). · Risks weighed: the webhook was the only writer of
`stripe_*` and of billing-driven `plan`/`status` changes, so `plan` is now set only by
`POST /api/tenants` and the seed; removal is a pure leaf delete with no importers (no Sentry sites,
no middleware prefix, no CI gate). Worktrees start without `node_modules`; symlink root +
per-package ones from the main tree before prettier/vitest. · Guardrail: none.
