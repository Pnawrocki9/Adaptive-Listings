# C-07 — Chat Free-Text Retention: DPIA Scope Brief

**Document ID:** ESTALARA-C-07 **Version:** 1.2 **Date:** 2026-08-07 **Author:** Compliance
Engineering **Classification:** Internal — Restricted **Status:** PENDING CEO decision (items marked
below); Q1 and Q3 additionally FLAGGED FOR RE-REVIEW as of v1.2 — see the correction notice below
**DPIA cross-reference:** DPIA §13 (LIA series) — this brief defines the §14 scope **FOLLOW:**
FOLLOW-346 (shadow bridge) — go-live gate on CEO decision recorded here; FOLLOW-866 (v1.2
correction)

---

## Correction notice (v1.2, 2026-08-07, FOLLOW-866 / ESC-049)

**What changed.** v1.1's Context paragraph and Implementation Evidence section twice stated, without
having checked ClickHouse or Postgres, that "No raw chat text is written to Redis, ClickHouse, or
Postgres in the current implementation." That claim was verified only against
`apps/intent-engine/src/redis_writer.py` — one of the three named stores. ESC-049 (CEO/DPO ruling,
2026-08-07, `backlog/ESCALATIONS.md`) confirmed the gap: the `chat.message.sent` event's
PII-scrubbed-for-email/phone-only message text, up to 4000 characters, **is** written into the
ClickHouse `events` table by deliberate §H.8 design (Master Design), retained there for 13 months
(the table's configured TTL). Redis and Postgres are unaffected by the correction — both are
re-verified below. See the corrected Context and Implementation Evidence sections for full
citations.

**What this means for this document's other conclusions.**

- **Q1** — its conclusion is conditioned on "if raw messages are ever persisted (today they are
  not)". That antecedent is now known false: message text that the scrubber does not catch (names,
  financial detail, family composition — the scrubber only matches email/phone patterns) is
  persisted today. Whether that satisfies Q1's own "explicit consent must be obtained" trigger is a
  lawful-basis judgment this correction does not resolve unilaterally — **flagged, not answered,
  pending a fresh CEO/DPO ruling.**
- **Q2** — its "Current implementation status" paragraph is corrected below (a factual restatement
  of the same premise, not itself a judgment call).
- **Q3** — re-derived against the corrected premise; reasoning shown in the FOLLOW-866 pull request
  description (not duplicated here to avoid a second, driftable copy). The re-derivation concludes
  the "No new Privacy Notice disclosure is required" claim for the current cycle **appears to
  change**: storing actual message content, even partially scrubbed, for 13 months is a materially
  different processing activity than the general behavioral-inference disclosure this section relies
  on. Per this ticket's AC(2), that is a STOP condition — **this correction does not rewrite Q3's
  conclusion. It is flagged pending CEO/DPO re-ruling**, marked inline below.
- **Q4** — re-derived against the corrected premise; reasoning shown in the FOLLOW-866 pull request
  description. Q4's balancing test is scoped to the 12-dim vector only, which the corrected premise
  does not touch (the vector still contains no free text and is unaffected by what happens to the
  separately-stored message text). **Conclusion UNCHANGED**, confirmed inline below.
- **Q5** — its "there is no current product requirement for storing chat messages beyond the
  in-flight extraction call" sentence is corrected below (factual, not a judgment call); the
  recommendation itself is otherwise unresolved pending the Q1/Q3 re-ruling above.

**Not fixed by this correction (found while verifying it, out of this ticket's scope, flagged for a
separate escalation):** `packages/sdk/src/ui/consent-banner.ts:166` and
`apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts:138` — both user-facing
consent copy, both owned by a concurrent worker on this ticket and out of scope here — assert the
same corrected claim to real data subjects ("Raw chat text is not stored in the personalization
system" / "we do not store the full text of your messages in our personalization system"). See the
FOLLOW-866 pull request description.

---

## Context

The chat NLP bridge ships **shadow-only** in the current cycle (FOLLOW-346). The `chat.message.sent`
event is routed to `process_chat_message` in `apps/intent-engine/src/main.py`. The NLP extractor
reads the raw chat text from the `messages` list, calls Claude Haiku 4.5 (real-time) or Sonnet 4.6
(batch), and writes the resulting 12-dimensional intent vector — not the raw text — to a Redis
shadow key (`shadow:{tenant_id}:{session_id}:chat_intent`, TTL 24 h) in Upstash Redis. No
**unscrubbed identifiers** — raw, un-redacted email addresses or phone numbers — reach the Redis
shadow key or Postgres (verified: `apps/intent-engine/src/redis_writer.py`, `write_shadow_intent`
serializes `payload.model_dump()` which is `ChatIntentDetectedPayload` — no `messages` field on that
model; `apps/intent-engine/src/schemas.py`, class `ChatIntentDetectedPayload`; no Postgres table
defined in `packages/db/src/schema/` carries a chat message field, and neither `apps/intent-engine`
nor `apps/stream-consumer` — the only two backend services that touch chat text — import a Postgres
client at all). Line numbers for the Redis/schema citations above are omitted deliberately:
FOLLOW-730 shifted them, and a citation that drifts is worse than none.

**Correction (v1.2, FOLLOW-866): this is narrower than v1.1's claim.** The buyer's chat message TEXT
itself — PII-scrubbed for email addresses and phone numbers only, up to 4000 characters — IS written
to ClickHouse, on a path independent of the shadow/live boundary above, by deliberate §H.8 design
(Master Design). `chat.message.sent.payload.message` is emitted by the SDK
(`packages/sdk/src/index.ts:1518-1521`), validated against
`ChatMessageSentPayloadSchema.message: z.string().min(1).max(4000)`
(`packages/shared/src/schemas/events/chat.ts:39-40`), and written verbatim as
`JSON.stringify(event.payload ?? {})` into the ClickHouse `events` table's
`payload String CODEC(ZSTD(3))` column (`apps/ingest/src/clickhouse-producer.ts:142`). This happens
on every `chat.message.sent` event regardless of whether the shadow key above is ever promoted to
live adaptation — the schema's own comment states the design intent: "§H.8 invariant: the chat event
STILL flows to ingest (ClickHouse) regardless of this flag." (`chat.ts:56-57`). Retention: **13
months**, the `events` table's currently-configured TTL — `TTL toDateTime(ts) + INTERVAL 13 MONTH`
(`infra/clickhouse/migrations/0001_create_events.sql:46`); no shorter, chat-specific TTL exists, and
no later migration alters it (the same migration's own header comment floats a future per-tenant
override "layered in Sprint 9" that was never shipped — `0001_create_events.sql:10-11`,
grep-verified absent from every later migration file). See "Implementation Evidence" below for the
full three-store verification.

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

**Conclusion for raw chat text:** If raw messages are ever persisted, **explicit consent must be
obtained before storage**, with a clear disclosure that chat content is retained for personalization
improvement and a specific retention period stated in the consent prompt. The consent must be freely
given, specific, and withdrawable; its withdrawal must trigger deletion of stored messages.

> **FLAGGED FOR RE-REVIEW (v1.2, FOLLOW-866).** This conclusion's antecedent was written as "today
> they are not [persisted]" in v1.1. That is now known false — see the Context correction above:
> `chat.message.sent.payload.message` (PII-scrubbed for email/phone only — names, financial detail,
> and family composition are NOT scrubbed) is persisted in ClickHouse today. Whether that satisfies
> "raw messages are ever persisted" in this Q1's own sense, and therefore whether the
> explicit-consent trigger above is live now rather than hypothetical, is a lawful-basis judgment
> this correction does **not** resolve. Escalated, not answered here.

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

**Current implementation status.** No _unscrubbed-identifier_ chat text is persisted today (see the
Context correction, v1.2/FOLLOW-866). The chat message text itself — PII-scrubbed for email/phone
only, ≤4000 chars — is already persisted today, in ClickHouse, for 13 months, on the `events`
table's existing TTL (`infra/clickhouse/migrations/0001_create_events.sql:46`) — this is a **live**
store, not a "next-cycle if promoted" scenario; the row above ("if promoted to ClickHouse/Postgres …
13 months … requires a verified TTL enforcement ticket") describes the separate 12-dim _vector_,
which has not been promoted. The 24-hour Redis shadow key TTL for the intent vector is
code-verified. No additional TTL enforcement ticket is needed for the shadow-only cycle's vector.

---

## Q3 — Privacy Notice and DPIA §H disclosure requirements

**For the shadow-only cycle (current):** No new Privacy Notice disclosure is required. The shadow
key holds only the 12-dim intent vector (not raw text), it self-expires in 24 hours, and it has no
UX effect on the visitor. The existing behavioral personalization disclosure in Privacy Notice
Template §1 covers the general intent-inference activity. The Archetype Tracer (K.3.6) admin display
of the shadow key is internal-only; it is not a visitor-facing disclosure surface.

> **FLAGGED FOR RE-REVIEW (v1.2, FOLLOW-866) — conclusion appears to change, not rewritten here.**
> This paragraph's claim is scoped to "the shadow key" (Redis), which is accurate on its own terms.
> It does not follow that "no new disclosure is required" for the current cycle overall: the
> corrected Context section shows the buyer's actual (partially-scrubbed) chat message text is
> separately retained in ClickHouse for 13 months today, independent of the
> shadow-key/live-adaptation distinction this paragraph draws. Storing 13 months of real message
> content is a materially different, higher-risk processing activity than the general
> behavioral-personalization disclosure in Privacy Notice §1 was written to cover (per this brief's
> own Q1 analysis of why chat free text is different from passive behavioral signals). Full
> re-derivation and reasoning: FOLLOW-866 pull request description. Per that ticket's AC(2), this
> correction does **not** flip "No new disclosure is required" to "a new disclosure is required" —
> that is a compliance judgment reserved to CEO/DPO. **Escalated, not answered here.**

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

> **Re-derived (v1.2, 2026-08-07, FOLLOW-866) against the corrected ClickHouse-store premise —
> conclusion UNCHANGED.** This Q4 analysis is scoped to the 12-dim vector alone; every sentence in
> Purpose/Necessity/Balancing above is about the vector's own content, which the correction does not
> touch — the vector still contains no free text, no verbatim quote, no name, and the corrected
> Context section does not add any of that to it. What changed is a _separate_ store (the raw-ish
> message text in ClickHouse), which this Q4 never relied on being absent. Full reasoning:
> FOLLOW-866 pull request description.

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

**Recommendation: proceed to live activation of the 12-dim intent vector as an adaptation signal.**

> **FLAGGED FOR RE-REVIEW (v1.2, FOLLOW-866).** This recommendation and rationale, and the item
> below titled "Do not retain raw chat text", were written on the v1.1 premise that no chat text is
> retained anywhere. That premise is corrected above (Context, Q1, Q2). The vector-activation
> recommendation itself does not depend on the corrected fact (Q4's re-derivation shows the vector's
> own LI basis is unaffected), so it is left standing. The "de-risked … no raw text is stored"
> framing immediately below, and the "no current product requirement for storing chat messages"
> sentence further down, are factually corrected inline. The overall go/no-go recommendation for
> live activation is not re-derived here — that call, and whether it should now also require
> resolving the Q1/Q3 flags above, is escalated pending CEO/DPO ruling.

**Rationale.** The shadow-only cycle stores only the 12-dim vector for live-adaptation purposes: the
shadow key expires in 24 hours, and no disclosure obligation beyond the current Privacy Notice is
triggered _for the vector_. (Corrected v1.2: this no longer claims "no raw text is stored" anywhere
— see Context.) The next cycle's live activation requires only:

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

**Correction (v1.2, FOLLOW-866) — was "Do not retain raw chat text":** that heading and the sentence
"There is no current product requirement for storing chat messages beyond the in-flight extraction
call" are factually wrong as of this correction — chat message text (PII-scrubbed for email/phone
only) IS retained today, in ClickHouse, for 13 months, by deliberate §H.8 design (see Context). This
brief's original v1.1 recommendation to _avoid_ raw text storage going forward is therefore already
overtaken by shipped, intentional behavior; it is not this document's call to decide whether that
design should change. Flagged for CEO/DPO re-review together with Q1/Q3 above.

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
  `test_buyer_text_escapes_all_sinks` in `test_observability.py` (renamed by FOLLOW-832, formerly
  `test_buyer_text_escapes_both_sinks`).

  **Modal stdout log line (FOLLOW-812, resolved 2026-08-05).** `nlp.py`'s primary-failure branch
  `print` previously carried the full exception message (`print(f"extract_intent error …: {exc}")`).
  It has been redacted to the same "classified kind + exception class name" shape `extraction_error`
  already uses: `print(f"...kind={kind}: {type(exc).__name__}")`. Pinned by a third sink assertion
  in `test_buyer_text_escapes_all_sinks` (via pytest's `capsys`, asserting on actual captured stdout
  content rather than assuming). Destination/retention/access for this log sink (Modal's own
  application logs; retention 1-30 days depending on the Modal plan tier, per Modal's published
  docs; access scoped to the three named Modal workspace members) is recorded in `ropa.md`'s new
  "Modal application (stdout) logs" note, which this brief's Redis/Postgres verification below does
  not depend on (this sink is neither of the three stores named in this brief). **The
  multilingual-retry branch's sibling `print` is redacted too** (Rule S, same PR, PM-validation
  round): it calls Sonnet with the same buyer messages, so it carried the identical risk, and it now
  emits `kind=<kind>: <ExceptionClassName>` in the same shape. Both arms are pinned by
  `test_buyer_text_escapes_all_sinks` — arm 3 drives the primary branch, arm 3b drives the retry
  branch (first model call returns a low-confidence mixed-language read so the §C.3 retry triggers,
  second call raises); as of FOLLOW-832, arm 3b's assertion also covers the Redis-bound
  `extraction_error` field the retry branch writes (`nlp.py:563`), not only its stdout print.
  Non-vacuity was proven by perturbation on both.

- `chat-intent-cache.ts` — `shadowChatIntentKey` returns
  `shadow:${tenantId}:${sessionId}:chat_intent`.
- `redis_writer.py` — `shadow_key` returns `f"shadow:{tenant_id}:{session_id}:chat_intent"`.
- `main.py`, `process_chat_message` — calls `extract_intent`, then `write_shadow_intent(payload)` —
  only the payload dict is persisted.
- `main.py` module docstring — "writes to the Redis SHADOW namespace only ... No live adaptation
  reads this in Sprint 13 — shadow-only by design."

**ClickHouse (added v1.2, FOLLOW-866 — corrects the store this brief previously did not check):**

- `packages/sdk/src/index.ts:1518-1521` — the SDK's `chat.message.sent` listener pushes
  `{ type: 'chat.message.sent', payload: { message: scrubMessagePii(rawMessage), ... } }` onto the
  event queue on every buyer chat message with non-empty text.
- `packages/sdk/src/core/pii-scrub.ts:22-27` — `scrubMessagePii` replaces email addresses
  (`EMAIL_RE`) and phone numbers (`PHONE_RE`, ≥7 digits) with `[email]` / `[phone]` placeholders,
  then truncates to 4000 characters. It does not claim exhaustive PII coverage in its own doc
  comment (`pii-scrub.ts:4-5`): names, addresses, and financial details typed in chat are not
  scrubbed.
- `packages/shared/src/schemas/events/chat.ts:39-40` —
  `ChatMessageSentPayloadSchema.message: z.string().min(1).max(4000)`. `:56-57` states the design
  intent explicitly: "§H.8 invariant: the chat event STILL flows to ingest (ClickHouse) regardless
  of this flag" (the flag being `profiling_opt_out`).
- `apps/ingest/src/clickhouse-producer.ts:142` — `toClickHouseRow` maps
  `payload: JSON.stringify(event.payload ?? {})` into the row inserted by `INSERT INTO events`. The
  same file's own module docstring (`:19-23`, FOLLOW-845) independently confirms: "The rows this
  module POSTs carry `payload: JSON.stringify(event.payload)`, and for `chat.message.sent` that
  payload is up to 4000 characters of buyer-authored chat text."
- `infra/clickhouse/migrations/0001_create_events.sql:46` — `TTL toDateTime(ts) + INTERVAL 13 MONTH`
  on the `events` table (no shorter, chat-specific TTL exists; `:10-11`'s note about a future
  per-tenant override was never shipped — grep-verified absent from every later migration in
  `infra/clickhouse/migrations/`).
- `apps/stream-consumer/src/consumers/events.py:57-59` — the Modal-dispatch fire-and-forget spawn (a
  different write path, feeding `process_chat_message`) is correctly scoped in its own comment: "No
  raw chat text is written to ClickHouse or Postgres **by this function**." That is accurate — the
  ClickHouse write happens via `ch.insert_events(batch)` (`:200`), a different code path in the same
  file, not this one.

**Postgres (added v1.2, FOLLOW-866 — the store ESC-049 flagged as never checked at all):**

- `packages/db/src/schema/*.ts` (28 files, Drizzle table definitions) and
  `packages/db/migrations/*.sql` (37 migration files) — grep for `message` across both returns zero
  matches. No table defines a chat message / raw text / free text column.
- `packages/db/src/schema/intent-sessions.ts` — the one Postgres table storing chat-adjacent state
  (`intent_sessions`, the K.3.6 tracer's mutable head) holds `sessionId`, `crossSessionId`,
  timestamps, and (per its own module docstring) accumulator state — no message field.
- `apps/intent-engine/src/*.py` and `apps/stream-consumer/src/**/*.py` — the only two backend
  services that read the buyer's chat text — contain zero imports of `psycopg`, `asyncpg`,
  `DATABASE_URL`, or `supabase`; grep-verified absent. Neither has a Postgres client at all, so
  neither has a code path capable of writing chat text to Postgres.
- `apps/ingest/src/handlers/events.ts` (the Cloudflare Worker that receives `chat.message.sent`) —
  contains no Postgres reference; it only enqueues to Redpanda / posts directly to ClickHouse
  (`clickhouse-producer.ts`) and fires the Modal dispatch.

**Corrected conclusion (v1.2, replaces the v1.1 sentence below this brief's Implementation Evidence
section):** No **unscrubbed identifiers** are written to Redis, ClickHouse, or Postgres in the
current implementation. The buyer's chat message text — PII-scrubbed for emails/phones only, ≤4000
characters — **is** written to ClickHouse (`events.payload`), retained for 13 months, by deliberate
§H.8 design; it is not written to Redis or Postgres. This corrected fact is the premise Q3 and Q4
were re-derived against (see the flags inline in Q3/Q4 above): Q4's LI-basis conclusion is
unaffected; Q3's no-new-disclosure conclusion appears to change and is flagged, not resolved,
pending CEO/DPO ruling.

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
- [x] Every retention promise (24 h Redis TTL, 13-month ClickHouse vector-promotion, 30-day raw text
      limit) is paired with a verified enforcement mechanism or explicitly flagged as requiring a
      TTL ticket before the claim can be made in disclosure text.
- [x] v1.2: the 13-month ClickHouse retention for `chat.message.sent.payload.message` (the newly
      corrected store) is paired with a verified, already-shipped TTL —
      `infra/clickhouse/migrations/0001_create_events.sql:46` — not a promise pending a future
      ticket; no data-engineer TTL ticket is needed because the enforcement mechanism already
      exists.

---

## Revision History

| Version | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-06-19 | Compliance Engineering | Initial C-07 scoping brief (FOLLOW-346).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.1     | 2026-08-05 | Compliance Engineering | FOLLOW-812: Implementation Evidence updated. The Modal stdout log line (`nlp.py`'s primary-failure `print`) was redacted from the full exception message to a classified-kind + exception-class-name shape (same shape `extraction_error` already uses), pinned by a new third-sink assertion in `test_buyer_text_escapes_both_sinks` (`capsys`). Destination/retention/access for this sink established from Modal's own published docs and this repo's `vendor-accounts.md`, recorded in `ropa.md`'s new Modal application-logs note (this brief's "no raw text in Redis/ClickHouse/Postgres" conclusion is unaffected — this sink is none of those three stores). The multilingual-retry branch's sibling `print` was redacted in the same change (Rule S) and is pinned by sink 3b of the same test; no residual raw-exception `print` remains on this sink. **Correction (v1.2, FOLLOW-866): the twice-repeated "no raw chat text is written to Redis, ClickHouse, or Postgres" sentence this row's own change note echoes was, at the time of this v1.1 revision and every revision before it, verified against only ONE of the three named stores (`redis_writer.py`) — ClickHouse and Postgres were never actually checked. The claim was false as an ordinary reader would read it: `chat.message.sent.payload.message` (PII-scrubbed for email/phone only, ≤4000 chars) has been written into ClickHouse's `events` table by deliberate §H.8 design since before this row's own date.**                                                                                                                                                                                                                                                                                                                                                                             |
| 1.2     | 2026-08-07 | Compliance Engineering | FOLLOW-866 (ESC-049 CEO/DPO ruling, option 1 — scope the sentence to reality, the ClickHouse write is deliberate §H.8 design). Both instances of the "no raw chat text …" sentence (Context, Implementation Evidence) rewritten to: state explicitly that no **unscrubbed identifiers** reach any of the three stores, AND state what IS retained in ClickHouse (`chat.message.sent.payload.message`, ≤4000 chars, emails/phones replaced, retained per the `events` table's existing 13-month TTL, `0001_create_events.sql:46` — cited from the actual migration, not guessed). All three stores re-verified with citations (Redis: unaffected, re-confirmed; ClickHouse: corrected, full write-path citation added SDK→schema→producer→migration; Postgres: newly verified — zero `message`-bearing tables across 28 schema files / 37 migrations, and neither `apps/intent-engine` nor `apps/stream-consumer` imports a Postgres client at all). §Q3 and §Q4 re-derived against the corrected premise: **Q4 (LI basis, 12-dim vector) — conclusion UNCHANGED**, the vector's own content is untouched by the correction; **Q3 (no-new-disclosure) — conclusion APPEARS TO CHANGE**, flagged inline and in the FOLLOW-866 PR rather than rewritten, per that ticket's AC(2) STOP condition. Q1's and Q5's factual predicates (both restated the same false premise) corrected inline and similarly flagged where they feed a lawful-basis judgment. `ropa.md` and `dpia.md` swept for restatements and corrected in the same PR (dpia.md §8 excluded — owned by a concurrent worker); two live user-facing consent-copy restatements found (`packages/sdk/src/ui/consent-banner.ts`, `apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts`) are both on surfaces a concurrent worker owns and are flagged, not edited, in the FOLLOW-866 PR description. |
