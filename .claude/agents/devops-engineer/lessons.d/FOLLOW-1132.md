# FOLLOW-1132 — devops lesson (2026-09-14)

- **2026-09-14 / FOLLOW-1132** · Shipped: `turbo.json` env declarations under strict envMode (`dev`
  passThroughEnv `*`, `test` hashed gate env, control-plane `build` Sentry env), runbook §3.5.1. ·
  Green badge hiding a broken run path: through Turbo, `REQUIRE_*=1` was stripped and the live
  smokes reported `skipped`, exit 0; the same command without Turbo exits 1. CI was immune only
  because every env-gated CI step already bypasses Turbo. Root `pnpm dev` also dies on a wrangler
  inspector-port `:9229` collision. · Guardrail I would add: a CI step that runs
  `REQUIRE_REDIS_SMOKE=1 pnpm turbo run test --filter=@estalara/integration-smoke` without
  credentials and asserts a NON-zero exit, so a future turbo.json edit cannot silently re-strip the
  gates.
