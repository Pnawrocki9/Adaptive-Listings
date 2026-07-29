# estalara-intent-engine

Modal serverless Python service for buyer intent extraction.

## Status

Placeholder — full implementation in TICKET-013 (ml-engineer).

## Development

```bash
cd apps/intent-engine
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest src/
```

## Local dev: running the chat-NLP endpoint on localhost (FOLLOW-729)

`chat_nlp_endpoint` (`src/main.py:108`) is built with `@modal.fastapi_endpoint()` stacked on
`@app.function()` — Modal's own ASGI synthesis, not a bare `FastAPI()` app, so it cannot be served
by plain `uvicorn` and `modal serve` requires Modal credentials plus produces an ephemeral tunnel
URL, not `localhost:PORT`. `src/local_dev.py` is a **local-only** bare-FastAPI entrypoint that calls
the same underlying `nlp.extract_intent` + `redis_writer.write_shadow_intent` functions directly (no
Modal, no `.spawn()`) so you can run the full chat→intent→archetype loop on your own machine. It is
additive-only — it does not touch `main.py`'s production Modal wiring, does not deploy anything, and
does not change the batch tier (`src/jobs/batch_enrich.py`).

### Required env vars (4)

| Var                        | Purpose                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`        | Claude call inside `nlp.extract_intent` (Haiku 4.5 by default)               |
| `UPSTASH_REDIS_REST_URL`   | Upstash REST endpoint for `redis_writer.write_shadow_intent`                 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token for the same write                                        |
| `INTERNAL_API_SECRET`      | Shared secret the endpoint's `Authorization: Bearer <secret>` checks against |

Same names as `.env.example:46-117` and the same values `main.py`'s production auth/write path uses
— see `docs/runbooks/upstash-redis-env-parity.md` for the **mandatory** requirement that
`UPSTASH_REDIS_REST_URL`/`_TOKEN` (this writer) and `UPSTASH_REDIS_URL`/`UPSTASH_REDIS_TOKEN`
(control-plane's `readShadowChatIntent` reader) point at the SAME Upstash database — otherwise the
write here will never be visible to `/api/adapt`.

### Run

```bash
cd apps/intent-engine
source .venv/bin/activate  # or: pip install -e ".[dev]"
export ANTHROPIC_API_KEY=...
export UPSTASH_REDIS_REST_URL=...
export UPSTASH_REDIS_REST_TOKEN=...
export INTERNAL_API_SECRET=...
uvicorn local_dev:app --reload --port 8090 --app-dir src
```

Then point the ingest Worker's dev config at it — set (e.g. in `apps/ingest/.dev.vars`):

```
MODAL_CHAT_NLP_URL=http://localhost:8090/chat_nlp_endpoint
INTERNAL_API_SECRET=<same value as above>
```

### Verify the round trip manually

```bash
curl -s http://localhost:8090/health   # {"service": "estalara-intent-engine-local-dev", "status": "active"}

curl -s -X POST http://localhost:8090/chat_nlp_endpoint \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"local-dev-tenant","session_id":"local-dev-session","message":{"role":"user","content":"Looking for a high-yield cash investment property"}}'
# → 202 {"status": "accepted"} — by the time this returns, the shadow key is already written
# (unlike production's fire-and-forget spawn, this shim writes synchronously).

curl -s "$UPSTASH_REDIS_REST_URL/get/shadow:local-dev-tenant:local-dev-session:chat_intent" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
# → {"result": "{\"tenant_id\": \"local-dev-tenant\", ... \"archetype_hint\": \"...\", ...}"}
```

Or run the automated smoke test (mocks the Anthropic call and the Redis client, exercises the real
`write_shadow_intent` shadow-key/TTL logic, no live credentials required):

```bash
pytest src/test_local_dev.py -v
```

### Do real dev-tier credentials exist? (FOLLOW-729 AC5)

As of this ticket, this is an **open credentials/operator gap, not a code gap**: no dev-tier Upstash
Redis instance or a dedicated dev Anthropic key is confirmed provisioned for local use (the smoke
test above avoids needing them by mocking both). Whoever runs `local_dev.py` for a real end-to-end
check today needs to supply their own `ANTHROPIC_API_KEY` and a Redis instance (dev or prod) — see
`docs/runbooks/upstash-redis-env-parity.md` for how the two Upstash env-var pairs must match.
