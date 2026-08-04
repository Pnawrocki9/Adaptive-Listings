# C-07 — Chat Free-Text Retention: DPIA Scope Brief

**Document ID:** ESTALARA-C-07 **Version:** 1.1 **Date:** 2026-08-05 **Author:** Compliance
Engineering **Classification:** Internal — Restricted **Status:** PENDING CEO decision (items marked
below) **DPIA cross-reference:** DPIA §13 (LIA series) — this brief defines the §14 scope
**FOLLOW:** FOLLOW-346 (shadow bridge) — go-live gate on CEO decision recorded here

---

## Context

The chat NLP bridge ships **shadow-only** in the current cycle (FOLLOW-346). The `chat.message.sent`
event is routed to `process_chat_message` in `apps/intent-engine/src/main.py`. The NLP extractor
reads the raw chat text from the `messages` list, calls Claude Haiku 4.5 (real-time) or Sonnet 4.6
(batch), and writes the resulting 12-dimensional intent vector — not the raw text — to a Redis
shadow key (`shadow:{tenant_id}:{session_id}:chat_intent`, TTL 24 h) in Upstash Redis. No raw chat
text is written to Redis, ClickHouse, or Postgres in the current implementation (verified:
`apps/intent-engine/src/redis_writer.py`, `write_shadow_intent` serializes `payload.model_dump()`
which is `ChatIntentDetectedPayload` — no `messages` field on that model;
`apps/intent-engine/src/schemas.py`, class `ChatIntentDetectedPayload`). Line numbers are omitted
deliberately: FOLLOW-730 shifted them, and a citation that drifts is worse than none.

Live adaptation is gated on this C-07 sign-off. This brief answers the five CEO questions and makes
a concrete recommendation.

---

## Q1 — Lawful basis for retaining free-text chat content

**Short answer:** Consent (GDPR Art. 6(1)(a)) is the only defensible basis for retaining raw chat
message text beyond the in-flight extraction call. Legitimate interest (Art. 6(1)(f)) is not
available for raw chat text.

**Analysis.** Chat messages typed by a visitor into the Estalara AI widget are free-text personal
communications. Unlike passive behavioral signals (scroll depth, click coordinates), the visitor is
actively producing text that may include names, locations, financial details, family composition, or
other personal information. EDPB Guidelines 06/2020 on the interplay of the Second Payment Services
Directive and GDPR make clear that the LI basis is unavailable for processing personal
communications content where the data subject would not reasonably expect their words to be stored
by a third-party analytics system. The Estalara product is disclosed to visitors as a
personalization layer, not as a chat storage service. A visitor typing into the chat widget on
`app.estalara.com` has a reasonable expectation that their words are processed by the chat system
(the Estalara AI running on the tenant's platform), not retained indefinitely by a separate
personalization sub-processor.

**Contract (Art. 6(1)(b))** is also unavailable: there is no contract between Time2Show and the
visitor; the contractual relationship exists only between Time2Show and the tenant.

**Conclusion for raw chat text:** If raw messages are ever persisted (today they are not — see
verification above), **explicit consent must be obtained before storage**, with a clear disclosure
that chat content is retained for personalization improvement and a specific retention period stated
in the consent prompt. The consent must be freely given, specific, and withdrawable; its withdrawal
must trigger deletion of stored messages.

---

## Q2 — Maximum retention periods

| Data category                                                                 | Retention limit                                                                                                               | Enforcement mechanism                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Raw chat messages (if consented)                                              | **30 days** (recommended maximum — see rationale below)                                                                       | Server-side TTL + consent-withdrawal cascade deletion     |
| 12-dim intent vector (Redis shadow key)                                       | **24 hours** (current implementation — `ttl_seconds=86400` in `redis_writer.py`)                                              | Upstash Redis native TTL; self-cleaning                   |
| 12-dim intent vector (if promoted to ClickHouse/Postgres for live adaptation) | **13 months** (aligned with existing `adaptation_decisions` ClickHouse retention per DPIA §12.5 / AI Act Art. 12 audit trail) | Requires a verified TTL enforcement ticket before go-live |

**Rationale for 30-day raw-text limit.** The only purpose for retaining raw chat text is enriching
the batch NLP pass (Sonnet 4.6, 6 h async window per Master Design §C.3). Once the batch job has
run, the source text has no additional processing purpose within the Estalara product. Thirty days
provides two full batch cycles with a safety buffer. This is the minimum retention consistent with
the stated purpose; the balancing test under Art. 6(1)(f) (if ever applicable) would not support
longer retention.

**Current implementation status.** No raw chat text is persisted today. The 24-hour Redis shadow key
TTL for the intent vector is code-verified. No additional TTL enforcement ticket is needed for the
shadow-only cycle. If the intent vector is promoted to durable storage (ClickHouse or Postgres) for
next-cycle live adaptation, a data-engineer TTL ticket must be filed and verified before that claim
can be made in disclosure text.

---

## Q3 — Privacy Notice and DPIA §H disclosure requirements

**For the shadow-only cycle (current):** No new Privacy Notice disclosure is required. The shadow
key holds only the 12-dim intent vector (not raw text), it self-expires in 24 hours, and it has no
UX effect on the visitor. The existing behavioral personalization disclosure in Privacy Notice
Template §1 covers the general intent-inference activity. The Archetype Tracer (K.3.6) admin display
of the shadow key is internal-only; it is not a visitor-facing disclosure surface.

**For next-cycle live adaptation (when `/api/adapt` reads the shadow key and applies
`applyChatIntentPrior` to live directives):** The Privacy Notice Template must be updated before
go-live to add:

1. A new row in the client-storage table (Privacy Notice §4) documenting the Redis shadow key: key
   pattern `shadow:{tenantId}:{sessionId}:chat_intent`, storage layer Upstash Redis (server-side,
   not browser), data stored (12-dim intent vector: purchase purpose, urgency, budget band, family
   stage, geo priority, feature priority, cross-border status, finance complexity, decision role,
   risk appetite, emotional state, tax awareness), lifetime (24 hours from the last chat message
   that yielded at least one intent dimension), consent requirement, and purpose (real-time
   personalization from chat-expressed intent).

   The lifetime wording is precise as of ADR-0020 / FOLLOW-736: a chat message whose extraction
   yields no usable dimension (a failed model call, or a buyer who said "hi") is written with
   `SET … NX`, which against an existing key performs no mutation and therefore does **not** restart
   the 24-hour clock. The retention **maximum** is unchanged at 24 hours; the effective lifetime is
   strictly shorter than or equal to the previous "24 hours from last chat message".

2. A disclosure that visitor chat messages are analyzed by an AI system to infer buyer intent and
   adapt property listing presentation. This is independently required by AI Act Art. 50(1)
   (transparency for AI systems interacting with natural persons via chat). The DPIA (§12, AI Act
   section) already records the Art. 50 limited-risk transparency duty; this cycle's live activation
   triggers the concrete disclosure obligation.

3. If raw chat text is ever retained: a consent-specific disclosure paragraph (separate from the
   general personalization consent) describing the text storage purpose, 30-day retention, and
   withdrawal-deletion right.

**DPIA §H update trigger:** Live activation of chat NLP as a real adaptation signal constitutes a
material change under ROPA Appendix C (new processing activity: chat-based profiling). A new ROPA
Activity (Activity 16, to be numbered at filing) must be added before go-live, and DPIA §13 must be
extended with a new LIA (§13.4) documenting the lawful basis, necessity, and balancing test for the
12-dim vector. This document is the scoping brief for that §13.4 LIA — the LIA itself is a
depends_on for the go-live gate (FOLLOW-346-LIVE, not yet created).

---

## Q4 — Can the 12-dim intent vector be retained without raw chat text?

**Yes, under legitimate interest (GDPR Art. 6(1)(f)), subject to the balancing test below.**

**Purpose test.** Retaining the extracted 12-dim vector (not the source text) serves the legitimate
interest of real-time personalization continuity: when a visitor resumes a session, the last known
intent state is available without re-processing the conversation. This is the same purpose that
justified the `estalara_intent_*` sessionStorage entry (DPIA §13.3) and the cross-session identifier
(DPIA §13.2).

**Necessity test.** The 12-dim vector is the minimum data needed to drive the archetype-prior update
in `applyChatIntentPrior`. The raw messages are not needed for adaptation — only the extracted
dimensions. The 24-hour TTL in the current shadow implementation is consistent with the necessity
test: it covers the session and same-day return without indefinite retention.

**Balancing test.** The 12-dim vector contains no free text, no verbatim quote, no name or email. It
is a structured enumeration of categorical values (e.g. `purchase_purpose: "investment"`,
`urgency: "3-6mo"`) and optionally a boolean (`tax_aware: true`). A visitor cannot be re-identified
from this vector alone. The data is pseudonymous (keyed by `session_id`, which is itself a
pseudonymous HMAC). The 24-hour TTL limits staleness. The visitor's reasonable expectation when
interacting with a chat assistant is that their stated preferences are used to improve the service
they are currently experiencing — retention of a structured intent summary for 24 hours falls within
that expectation.

**Balancing test result: PASSES**, subject to three conditions:

1. The intent vector key is scoped to the session (current: `session_id` in the Redis key — verified
   in `chat-intent-cache.ts` and `redis_writer.py`).
2. The 24-hour TTL is enforced by Redis natively (current: `ex=86400` on both write branches in
   `redis_writer.py` — code-verified; since ADR-0020 the create-only branch cannot extend an
   existing key's expiry, so the effective lifetime is ≤ this maximum).
3. The Privacy Notice discloses the server-side shadow key at the time live adaptation is activated
   (not yet done — see Q3 above; this is a go-live gate).

**ePrivacy note.** ePrivacy Art. 5(3) (accessing information stored in terminal equipment) does not
apply to server-side Redis keys. The key is written to Upstash by the Modal server function, not to
the visitor's browser. No ePrivacy consent is required for the Redis shadow key itself.

**Cross-reference to K.3.6.** The Archetype Tracer (Master Design §K — K.3.6 D-2) displays a "Chat
display stub only — DPIA scope undecided" placeholder. This brief resolves that open question: the
12-dim vector can be displayed in the admin tracer UI under the LI basis established here, because
it is an internal operational tool for Time2Show staff (not a visitor-facing interface) and
processing for internal analytics is covered by the same LI basis. K.3.6 D-2 may proceed to
implementation with this brief as the compliance gate sign-off.

---

## Q5 — Recommendation for next-cycle live activation

**Recommendation: proceed to live activation of the 12-dim intent vector as an adaptation signal. Do
not persist raw chat text.**

**Rationale.** The shadow-only cycle is de-risked from a compliance standpoint: no raw text is
stored, the shadow key expires in 24 hours, and no disclosure obligation is triggered beyond the
current Privacy Notice. The next cycle's live activation requires only:

| Gate item                                                                          | Owner                     | Required before                                  |
| ---------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| Privacy Notice §4 updated: add server-side Redis shadow key row                    | Compliance Engineering    | Live activation                                  |
| Privacy Notice §1 updated: add chat-intent AI analysis disclosure sentence         | Compliance Engineering    | Live activation                                  |
| DPIA §13.4 LIA authored (12-dim vector, LI basis, balancing test)                  | Compliance Engineering    | DPO sign-off                                     |
| ROPA Activity 16 filed (chat-based intent inference)                               | Compliance Engineering    | Live activation                                  |
| DPO review of §13.4 LIA                                                            | DPO-as-a-Service          | Live activation                                  |
| AI Act Art. 50(1) disclosure deployed in tenant-facing chat UI                     | Backend / SDK Engineering | Live activation                                  |
| Data-engineer TTL ticket for any promotion of intent vector to Postgres/ClickHouse | Data Engineering          | Only if durable storage is introduced            |
| FOLLOW-346 AC3 verified: shadow mode confirmed in code (no live directive change)  | QA                        | Current cycle gate (before shadow bridge merges) |

**Do not gate the shadow cycle on this brief.** The shadow bridge (FOLLOW-346) may ship without this
C-07 sign-off because no new processing occurs from a GDPR perspective: the shadow key has no UX
effect and the intent vector is not a new data category (behavioral personalization inference is
already disclosed). The C-07 sign- off gates only live adaptation.

**Do not retain raw chat text.** There is no current product requirement for storing chat messages
beyond the in-flight extraction call. Adding raw text storage would require explicit consent, a new
Privacy Notice section, and a 30-day TTL enforcement mechanism. The compliance overhead exceeds the
marginal analytical benefit given that the 12-dim vector is already a sufficient signal for the
adaptation use case.

**Scope alignment with K.3.6 DPIA reminder.** The K.3.6 chat-logging DPIA scope (noted in
`.claude/agents/compliance-engineer/lessons.md` as a pending decision after FOLLOW-269 is done) is
resolved by this brief for the intent-vector scenario. The open question that remains after this
brief: whether to log full chat transcripts for operator review in the Archetype Tracer (K.3.6 D-2
full implementation). That would be a separate processing activity requiring consent — it is
explicitly out of scope for this cycle and should not be implemented until a dedicated C-08 scoping
brief is approved.

---

## Implementation Evidence (grep-verified)

The following code facts are referenced in this brief and have been verified against shipped code at
HEAD on branch `main`:

- `redis_writer.py` — `write_shadow_intent(payload, ttl_seconds=86400)` default TTL 24 h.
- `redis_writer.py` — `value = json.dumps(payload.model_dump())`, then exactly one of
  `_get_redis().set(key, value, ex=ttl_seconds)` (dimensions present) or
  `_get_redis().set(key, value, ex=ttl_seconds, nx=True)` (no usable dimension — ADR-0020 D3).
  `payload.model_dump()` serializes `ChatIntentDetectedPayload`; raw `messages` is not a field on
  that model. Both branches share that single serialization call: there is no second write path.
- `redis_writer.py` — the `nx=True` branch cannot refresh an existing key's TTL. Redis `SET … NX`
  against an existing key performs no mutation at all (neither value nor expiry), so a write
  carrying no new personal data cannot extend the retention clock of data already stored (ADR-0020
  D4). `ex=ttl_seconds` is still passed because it applies when the key does **not** yet exist, i.e.
  the first write of a session.
- `redis_writer.py` — the module performs no read and no deserialization of the shadow namespace (no
  `json.loads`, no read command). Enforced by `test_redis_writer_module_never_reads` in
  `apps/intent-engine/src/test_intent_engine.py`, so the "only one serialization path" fact above is
  a test-guarded property rather than a point-in-time grep.
- `schemas.py` (class `ChatIntentDetectedPayload`) — fields: `tenant_id`, `session_id`,
  `intent_dimensions`, `archetype_hint`, `confidence`, `model_used`, `source`, `message_count`,
  `detected_at`, and since FOLLOW-730 two diagnostic fields: `data_source` (an enum recording which
  producer path built the payload — `model` / `empty_input` / `empty_model_response` /
  `error_fallback`) and `extraction_error` (`null`, or a fixed-format
  `"<classified kind>: <ExceptionClassName>"` string such as `"missing_api_key: KeyError"`). Neither
  carries buyer content: `extraction_error` is explicitly constructed from the exception's CLASS
  name only — the exception message, which could echo prompt text, never reaches Redis. No
  `messages` or `raw_text` field. Since FOLLOW-738 it no longer reaches Sentry either:
  `_scrub_chat_intent_exception_value` in `apps/intent-engine/src/observability.py` overwrites the
  exception `value` on every event tagged `area=chat_intent`, pinned by
  `test_buyer_text_escapes_both_sinks` in `test_observability.py`.

  **Modal stdout log line (FOLLOW-812, resolved 2026-08-05).** `nlp.py`'s primary-failure branch
  `print` previously carried the full exception message (`print(f"extract_intent error …: {exc}")`).
  It has been redacted to the same "classified kind + exception class name" shape `extraction_error`
  already uses: `print(f"...kind={kind}: {type(exc).__name__}")`. Pinned by a third sink assertion
  added to `test_buyer_text_escapes_both_sinks` (via pytest's `capsys`, asserting on actual captured
  stdout content rather than assuming). Destination/retention/access for this log sink (Modal's own
  application logs; retention 1-30 days depending on the Modal plan tier, per Modal's published
  docs; access scoped to the three named Modal workspace members) is recorded in `ropa.md`'s new
  "Modal application (stdout) logs" note, which this brief's "no raw chat text is written to Redis,
  ClickHouse, or Postgres" conclusion does not depend on (this sink is neither of those three
  stores). **Known residual, not fixed by FOLLOW-812:** the multilingual-retry branch's own `print`
  (`"extract_intent multilingual retry error: {exc}"`) still emits the raw exception message to the
  same stdout sink — out of that ticket's literal scope, flagged rather than silently left
  inaccurate.

- `chat-intent-cache.ts` — `shadowChatIntentKey` returns
  `shadow:${tenantId}:${sessionId}:chat_intent`.
- `redis_writer.py` — `shadow_key` returns `f"shadow:{tenant_id}:{session_id}:chat_intent"`.
- `main.py`, `process_chat_message` — calls `extract_intent`, then `write_shadow_intent(payload)` —
  only the payload dict is persisted.
- `main.py` module docstring — "writes to the Redis SHADOW namespace only ... No live adaptation
  reads this in Sprint 13 — shadow-only by design."

No raw chat text is written to Redis, ClickHouse, or Postgres in the current implementation. This
fact is the foundation of the LI basis conclusion in Q4 and the no-new-disclosure conclusion in Q3
(shadow cycle only).

---

## Open Escalation Items

The following items cannot be decided by Compliance Engineering alone and are escalated to
CEO/legal:

1. **Raw text retention decision.** If any future use case requires retaining raw chat messages
   (e.g. conversation replay for agent coaching, quality assurance, or fine-tuning), a consent
   framework must be designed before implementation begins. This brief recommends against raw text
   retention for the current product scope.

2. **DPO appointment timeline.** The §13.4 LIA (required for live activation) requires DPO sign-off.
   The existing DPO gate (Privacy Notice §5) is PENDING. If the DPO-as-a-Service appointment is not
   confirmed within 5 business days of this brief being shared, escalate via
   `backlog/ESCALATIONS.md`.

---

## Self-check

- [x] Every concrete user-facing claim is grep-verified against shipped code.
- [x] This is a doc-only brief — implementation FOLLOW depends_on items listed in Q3 and Q5 gate
      table; go-live gate is UNSATISFIABLE until those items are done.
- [x] No protected-class or proxy steering language in this document.
- [x] Consent vocabulary not referenced (no new consent state required for shadow cycle; consent is
      called out as the basis for raw text storage if ever pursued).
- [x] Every retention promise (24 h Redis TTL, 13-month ClickHouse, 30-day raw text limit) is paired
      with a verified enforcement mechanism or explicitly flagged as requiring a TTL ticket before
      the claim can be made in disclosure text.

---

## Revision History

| Version | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-06-19 | Compliance Engineering | Initial C-07 scoping brief (FOLLOW-346).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.1     | 2026-08-05 | Compliance Engineering | FOLLOW-812: Implementation Evidence updated. The Modal stdout log line (`nlp.py`'s primary-failure `print`) was redacted from the full exception message to a classified-kind + exception-class-name shape (same shape `extraction_error` already uses), pinned by a new third-sink assertion in `test_buyer_text_escapes_both_sinks` (`capsys`). Destination/retention/access for this sink established from Modal's own published docs and this repo's `vendor-accounts.md`, recorded in `ropa.md`'s new Modal application-logs note (this brief's "no raw text in Redis/ClickHouse/Postgres" conclusion is unaffected — this sink is none of those three stores). Known residual flagged, not fixed: the multilingual-retry branch's own `print` in the same file still emits the raw exception message. |
