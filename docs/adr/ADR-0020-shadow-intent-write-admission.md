# ADR-0020 — Shadow chat-intent key: write-admission rule (an empty extraction never clobbers a prior)

**Status:** ACCEPTED (ratified by Piotr 2026-07-30 by merging PR #643 — D1 is a product ruling and
merging the PR was the ratification act) **Date:** 2026-07-30 **Proposed by:** architect
(FOLLOW-735) **Implementing ticket:** FOLLOW-736 (ml-engineer) — this ADR describes behaviour that
is **NOT implemented at HEAD**; it is binding only when FOLLOW-736 merges. **Tickets:** FOLLOW-735
(this decision), FOLLOW-730 / PR #642 (the reverted attempts), FOLLOW-736 (implementation),
FOLLOW-737 (shared-Zod mirror gap, filed by this ADR). **Cross-references:** FOLLOW-087 (writer),
FOLLOW-101 / FOLLOW-252 / Rule R (one-shot chat-prior latch), FOLLOW-346 + FOLLOW-635 (the key is
live-influencing, not shadow), FOLLOW-384 / §H.9 (`profiling_opt_out`), FOLLOW-557 (DSR erase),
MASTER_DESIGN §C.3, §C.4, §D.1.1, `docs/compliance/C-07-chat-retention-scope.md`,
`docs/compliance/ropa.md` (line 133), `docs/compliance/dpia.md` (§269, §1350).

---

## Context

`redis_writer.write_shadow_intent` (`apps/intent-engine/src/redis_writer.py`) performs an
unconditional `SET key value ex=86400` on the key `shadow:{tenant_id}:{session_id}:chat_intent`.
Three call sites reach it: the real-time Modal path (`main.py:84`), the local-dev shim
(`local_dev.py:146`), and the 6h batch tier (`jobs/batch_enrich.py:52`).

Two classes of write carry **no usable intent dimensions**:

1. **Degraded** — the Anthropic call failed, timed out, or returned unparseable text; FOLLOW-730
   marks these with `data_source in DEGRADED_DATA_SOURCES` plus `extraction_error`.
2. **Neutral-success** — the call succeeded and the buyer genuinely said nothing extractable ("hi",
   "thanks"). Indistinguishable in effect, and more frequent in real conversations.

Either overwrites whatever the session had accumulated. The buyer's earlier, real, chat-derived
prior is destroyed by an event that says nothing about the buyer.

The blast radius is bounded but not zero. `flattenIntentDimensions`
(`apps/control-plane/src/lib/chat-intent-cache.ts:176-191`) drops nulls, so the SDK's guard at
`packages/sdk/src/core/adapt.ts:868-880` sees `{}` and applies nothing — the archetype is not
poisoned. The damage is a **lost signal**: because the SDK folds the chat prior **once per session**
(Rule R's persisted `chatPriorApplied` latch, FOLLOW-252), a prior destroyed before that single read
is lost for the entire session, not for one request.

Three `/code-review` rounds inside PR #642 each attempted a fix in place and each was reverted
(commit `1ff873ef`). Their four defects define the constraints this ADR must satisfy: (i) making
`data_source` decide which prior `/api/adapt` serves broke the DIAGNOSTIC ONLY contract asserted in
`schemas.py`, `nlp.py` and MASTER*DESIGN §C.4; (ii) refreshing the 24h TTL on a write carrying no
new personal data defeated the retention limit asserted in ROPA/DPIA/C-07; (iii) reading the prior
back through a bare `json.loads` created a second write path where compliance evidence cites
`payload.model_dump()` as the only one; (iv) a non-atomic GET-then-SET raced concurrent per-message
Modal containers, which Rule R's one-shot latch turns into \_permanent* loss of a good read.

## Decision

### D1 — Product ruling: an empty extraction never neutralises a stored prior

The shadow key keeps serving the last good read until a new good read replaces it, or the 24h TTL
expires it. Rationale: an extraction failure is a fact about our infrastructure, not about the
buyer; staleness is already bounded by the TTL, so erasing on failure adds no freshness and only
adds a second way to lose a good signal — one that fires precisely when we are least able to replace
it. Overwriting is irreversible, preserving is not; default to the reversible option.

### D2 — The rule is keyed on CONTENT (all-null dimensions), never on provenance

`data_source` is a provenance label, not a content check, and a future provenance value could
legitimately carry non-null dimensions (already policed by
`test_degraded_source_set_partitions_the_provenance_literal`). D1 therefore governs **empty
results**, not **failures** — which also closes the neutral-success clobber, a deliberate widening
beyond the reported symptom.

The predicate takes `ChatIntentDimensions`, **not** `ChatIntentDetectedPayload`, so it is
structurally incapable of reading provenance. This is type-level enforcement of DIAGNOSTIC ONLY.

```python
def has_intent_signal(dims: ChatIntentDimensions) -> bool:
    """True iff at least one dimension would survive `flattenIntentDimensions`."""
    for value in dims.model_dump().values():
        if value is None:
            continue
        if isinstance(value, bool):
            if value:            # tax_aware=False is "unknown", never a signal
                return True
        elif isinstance(value, str):
            if value:            # empty string is not a signal
                return True
        # no `else: return True` — the TS flattener drops other types, so we must too
    return False
```

**Cross-runtime parity contract.** The predicate is a line-for-line mirror of
`flattenIntentDimensions` (`chat-intent-cache.ts:176-191`). Nullability is already consistent across
the wire: Python emits explicit JSON `null` for every unset dimension (`schemas.py:34-55`,
`model_dump()`), and the TypeScript reader declares every field **both optional and nullable**
(`chat-intent-cache.ts:33-44`), so `null` and absent collapse to the same handling. Both sides are
pinned by `tests/fixtures/chat-intent-signal-parity.json`. **If a future dimension is neither `str`
nor `bool`, both sides must change in the same PR.**

### D3 — Atomicity: a single `SET … NX`, no GET, no Lua

```python
def write_shadow_intent(payload, ttl_seconds=86400, profiling_opt_out=False) -> None:
    if profiling_opt_out:                      # §H.9 — unchanged, stays first
        return
    key = shadow_key(payload.tenant_id, payload.session_id)
    value = json.dumps(payload.model_dump())   # unchanged: the ONLY serialization path
    if has_intent_signal(payload.intent_dimensions):
        _get_redis().set(key, value, ex=ttl_seconds)              # overwrite + refresh TTL
    else:
        _get_redis().set(key, value, ex=ttl_seconds, nx=True)     # create-only; never clobber
```

`SET … NX` against an existing key performs **no mutation at all**. Verified available in the pinned
client: `upstash_redis/commands.py:4611-4700` emits `["SET", k, v, "NX", "EX", n]` and returns falsy
when the key already existed.

**Invariant:** _the only command that can remove a good record is a `SET` carrying non-empty
dimensions._ Every interleaving of concurrent per-message containers is therefore safe by
construction; no read-then-write window exists.

### D4 — TTL invariant

> A shadow-key write may only ever **shorten or leave unchanged** the residual lifetime of
> previously-stored personal data. It may never extend it.

`SET … NX` cannot touch an existing key's TTL, so the preserved-prior branch cannot refresh the
retention clock. The retention **maximum** is unchanged (`ex=86400`); the effective lifetime becomes
"24 h from the last chat message that yielded at least one intent dimension" — always ≤ the "24 h
from last chat message" currently asserted in C-07 Q3.1. The C-07 Q4 LI balancing test, which rests
on the 24h TTL limiting staleness, holds a fortiori. The implementing PR must update the C-07 Q3.1
wording and re-verify the `redis_writer.py` line citations in C-07:209-218, dpia.md:269 and
ropa.md:133, which this edit shifts.

### D5 — Validation invariant

`redis_writer.py` performs **no read** of the shadow namespace and **no deserialization**.
`json.dumps(payload.model_dump())` stays the single serialization path into the key — the fact
C-07:210-215 / dpia.md:269 / ropa.md:133 rest on. Mechanically enforced by a test asserting the
module source contains no `json.loads`, `.get(` or `.mget(`.

### D6 — Visibility without becoming adaptation input

There is **no merged record, no sibling field, no marker stitching**. When a prior is preserved the
stored record is not touched, so **a record's `data_source` / `extraction_error` always describe the
dimensions in that same record** — the record-level provenance integrity the reverted rounds broke.
Degradation stays observable via (1) the Sentry capture FOLLOW-730 added on both the primary and
retry paths, (2) the payload returned by `process_chat_message` / `local_dev`, and (3) the key
itself on a cold session, where the `NX` write succeeds and stores the degraded record with its
markers in full.

Rule R is unaffected: the latch arms only on `Object.keys(dims).length > 0` (`adapt.ts:868-880`), so
a degraded record on a cold key (which flattens to `{}`) cannot consume it. **No SDK change and no
control-plane change is in scope.**

### D7 — Explicit non-goals

Per-dimension merging, and `detected_at`-monotonic ordering (a stale batch write overwriting a newer
realtime write), are out of scope: both require read-compare and therefore Lua, neither has a
demonstrated symptom, and both remain cleanly addable on top of this rule. Last-writer-wins among
_good_ writes is the pre-existing semantics and is unchanged.

## Consequences

**Positive**

- A real chat-derived prior survives an Anthropic outage and survives "hi"/"thanks" turns — the loop
  that is the standing localhost priority stops losing signal.
- One command, one round-trip; no latency, cost, or dependency change.
- Retention gets strictly tighter, never looser.
- Provenance markers stay diagnostic, enforced by a parameter type rather than by convention.
- Removes a whole class of read-then-write races from the module by removing the read.

**Negative**

- On a session that already has a prior, the degraded record is not persisted anywhere in Redis; the
  operator must look at Sentry. Accepted — the shared cache is not an observability store, and
  treating it as one is what broke the DIAGNOSTIC ONLY contract in PR #642.
- A preserved prior can be up to 24 h old while the buyer is actively (but unextractably) chatting.
  Bounded by the same TTL that already governs.
- Two write branches instead of one; parity with the TS flattener is now a maintained contract.
  Mitigated by the shared fixture and the "same PR" rule in D2.

**Risks**

- _Someone later adds a numeric or list dimension_ and the two runtimes silently diverge. Mitigated
  by the shared fixture test on both sides plus the mirrored comments.
- _Someone later "improves" this into a real merge_ and reintroduces GET-then-SET. Mitigated by D5's
  source-level test and by D7 naming the non-goal.

**Reversibility: high.** Deleting one keyword (`nx=True`) restores the previous behaviour exactly.
No schema change, no migration, no stored-data shape change, no consumer change.

## Alternatives considered

1. **Status quo — unconditional `SET` (rejected).** Simplest, and the blast radius is bounded, but
   it destroys real signal on every outage and every "hi", and Rule R's one-shot latch makes the
   loss session-permanent.
2. **Skip the write entirely when `data_source` is degraded (PR #642 round 1, rejected).** Keys on
   provenance (D2), loses the cold-session visibility case (D6), and leaves the neutral-success
   clobber — the more frequent case — completely unaddressed.
3. **GET the prior, merge fields, SET back (PR #642 round 2, rejected).** Four independent defects,
   all documented in Context: DIAGNOSTIC ONLY breach, TTL refresh on non-new personal data, an
   unvalidated second write path, and a non-atomic race that Rule R converts into permanent loss.
4. **Lua `EVAL` merge with `detected_at` monotonicity (rejected for now).** Strictly more powerful
   and would also solve D7's non-goals, but requires JSON parsing inside Lua, script-cache
   management over the Upstash REST transport, and a second serialization path — significant
   complexity for a requirement nobody has. `SET … NX` gets the whole stated requirement in one
   flag. Kept as the documented escape hatch if per-dimension merging is ever required.
5. **Two keys — `…:chat_intent` (last good) plus `…:chat_intent_last_attempt` (rejected).** Gives
   perfect visibility, but doubles the retention surface and the DSR erase path
   (`deleteShadowChatIntent`, FOLLOW-557), needs a control-plane read change, and adds a personal-
   data key whose only consumer is an operator — Sentry already serves that consumer for free.

## References

- `apps/intent-engine/src/redis_writer.py` (writer), `main.py:84`, `local_dev.py:146`,
  `jobs/batch_enrich.py:52` (three call sites)
- `apps/control-plane/src/lib/chat-intent-cache.ts:33-44, 176-191` (the mirrored reader)
- `packages/sdk/src/core/adapt.ts:838-897` (Rule R latch, the reason loss is permanent)
- `CONVENTIONS_PATCH.md` Rule R + its 2026-06-10 amendment
- `docs/compliance/C-07-chat-retention-scope.md` Q2/Q3/Q4; `ropa.md:133`; `dpia.md:269, 1350`
- `docs/MASTER_DESIGN.md` §C.3, §C.4, §D.1.1
- Redis `SET` semantics (NX + EX): https://redis.io/commands/set
- Installed client support: `apps/intent-engine/.venv/.../upstash_redis/commands.py:4611-4700`
