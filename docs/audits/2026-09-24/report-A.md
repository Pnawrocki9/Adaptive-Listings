# Report A — `packages/sdk` over-engineering audit (2026-09-24, HEAD `9723ec10`)

Read-only; nothing edited. Auditor: general-purpose subagent (Opus). Synthesis in
`docs/AUDIT-2026-09-24.md`.

The core loop is only a small part of the SDK. Most of the excess is in four places: dead modules,
server-side code stored in the SDK package, a detection system built for arbitrary websites, and a
single `init()` function that is about 1,750 lines long.

## 1. What actually runs in the bundle

- **Bundle entry.** The shipped bundle is built from `src/index.ts` only (`tsup.config.ts:13-34`).
  Auto-detect was moved out on purpose into a separate `estalara-detect.iife.js`
  (`tsup.config.ts:4-11,38-51`). The main SDK uses it only if `window.__EStalaraDetect` already
  exists (`index.ts:1216-1246`).
- **The real integration never loads the detect bundle.** The Estalara site
  (`Estalara-gitlab-2026-08-17/web-master/src/hooks.server.ts:168-178`) adds one loader `<script>`
  with api-key, tenant, decision-url and ingest-url attributes.
- **Slots are marked by hand with data-attributes.** Only these are used:
  `data-estalara-slot="headline"` (`+page.svelte:1066`), `"description"` (`:1225`), and
  `data-estalara-listing` / `data-estalara-listing-id` (`:990`). Nothing marks features, photos or
  CTA.
- **Where auto-detect actually runs:** only on the server, in control-plane `/api/detect`
  (`apps/control-plane/src/app/api/detect/route.ts:50,401,410`) and an onboarding preview.
- **Modules nothing imports at runtime:** `core/embedding.ts` (218 lines); `ui/sidebar-widget.ts`
  (463 lines; `index.ts:1348-1350` says "sidebar remains null").
- **Exported functions nobody calls:** `intent.ts` `applyDecay` (`:1224`), `applyQuizPrior` (`:884`,
  legacy fallback per `:1328`), `identify()` (`index.ts:2088`).
- **Server data kept in the SDK package:** `core/playbooks/` (~1,110 lines). Its only runtime
  consumer is control-plane (`api/adapt/route.ts:50`, `lib/llm-gateway.ts:35`).
- **Leftover from the retired tiers:** `config.tier` (`config.ts:37,214-216`, sent as `tier` at
  `index.ts:2039`).

## 2. Speculative or redundant mechanisms in `intent.ts` / `adapt.ts`

| Mechanism                                                                                                                   | What reads its output                                                                                   | Verdict                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Archetype hints from the detect bundle (`index.ts:1216-1250`, `intent.ts:1594`, `auto-detect/archetype-hints.ts` 455 lines) | Nothing in the real integration (bundle never loaded)                                                   | Delete                                                      |
| Micro-poll (`ui/micro-poll.ts` 265 lines + `intent.ts:398,1067-1100` + `index.ts:1643-1760`)                                | Gated by server `micro_polls_enabled`; no SQL default found, so it is unconfirmed whether it is ever on | Delete, or confirm the flag is off                          |
| Session quality snapshot (`core/dqs.ts` 187 lines, `index.ts:649-700`)                                                      | Ingest accepts it, but no reader found; the lift route moved off `dqs_events` (`lift/route.ts:30-40`)   | Delete                                                      |
| Variant cache + HMAC-signed feedback ping (`adapt.ts:28-200, 680-775`)                                                      | Server bandit                                                                                           | Keep while the server bandit exists; see note below         |
| Referrer, dwell and listing-view-rate priors, filter boosts, mismatch/drift hold (`index.ts:1097-1120, 1605`)               | Feed `archetype_hint` into `/api/adapt`                                                                 | Could be one likelihood table; each needs a measured effect |
| `annotateSlots` + slot-name translation (`annotate-slots.ts`, 170 lines)                                                    | Only helps pages without hand-coded slots; Estalara has them                                            | Low value                                                   |
| Consent banner, profiling opt-out toggle                                                                                    | Legal (FOLLOW-815, ADR-0021)                                                                            | Keep                                                        |
| Rapid-navigation guards and write-resilience observers (`adapt.ts:501-605`)                                                 | Real SvelteKit client-side navigation                                                                   | Keep                                                        |

**Note on the feedback ping:** it signs with `config.apiKey` (`adapt.ts:159`), which is the public
key in the script tag. The signature therefore gives no real integrity; it only adds code.

## 3. Duplicated logic

- **Two `/api/adapt` implementations.** `apps/decision-api` (a Worker with `ab-assignment.ts`,
  `bandit.ts`, `reorder.ts`) duplicates control-plane `/api/adapt` plus
  `packages/shared/{ab-holdout,bandit}.ts` and control-plane `lib/bandit-*.ts`.
  `MASTER_DESIGN.md:427` already records this as a divergence risk. Local runs point at
  control-plane (`web-master/.env:40`).
- **Cosine similarity.** `shared/embeddings.ts` says it is mirrored in
  `decision-api/lib/reorder.ts`. The SDK's `embedding.ts` is a third, dead copy.
- **Not duplicated in the SDK:** holdout assignment (comments only); reorder scores (server
  computes, SDK sorts, `adapt.ts:1044`); intent maths (`SWITCH_MARGIN`, likelihoods) live only in
  the SDK, apart from override weights in `shared/schemas/intent-weights.ts`.

## 4. Tests

- 54 of the 92 SDK test files are named after tickets (16.1k of 29.6k test lines).
- Sampled three: `follow-1024.test.ts` is a genuine behaviour pin (runs the real `fetchDirectives`,
  checks chat folding once per message) — keep. `follow-877.test.ts` is mixed: its "D-6" cases pin
  constant values (0.5 / 2 / 5 and the server's 0.6), the gating cases are real.
  `follow-209.test.ts` mostly pins incidental detail — exact question count, Polish wording,
  `typeof renderMicroPoll === 'function'`; it dies with the micro-poll.
- Ticket names hide what behaviour each file covers. Grouping them by module would expose overlaps.

## 5. Ranked simplifications

1. **Delete `embedding.ts`, `sidebar-widget.ts` and their tests.** ~680 source lines plus tests.
   Risk: none (no importers). Blocker: none.
2. **Delete the client-side archetype-hints path** (`auto-detect/archetype-hints.ts`,
   `detect-bundle.ts`, the `estalara-detect` build entry, `index.ts:1216-1250`,
   `applyArchetypeHints`, `/api/sdk-detect`). ~700 lines. Risk: none for Estalara. Blocker:
   `DetectionPreview.tsx` onboarding UI.
3. **Delete the micro-poll.** ~450 lines plus tests. Risk: low. Blocker: confirm
   `micro_polls_enabled` is false for the tenant.
4. **Delete DQS snapshot emission.** ~250 lines. Risk: low. Blocker: confirm no ClickHouse or
   dashboard reader (none found).
5. **Delete dead exports and the tier field** (`applyDecay`, `applyQuizPrior`, `identify`, `tier` in
   config and ingest). ~100 lines. Risk: none. Blocker: the ingest schema accepts `tier`, so this is
   a public contract change and needs an escalation.
6. **Move `core/playbooks` into control-plane (or `packages/shared`)** and drop the `./playbooks`
   export. ~1,100 lines leave the SDK. Risk: low. Blocker: ~20 control-plane test imports.
7. **Cut server-side auto-detect techniques to `data-estalara` + `json-ld`** (plus ai-vision if
   onboarding needs it). Removes wordpress, drupal, angular, mui, css-in-js, css-modules,
   article-tag and data-attributes: ~3.5k lines plus fixtures. Risk: low, since private-label
   re-brands share Estalara's markup. Blocker: a product decision that "any website" onboarding is
   out of scope. No bundle saving; it is already out of the IIFE.
8. **Retire `apps/decision-api`** in favour of the control-plane route. Risk: medium — check no prod
   tenant's `decision-url` points at the Worker first. Blocker: architect / ADR on FOLLOW-045.

Separately, `init()` in `index.ts:337` to about 2080 is one closure of roughly 1,750 lines.
Splitting it into boot, consent, the intent loop and the adapt loop is a refactor, not a deletion,
but it is the main maintenance cost.

**Must stay (the core loop):** `config.ts`, `session.ts`, `events.ts` and ingest dispatch,
`observer.ts`; the Bayesian core of `intent.ts` (base prior, behavioural and quiz-leaf signals, chat
prior, `SWITCH_MARGIN` hysteresis); the quiz widget; `adapt.ts` fetch, schema validation and
text/reorder apply with resilience, plus `adapt-floor.ts`, `adapt-description.ts` and
`headline-ownership.ts`; consent banner, profiling opt-out, PII scrub, and the
`estalara:adapt:settled` event (the host page relies on it, `app.html:23-58`).

**Not verified:** whether `micro_polls_enabled` is on for any tenant; whether any production tenant
uses the decision-api Worker URL; bundle bytes saved (most cuts are outside the IIFE or tree-shaken;
only items 3–5 shrink the shipped bundle).
