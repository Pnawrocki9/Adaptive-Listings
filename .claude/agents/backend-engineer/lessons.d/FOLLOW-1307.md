## 2026-11-05 · FOLLOW-1307 — JWT registered claims + mutation permission matrix (Phase 6 S1)

Enforced `alg`/`exp`/`nbf`/`iss`/`aud` on the `@estalara/auth` HS256 path and `exp`/`nbf` on the
demo JWT; removed `POST /api/tenants` (x-admin-secret tenant creation) and its orphan
`lib/bandit-seed.ts`; added a method × caller matrix over every mutating route, generated from the
N2 allowlist and run on the real handlers with a recording fake DB and a recorded `fetch`. · Risks
weighed: issuer must match what the real emitter writes (`<SUPABASE_URL>/auth/v1`, aud
`authenticated` — the anon/service keys signed with the same secret carry `iss: "supabase"`), so
every local minter (N3, admin-smoke) had to learn `NEXT_PUBLIC_SUPABASE_URL`; the matrix proves the
gate, not the write (empty bodies), and "denied" means 401/403 AND no DB write AND no outbound
fetch. Re-scope first paid off: the embed role hole (F-10) and LIA F3 were already closed by
FOLLOW-1335 — the expired-token hole was still open on all 22 staff writes. · Guardrail: a new
mutating route must land with a MATRIX entry (the test forces it); consider promoting "verifier
checks every registered claim the emitter writes" to a Rule if a third HS256 path appears.
