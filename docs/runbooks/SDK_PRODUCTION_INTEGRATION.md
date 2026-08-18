# SDK Production Integration — what must be true for full adaptation

**Audience:** Rafał (CTO), integrating `@estalara/sdk` into the production `app.estalara.com`
SvelteKit app (and any future tenant host).

**Status:** authored 2026-06-22, verified end-to-end against the real SvelteKit listing flow in a
real browser. Backing design:
[ADR-0014](../adr/ADR-0014-cross-listing-adaptation-and-sot-archetype.md).

This document lists **every** condition the host page and platform must satisfy for the SDK to adapt
correctly — including the non-obvious ones that silently break the 2nd+ listing in a single-page app
while leaving the 1st listing working. Items are marked:

- **[HOST]** — Rafał must implement on the host page / SvelteKit app.
- **[PLATFORM]** — decision API / SDK delivery. Most are **already wired**; flagged where so.
- **[INFO]** — behavior to be aware of; no action needed.

---

## 1. DOM contract on the listing detail page **[HOST] — action required**

The SDK only mutates elements it can find. The listing root and the adaptation slots must be marked.

| Attribute                                          | On which element                | Required                         |
| -------------------------------------------------- | ------------------------------- | -------------------------------- |
| `data-estalara-listing` (value empty)              | the listing root container      | **yes**                          |
| `data-estalara-listing-id="<stable listing UUID>"` | the **same** root element       | **yes**                          |
| `data-estalara-slot="headline"`                    | the headline target element     | yes (for headline adaptation)    |
| `data-estalara-slot="description"`                 | the long-form description block | yes (for description adaptation) |

> No-code tenants that cannot hand-place slots get them auto-annotated at runtime from the detected
> `slot_selectors` (ADR-0008 `annotateSlots`), applied on **every** `refreshDirectives()`. The
> `data-estalara-listing` + `data-estalara-listing-id` root markers are still required as the
> listing-identity anchor.

## 2. ⚠️ The listing id MUST update in place on SPA navigation **[HOST] — the #1 gotcha**

This is the single most important and least obvious requirement.

On client-side navigation between two listings (same route, different slug), SvelteKit **reuses the
same DOM node** for the listing root and updates its bindings in place. The SDK detects "the buyer
moved to a different listing" by watching `data-estalara-listing-id` for a value change (a
`MutationObserver` with `attributeFilter: ['data-estalara-listing-id']`). Therefore:

- ✅ Bind the attribute to the current listing's id so it **changes** when the route param changes:
  `data-estalara-listing-id={property.uuid}`. (This is already the case in
  `(buyer)/[lang]/listing/[slug]/+page.svelte`.)
- ❌ Do **not** hard-code it, cache it, or compute it once. If the value does not change on
  navigation, the SDK never re-runs adaptation → the 2nd listing keeps the 1st listing's copy.
- The id must be **stable and unique per listing** (the listing UUID). It is sent to the decision
  API as `listing_id` and used as the per-listing description/cache key.

A full page reload also works (the SDK re-inits and rehydrates from sessionStorage). It is **only**
SPA navigation that depends on the in-place attribute update.

The SDK also handles **remount-style** navigation (listing → browse/search page → listing, or a
back-button return) where the framework destroys and recreates the listing root node: it emits the
internal "listing viewed" signal the moment a `data-estalara-listing` node is (re)added, and tracks
the root node identity so even returning to the **same** listing re-adapts. No host action beyond §1
is needed for this — just keep the two root attributes on whatever node renders the listing.

## 3. SDK bundle delivery & caching **[PLATFORM] — action required**

The SDK is loaded via `<script async src="https://admin.estalara.com/...estalara-sdk...js">`.

- The `<script async>` is parsed once per **full document load**. It is **not** re-fetched on SPA
  navigation. A redeployed SDK therefore only reaches a returning single-page session after a hard
  reload.
- **Action:** serve the production bundle from a **versioned / content-hashed URL** (e.g.
  `estalara-sdk.<gitsha>.js`) and bump the snippet's `src` on each release, **or** serve it with a
  short `max-age` + revalidation. Do **not** serve it `immutable` at a stable URL — a bad build
  would then be pinned in browsers.
- For local dev the decision mock now sends `Cache-Control: no-store` on the bundle so rebuilds are
  picked up on reload; production needs the versioned-URL equivalent.

## 4. Decision API contract **[PLATFORM] — already wired, do not regress**

`POST /api/adapt` and `GET /api/adapt/description` on `admin.estalara.com` already satisfy the SDK's
expectations (verified in `apps/control-plane/src/app/api/adapt/route.ts` and `.../description`):

- **`archetype_hint` is honored.** The SDK sends
  `{ archetype_hint, confidence, similarity, listing_id, session_id, page_type, locale, consent_state, lead_id }`.
  The route uses `archetypeId = body.archetype_hint ?? 'neutral'` to drive the decision tree. This
  is what makes the quiz / source-of-truth archetype actually change production copy — keep it.
- **Neutral cold-start contract.** `archetype_hint: 'neutral'` must yield a no-/neutral-directive
  response (no forced archetype). The SDK sends `neutral` at cold start and treats an empty/neutral
  response as "leave the page as-is". Do not invent an archetype server-side for a neutral hint.
- **Response `archetype` must equal the applied archetype.** The SDK compares
  `resp.archetype !== previousArchetype` to decide whether to reset DOM state, and stamps directives
  with it for per-archetype dedup. If the response archetype does not match the hint that was
  honored, cross-listing dedup/reset misbehaves.
- **Per-listing grounding (ADR-0009/0010).**
  `GET /api/adapt/description?listing_id&archetype&locale` returns copy grounded in the _real_
  listing, and returns the original/neutral copy when the archetype does not fit the listing
  (archetype-fit gate). Keep this — it is what prevents a `family_buyer` headline being hallucinated
  onto a luxury high-rise.
- **Non-fitting listing → omit the directive, do not send an empty value.** When the archetype-fit
  gate declines to adapt a listing, return **no** headline directive (empty `directives` array)
  rather than a directive whose `value` is `""`. The SDK treats an empty value as "no adaptation"
  and leaves the original (defensive guard added 2026-06-22), but the clean contract is to omit the
  directive. For such a listing the SDK shows the tenant's **original** copy while continuing to
  adapt the listings that DO fit — `neutral` is a valid per-listing outcome, not a session-wide off
  switch.

## 5. Archetype behavior — quiz, chat, and drift **[INFO]**

Codified in ADR-0014. Summary of guaranteed behavior:

- The quiz answer seeds the session **source-of-truth (SoT) archetype**
  (`estalara_resolved_archetype_<sessionId>` in sessionStorage).
- Routine behavioral signals never silently decay the archetype to `neutral` mid-session — the SoT
  is restored whenever the live archetype decays to `neutral`, so every subsequent listing keeps
  adapting.
- Drift to a **different non-neutral** archetype **is** allowed and updates the SoT: when navigation
  patterns and/or chat questions make a different true need evident (e.g. a declared `family_buyer`
  who keeps asking about rental yield), the engine switches and the new archetype becomes the SoT.
- Persistence is sessionStorage (tab lifetime), consent-gated, and erased on consent withdrawal
  (Mode A). It survives in-tab navigation and full reload within the session.

## 6. Quiz can be disabled — system stays fully functional **[INFO]**

`config.quiz.enabled === false` (via the `/api/quiz/public-config` transport, ADR-0011) suppresses
the quiz UI entirely. Adaptation then runs on **behavioral + chat signals only**, and the SoT /
anti-neutral-decay guarantees above still apply (the SoT is seeded from behavioral/chat resolution
instead of the quiz). No code path requires the quiz to be present.

## 7. Chat-driven override **[PLATFORM] — required for chat to influence the archetype]**

For chat questions to move the archetype (the "evident true need" path), the decision response must
supply `chat_intent_dimensions` (the flattened intent map from the Modal NLP pipeline, FOLLOW-101).
The SDK applies it via `applyChatIntentPrior` inside `fetchDirectives`. Without it, chat messages
are logged but do not change the archetype. Behavioral drift works regardless.

**The whole chain, so a broken link is findable** (each hop must hold or chat is inert):

| #   | Hop                                                              | Where it lives                                      | How you tell it is missing                                        |
| --- | ---------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Chat UI dispatches `estalara:chat:message-sent` on `document`    | the tenant app's chat component — **[HOST] action** | no `chat.message.sent` in the ingest batch when a buyer types     |
| 2   | SDK listener queues `chat.message.sent`                          | `packages/sdk/src/index.ts`                         | as above; agent messages (`is_agent: true`) are dropped BY DESIGN |
| 3   | Ingest POSTs the message to Modal `chat_nlp_endpoint`            | `apps/ingest/src/handlers/chat-nlp-dispatch.ts`     | **`MODAL_CHAT_NLP_URL` unset ⇒ the dispatch is skipped silently** |
| 4   | intent-engine writes `shadow:{tenant}:{session}:chat_intent`     | `apps/intent-engine/src/redis_writer.py` (24h TTL)  | Upstash key never appears for a session that just chatted         |
| 5   | `/api/adapt` reads that key and returns `chat_intent_dimensions` | `apps/control-plane/src/app/api/adapt/route.ts`     | `[adapt] chat-intent shadow read` never logged                    |
| 6   | SDK folds it in and sends the new `archetype_hint` NEXT call     | `applyChatIntentPrior` in `core/intent.ts`          | archetype unchanged after several contrary questions              |

**Properties of hop 6 that surprise people, so state them before a demo:**

- **It lands one call late.** `applyChatIntentPrior` updates the SDK's `intentState`; the adapted
  copy changes on the NEXT `/api/adapt` call, not the one that carried the dimensions.
- **It applies once per MESSAGE** (FOLLOW-1024, CEO ruling 2026-08-18 — before that it was once per
  _session_, which sampled the conversation at message one and threw away everything the buyer said
  afterwards). The gate is the extraction's `detected_at` stamp, carried to the SDK as
  `chat_intent_detected_at` and remembered as `intentState.chatPriorAppliedAt`. Rule R still holds —
  the same extraction is never folded twice, which matters because the 24h shadow key is returned on
  every adapt call.
- **Only a signal-bearing message counts.** `write_shadow_intent` replaces the record only when the
  extraction carried a usable dimension (ADR-0020 D3), so "hi" and failed extractions leave the
  stamp — and the archetype — untouched.
- **One question does not overturn the quiz; a conversation does.** The quiz leaf enters the
  posterior at p=0.85. Measured trajectory for a `family_buyer` quiz answer followed by five
  investor-leaning questions:

  | after | archetype       | p(family_buyer) | confidence |
  | ----- | --------------- | --------------- | ---------- |
  | quiz  | `family_buyer`  | 0.850           | —          |
  | msg 1 | `family_buyer`  | 0.537           | 0.645      |
  | msg 2 | `flip_investor` | 0.220           | 0.395      |
  | msg 3 | `yield_hunter`  | 0.022           | 0.543      |
  | msg 5 | `yield_hunter`  | 0.000           | 0.622      |

  Note msg 2 — a transient mid-switch, but at confidence 0.395 it sits **below**
  `DOM_ADAPT_CONFIDENCE_FLOOR` (0.5), so on the confidence arm it does not reach the buyer's DOM.
  SWITCH_MARGIN hysteresis is applied on this path as of FOLLOW-1024 (it was bypassed before), which
  is what stops repeated folds re-labelling the buyer on every near-tie.

- When the chat prior DOES disagree with a confident quiz answer, the chat result wins and the
  disagreement is recorded as `chat_mismatch` on the intent state (FOLLOW-100) — it is observable
  metadata, not a veto.

## 8. Consent **[INFO]**

All profiling persistence (intent state + SoT archetype + lead id + quiz config cache) is
sessionStorage, written only after consent is granted, and erased on consent denial/withdrawal.
Consent state itself is localStorage (`estalara_consent`). The consent banner gates the entire
adaptation pipeline.

---

## Quick verification checklist (smoke test)

> **Corrected 2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2):** this heading said "smoke
> test on staging". There is no staging environment. Run this checklist on the **localhost pilot
> substrate** (`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`) before the ESC-020 / FOLLOW-820 prod
> gate, and on the **prod origin** after it.

1. Open a listing in a fresh session → accept consent → complete the quiz (or, if quiz disabled,
   browse a few listings). The headline/description should change to archetype-specific copy.
2. **Navigate (SPA, no reload) to a second listing.** The copy must change to the _second_ listing's
   archetype-grounded copy. If it keeps the first listing's copy → check §2 (the
   `data-estalara-listing-id` is not updating in place).
3. Browse 5–8 listings that fit the archetype. The archetype must **never** fall back to the
   generic/default copy (neutral) on a fitting listing. If it does → the SoT restore is not running;
   check that the bundle is the deployed build (§3) and that `/api/adapt` honors `archetype_hint`
   (§4).
4. **Navigate to a listing the archetype does NOT fit** (e.g. `family_buyer` → a luxury studio /
   high-rise). That listing must show its **original** copy (not the previous listing's adapted
   copy, not a blank headline). Navigating back to a fitting listing must resume adaptation. This
   confirms the per-listing archetype-fit gate + the SDK original-restore.
5. Full-reload a listing mid-session → it must re-adapt without re-taking the quiz (SoT rehydrated).
6. **[FOLLOW-1023b] Prove the tracer pipeline on the real origin, once, on first live traffic.**
   Browse a session past **5 behavioral signals**, then open `/admin/tenants/<id>/tracer` → Session
   History and confirm rows appear. As of 2026-08-17 `intent_events` is empty ALL-TIME for the pilot
   tenant while `adaptation_decisions` has real rows — consistent with "no production session ever
   crossed the 5-signal snapshot threshold", because there is no SDK on the production origin yet
   (ESC-020). Until this step is run once, SDK → ingest → ClickHouse has **never been proven in
   production**, and a silent break there looks exactly like "no traffic".
7. **Type a question in the AI chat that contradicts the quiz answer** (e.g. take the own-use path,
   then ask about rental yield). Watch for `[adapt] chat-intent shadow read` in the control-plane
   logs, then reload or navigate: the copy should switch to the investor archetype. If nothing
   changes, walk §7's six hops in order — hop 1 (the host app dispatching the event) and hop 3
   (`MODAL_CHAT_NLP_URL` on the ingest Worker) are the two that have historically been absent.
