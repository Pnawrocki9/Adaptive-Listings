# Upstash Redis Env-Var Parity — Operator Runbook

**Owner:** devops-engineer **Created:** 2026-06-23 **Ticket:** FOLLOW-368

---

## Problem statement

The chat-intent shadow bridge spans two runtimes that use **different env-var names** for the same
Upstash Redis instance:

| Runtime          | Env var                    | Used by                                                             |
| ---------------- | -------------------------- | ------------------------------------------------------------------- |
| Modal (Python)   | `UPSTASH_REDIS_REST_URL`   | `apps/intent-engine/src/redis_writer.py:29` (`write_shadow_intent`) |
| Modal (Python)   | `UPSTASH_REDIS_REST_TOKEN` | `apps/intent-engine/src/redis_writer.py:30`                         |
| Vercel (TS/Next) | `UPSTASH_REDIS_URL`        | `apps/control-plane/src/lib/chat-intent-cache.ts:69`                |
| Vercel (TS/Next) | `UPSTASH_REDIS_TOKEN`      | `apps/control-plane/src/lib/chat-intent-cache.ts:74`                |

The Python writer and TypeScript reader use a **byte-identical Redis key**:

```
shadow:{tenant_id}:{session_id}:chat_intent
```

If the two env-var pairs are provisioned to point at **different** Upstash databases, writes
(Python) and reads (TypeScript) silently miss each other with no error. This is `HW-3` documented in
`RETRO-098 §3`.

---

## MANDATORY deployment rule

> **Both `UPSTASH_REDIS_REST_URL` (Modal secret) and `UPSTASH_REDIS_URL` (Vercel env) MUST resolve
> to the SAME Upstash database.** Similarly, `UPSTASH_REDIS_REST_TOKEN` and `UPSTASH_REDIS_TOKEN`
> MUST be credentials for that same database.

This is not optional. A misconfiguration silently breaks the chat-intent prior bridge
(`FOLLOW-346 / FOLLOW-366 / FOLLOW-368`) and all downstream features that depend on it (K.3.6 D-2
chat panel).

---

## How to verify parity in production

### Option A — Compare URLs

```bash
# From Doppler (prod config):
doppler secrets get UPSTASH_REDIS_REST_URL --project estalara-adaptive-listings --config prd --plain
doppler secrets get UPSTASH_REDIS_URL      --project estalara-adaptive-listings --config prd --plain
```

Both values must be the same URL (e.g. `https://my-db.upstash.io`). If they differ, one of them is
pointing at the wrong Upstash instance.

### Option B — Write/read round-trip (local)

```bash
# Set all four env vars to the Upstash instance you want to verify:
export UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
export UPSTASH_REDIS_REST_TOKEN=<token>
export UPSTASH_REDIS_URL=https://your-db.upstash.io      # must equal REST_URL
export UPSTASH_REDIS_TOKEN=<token>                        # must equal REST_TOKEN

# Install intent-engine Python deps:
pip install -e apps/intent-engine/.[dev]

# Run the round-trip smoke test:
cd tests/integration
REQUIRE_REDIS_SMOKE=1 pnpm exec vitest run --config vitest.config.ts redis-shadow-round-trip.smoke
```

A green run confirms both sides read/write the same instance.

### Option C — CI smoke workflow

The `redis-shadow-smoke.yml` workflow runs on every push/PR for agent-prefixed branches and nightly
at 04:30 UTC. When all four secrets are provisioned in GitHub Actions (per ESC-028), the workflow
will run in hard-fail mode (`REQUIRE_REDIS_SMOKE=1`). Until then it soft-skips with a `::notice::`
annotation.

---

## How to fix a parity mismatch

1. Identify which Upstash database the Python side writes to:
   ```
   UPSTASH_REDIS_REST_URL in Modal secret `estalara-redis` (or equivalent)
   ```
2. Copy that URL and token to the Vercel env vars `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` for
   the control-plane project.
3. Redeploy the control-plane (Vercel picks up new env vars only after redeploy).
4. Re-run Option B / Option C above to verify.
5. Update Doppler (`--config dev`, `--config staging`, `--config prd`) to match:
   ```bash
   doppler secrets set UPSTASH_REDIS_URL=<url> --project estalara-adaptive-listings --config prd
   doppler secrets set UPSTASH_REDIS_TOKEN=<token> --project estalara-adaptive-listings --config prd
   ```
6. Provision the GitHub Actions secrets (per ESC-028) to enable live CI smoke.

---

## Key naming convention

Both runtimes use the identical key format:

```
shadow:{tenant_id}:{session_id}:chat_intent
```

- Defined in Python: `apps/intent-engine/src/redis_writer.py:shadow_key()`
- Defined in TypeScript: `apps/control-plane/src/lib/chat-intent-cache.ts:shadowChatIntentKey()`

Do NOT change either key format without updating both.

---

## TTL

The Python writer sets a **24-hour TTL** (`ex=86400`). This is the production default and is
asserted by the FOLLOW-368 smoke test (AC-RT2). A key without a TTL is a bug — stale shadow data
would never self-clean.

---

## Related

- `RETRO-098 §3 HW-3` — origin of this issue
- `backlog/ESCALATIONS.md ESC-028` — GitHub Actions secret provisioning request
- `.github/workflows/redis-shadow-smoke.yml` — CI smoke workflow
- `tests/integration/redis-shadow-round-trip.smoke.test.ts` — TypeScript round-trip test
- `tests/integration/shadow_intent_writer.py` — Python write helper
- `apps/intent-engine/src/redis_writer.py` — production Python writer
- `apps/control-plane/src/lib/chat-intent-cache.ts` — production TypeScript reader
