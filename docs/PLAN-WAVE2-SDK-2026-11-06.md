# Wave 2 SDK plan: FOLLOW-1455, 1444, 1445, 1446 (design and sizing, no product commits)

Author: sdk-engineer (Opus), 2026-11-06, measured at `e059aaa1`. **Status:** CEO ruled 2026-11-06
(ESC-092 in `backlog/ESCALATIONS.md`): D1 = B (correct the text), D2 = **d** (a persistent "turn on"
chip, not the recommended host link), D3 = b, D4 = one control (counsel to confirm), D5 = T1 (zod
trim, FOLLOW-1473), D6 = yes. The PR split in section 6 stands; PR 2 implements the chip instead of
the host-link reopen.

Sources read: `backlog/QUEUE.md` rows 1444–1446 and 1455;
`docs/compliance/FOLLOW-1316-signed-review.md` section 7 items 1, 2, 5, 13, 16 and section 8 P-2 to
P-4; `docs/compliance/FOLLOW-1339-session-header-review.md` section 12 item 1 and the notice v1.16
instructions; `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §1; `docs/adr/ADR-0021-*`; ESC-080. Code:
`packages/sdk/src/{index.ts, core/boot.ts, core/consent-flow.ts, core/adapt.ts, core/adapt-loop.ts, core/consent-text.ts, core/xid.ts, core/profiling-opt-out.ts, ui/profiling-toggle.ts}`,
`packages/shared/src/schemas/consent-text.ts`, `apps/control-plane/src/lib/buyer-profile-route.ts`.

## How the numbers were measured

- `pnpm --filter @estalara/sdk build` then `build:check`, Node v22.22.2,
  `NODE_OPTIONS=--max-old-space-size=1024`, `packages/shared` built first (the SDK reads its
  `dist`).
- For prototypes: the same IIFE options as `tsup.config.ts` (minify, es2020, `drop: ['console']`,
  global `Estalara`) from a scratch config, gzip with Node `zlib.gzipSync` at default level, the
  instrument `check-bundle-size.js` uses. The scratch build reproduced the gate exactly: 43,129 B at
  baseline and 41,917 B with the zod trim, both identical to `build:check`.
- Every prototype was a throwaway edit, measured, then reverted (`git checkout`). The worktree is
  clean except this file. Deltas below are measured unless marked **est.**

## 1. Current size

| Item                      | Bytes (gzip) |
| ------------------------- | -----------: |
| `estalara-sdk.iife.js`    |   **43,129** |
| Limit (ESC-028 + ESC-080) |       43,136 |
| **Headroom**              |      **7 B** |

## 2. Per ticket: minimal correct change and cost

### FOLLOW-1455: notice §1 against the `kc_token` read

What `sub` is used for. `boot.ts:157-180` reads `localStorage.kc_token`, decodes the JWT payload,
and stores `deriveLeadId(sub)` (16 hex of an unkeyed SHA-256) in
`sessionStorage.__estalara_lead_id__`. The token is never sent or stored. The lead id has four
readers:

1. `xid.ts:86` `readSendableXid(leadId)`: an xid bound to lead A is not sent when lead B is logged
   in. This is the only shared-computer protection the xid has today (review section 7 item 13,
   P-1/L-5).
2. `profiling-opt-out.ts`: the §H.9 opt-out key is scoped per lead (`…:<leadId>`).
3. `adapt.ts:795` sends `lead_id` in the `/api/adapt` body. The route ignores it and writes `''`
   (`adapt/route.ts:817,1068`, FOLLOW-170 not wired). No server effect.
4. `markXidSent` writes `lead` into the xid record.

The chat path (`adapt-loop.ts:527-557`) derives the same lead id from `user_uuid` that the host's
ChatBot puts in the CustomEvent. That path reads no credential and stays either way.

**Option A, the SDK stops reading the token.** Remove the block at `boot.ts:157-180` and rewrite
`follow197-lead-id.test.ts`. Measured **−116 B**. Consequences:

- The xid lead binding stops working for anyone who has not chatted in this tab. Logged-in buyer B
  on A's computer is then served A's profile, which is the exact case item 13 holds as a production
  BLOCKER pending L-5. This is a privacy regression on an open P-1 item.
- A scoped opt-out set earlier is no longer found in a new tab, because the key falls back to
  unscoped. That is only safe if the opt-out also becomes per-browser (any key counts, through the
  existing `hasProfilingOptOutKey`), which changes the §H.9 semantics.

**Option B, the text is corrected (recommended).** 0 B, docs only. The wording already exists:
`PRIVACY_NOTICE_TEMPLATE.md` v1.16 §1 says "If you are logged in, it reads the login token held in
your browser and uses only your account's identifier from it, to derive the pseudonymous lead ID
listed in §4". The LIA was corrected in v2.2. What is left:

- `docs/compliance/dpia.md:44-46` (§1 data classification) says the system "never stores login
  credentials". That is true, but it should name the read the same way the notice does.
- Check DPIA §13.2 for the same claim (review section 12 item 1 asks for this; I found none).
- Close the ticket against the published notice: the host publishes v1.16 §1, not the older
  sentence, before any production SDK.

Classification: **text only** (Option B), or SDK (Option A).

### FOLLOW-1444 (P-2): a withdrawal control that always renders, explains itself and reports the result

Minimal change:

- `core/consent-flow.ts` `mountOptOutToggle`: always call `offerWithdrawal`. Drop the
  `config.buyerProfileEnabled || readStoredXid()?.sent` condition.
- `index.ts`: drop the `offerWithdrawal` re-offer in the `lateConfig.then` handler (it becomes
  redundant) and keep setting `buyerProfileEnabled`.
- `deleteThenEraseXid` returns `boolean`: true if the id never left the browser, has expired, or the
  server answered 2xx. `withdrawConsent` returns it.
- `withdrawConsent` keeps the toggle container for the result. `__estalaraTeardown(keepUi?)` skips
  `profilingToggle.destroy()` / `shadowHost.destroy()` when `keepUi` is set. Today the teardown
  removes the toggle, so the buyer cannot be shown a result.
- `ui/profiling-toggle.ts` `showWithdraw(onWithdraw: () => Promise<boolean>, text?)`: renders a
  one-sentence explanation above the button. After the click the container becomes `role="status"`
  and shows the confirmation or the failure text. The failure text says the delete is retried on the
  next visit, which the stored-denied branch already does (R25/R26).
- Tests: `follow-1316.test.ts` has R24 cases that assert the control is absent with the flag off.
  They flip, and new cases cover flag off, explanation, success, failure and late config.

Where the three sentences live (en/pl/es, 9 strings). Both variants were measured, stacked on P-4:

| Variant                                  |                                   Cost | Notes                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) in `COPY` in the bundle              | **+543 B** (plumbing 76 + strings 467) | No new request. Text changes then cost bundle bytes, which ESC-051 ruled out for consent text                                                                                                                                                                            |
| (b) in `consent-text.json` (recommended) |                             **+124 B** | Three optional fields in `ConsentTextLocaleSchema` (`withdrawWhy`, `withdrawDone`, `withdrawFail`). `mountOptOutToggle` calls the existing `fetchConsentText(language)` on the granted path too (same §D3 identifier-free request, same single call site, `max-age=300`) |

Variant (b) also needs:

- An **ADR-0021 amendment**: the fetch is no longer "pending path only" (§D2 ordering text). The
  request shape, which §D3 and `check-adr-0021-conditions.mjs` guard, is unchanged.
- Compliance owns the copy. The 13.1/13.2 canonical byte record is not touched.
- A `text_version` bump, but **not** a `MIN_PROFILE_TEXT_VERSION` raise, so nobody is re-prompted.
- The failure mode must be **more** control, not less (the inverse of §D4). If the text fetch fails,
  the button still renders with its in-bundle label (`withdraw`, already shipped), and the result
  falls back to the in-bundle state text ("Personalization: disabled"). The withdrawal itself never
  depends on the text.

Classification: SDK + shared schema + a control-plane static JSON + compliance copy + ADR amendment.

### FOLLOW-1445 (P-3): a buyer can reach access and export

Today the routes exist and work (`/api/profile/access`, `/portability`, signed like erase, no OTP,
any consent state). Nothing in the SDK calls them. Minimal change:

- `core/adapt.ts`: generalise `postProfileErase` into
  `postProfile(config, action, xid): Promise<Response | null>`. `postProfileErase` becomes
  `(await postProfile(c, 'erase', x))?.ok === true`, with the same request shape and `keepalive`.
  Add `downloadProfile(config, xid)`, which POSTs `portability` and saves the JSON through a blob
  URL plus `<a download="estalara-profile.json">`. Add `revokeObjectURL`, about +10 B, not in the
  measured prototype.
- `ui/profiling-toggle.ts`: `showData(onData)` adds a "Download my data" link-button. Share one
  `linkButton()` helper with the withdrawal button. On failure the label changes to a short failure
  text.
- `core/consent-flow.ts`: offer it only when `readStoredXid()?.sent`. With no sent id, no server
  profile exists under an xid.
- One control covers both rights: the portability document carries the same `profile` and
  `expires_at` that access returns, plus format metadata. `/access` stays for other callers. Counsel
  confirms (decision D4 below). Compliance fills notice §3's empty slot.
- Backend: no change needed. The routes, quota, origin policy and audit rows already exist (P-5 and
  P-6 apply to them separately).

Cost, stacked on P-4 and P-2(b): **+327 B** measured, with labels and failure text in the bundle
(plumbing 201 + strings 126). With the label in the bundle and the failure text in
`consent-text.json`: **about +240 B (est.)**.

Classification: SDK + compliance text.

### FOLLOW-1446 (P-4): withdrawal restores everything, other tabs stop, a way back from `denied`

Measured on baseline, then stacked:

| Part                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |       Cost |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: |
| Restore every directive                        | `core/adapt.ts`: a first-write undo log, `Map<object, () => void>` filled by `keep(key, undo)` in each applier before the first write. Text keyed on the element (saves `textContent`), class keyed on `el.classList` (saves `className`), reorder keyed on `container.children` (saves the original child order and re-appends only children still in the container). `restoreDom()` tears down the resilience observers first, so nothing re-applies, then replays and clears. `adapt-loop.ts` `restoreOriginalSlots` calls it after `resetAdaptState()`; the per-listing headline/description maps then still win | **+126 B** |
| Other tabs stop                                | `index.ts`, after init: `ctx.on(window, 'storage', …)`. If `getConsentState() !== 'granted'`, it runs `adapt.revert()`, `eraseIntentState(session)`, empties the queue and calls teardown. It uses `getConsentState` rather than the key, so `localStorage.clear()` also stops the tab                                                                                                                                                                                                                                                                                                                               |  **+42 B** |
| Way back from `denied` (if the CEO picks D2-b) | `resolveConsent` denied branch: listen once for the document event `estalara:consent:reopen`, clear the stored denial and reload, so the banner is asked again. Needs a `clearConsentState()` helper, because `setConsentState` does not accept `'pending'`                                                                                                                                                                                                                                                                                                                                                          |  **+35 B** |
| **P-4 total**                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **+203 B** |

Behaviour notes:

- `adapt.revert()` is shared with the §H.9 opt-out, so opting out also restores `cta`, `feature`,
  classes and order. That is the intent of FOLLOW-1019/1306 F-12, but it is a visible change and
  belongs in the PR description.
- The existing SDK suite passed with the restore and listener prototype applied (1,398 / 1,398). The
  prototype added no new tests.
- Backend defence in depth (optional, recommended): review item 16 notes that `/api/adapt` serves
  and logs a decision for `consent_state: 'none'`. Refusing to decide or log for `'none'` covers
  stale SDK builds in tabs opened before this ships. That is a decision-API behaviour change, so it
  goes in the same ESC. 0 B in the SDK.

Classification: SDK (plus the optional control plane change).

## 3. Trims that recover bytes without changing behaviour

| #   | Trim                                                                                                                                                 |                                                     Measured saving | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Zod namespace imports.** `import { z } from 'zod'` → `import * as z from 'zod'` in all 36 files under `packages/shared/src` and `packages/sdk/src` | **−1,212 B** (43,129 → 41,917, confirmed by the real `build:check`) | Low. Zod 3.25's entry does `import * as z …; export { z }`, so the `z` value is an object literal of every zod export, and esbuild keeps all of zod (the bundle has a `jr(o,{BRAND:…,ZodBigInt:…,ZodFunction:…})` export object). A namespace import is accessed only by property, so esbuild tree-shakes it. With the change: `tsc --noEmit` is clean in the SDK, 89 files / 1,398 SDK tests pass, 41 files / 1,223 shared tests pass, and the zod code is identical (unused members dropped). **All reachable files must change together.** One leftover `{ z }` import keeps the whole object: with only the shared dist changed, the saving was only −124 B. Add an ESLint `no-restricted-syntax` guard for `ImportSpecifier[imported.name='z']` from `zod` in `packages/shared` and `packages/sdk`. Control-plane and ingest also compile shared; their typecheck and tests must run in the PR |
| T2  | Remove the `kc_token` read (FOLLOW-1455 option A)                                                                                                    |                                                              −116 B | **Not behaviour-neutral**: weakens the xid lead binding and the opt-out scoping, see 1455                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| T3  | Drop the `lateConfig` re-offer of withdrawal                                                                                                         |                                      already inside the P-2 numbers | None once P-2 always offers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| T4  | Shared `linkButton()` for the withdraw and data buttons                                                                                              |                                      already inside the P-3 numbers | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Duplicated-string scan of the minified bundle: the only repeats of any size are zod internals
(`invalid_string` issue builders) and short keys (`application/json`, `Bearer ${…}`,
`X-Estalara-Signature`, archetype ids). Collapsing the SDK's three signed-POST helpers (quiz
completion, quiz run, profile) into one would save tens of bytes (**est.** 30–60 B, not measured).
It is not needed once T1 lands.

## 4. Recommendation: the set fits after T1, so no limit raise

Measured, everything stacked in one tree (P-4 + P-2(b) + P-3 with in-bundle strings + T1):

| Configuration                                          |       Gzip | Headroom vs 43,136 |
| ------------------------------------------------------ | ---------: | -----------------: |
| Baseline                                               |     43,129 |                  7 |
| P-4 + P-2(b) + P-3, no trim                            |     43,783 |           **−647** |
| Same + T1 (zod)                                        | **42,570** |           **+566** |
| Same + T1 + T2 (kc_token removed)                      |     42,454 |               +682 |
| P-2 variant (a) instead of (b), + T1 (derived: +419 B) |    ≈42,989 |              ≈+147 |

**Recommendation.** Land T1 first as its own PR. Then all four tickets fit under the current 43,136
B with about 560 B of headroom, even with P-3's strings in the bundle. Keep P-2's sentences in
`consent-text.json` (variant b). ESC-051 said consent copy must not compete with code for bytes, and
the reviewer named this option. **No ESC to raise the ceiling is needed.**

An ESC is still needed for **public surface and contract** changes that CLAUDE.md sends to
`backlog/ESCALATIONS.md`:

- the `estalara:consent:reopen` event, if D2-b is chosen;
- new `consent-text.json` fields and the granted-path fetch (ADR-0021 amendment);
- the optional `/api/adapt` refusal for `consent_state: 'none'`.

The draft below covers these, with a ceiling raise only as a fallback if T1 is rejected.

### Draft ESC (not filed; next free number per QUEUE is ESC-092)

```markdown
## 5. Open decisions for the CEO

| #   | Decision                                                | Options                                                                                                                                                                                       | Recommendation                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | FOLLOW-1455: remove the token read, or correct the text | A: remove (−116 B) / B: text (0 B)                                                                                                                                                            | **B.** The corrected sentence already exists (notice v1.16). Removal weakens an open P-1 shared-computer protection (xid lead binding) and the per-lead opt-out scope                                                                                                |
| D2  | The way back from `denied` (P-4)                        | a: none, notice says so / b: host link → `estalara:consent:reopen` → banner again (+35 B) / c: denial expires after N months (est. +40–60 B) / d: persistent "turn on" chip (est. +150–250 B) | **b**, plus a notice sentence naming the link. It keeps the halted SDK silent (no DOM, no requests beyond the pending delete retry) and puts the re-prompt in the buyer's hands. It needs a link in `web-master`'s privacy settings (host change, CTO handover item) |
| D3  | Where the P-2 sentences live                            | a: bundle (+543 B) / b: `consent-text.json` (+124 B, ADR-0021 amendment)                                                                                                                      | **b**, with the in-bundle label and state-text fallback so withdrawal never depends on the fetch                                                                                                                                                                     |
| D4  | One control for access and export                       | one "Download my data" (portability JSON) / two controls                                                                                                                                      | **One**, with counsel's confirmation. The portability document carries the same profile and expiry as access                                                                                                                                                         |
| D5  | Budget                                                  | T1 trim / raise ceiling +768 B                                                                                                                                                                | **T1**                                                                                                                                                                                                                                                               |
| D6  | `/api/adapt` refusal for `consent_state: 'none'`        | yes / no                                                                                                                                                                                      | **Yes**, a small control-plane PR. It closes review item 16 for tabs that loaded an older SDK                                                                                                                                                                        |

## 6. Proposed PR split

| #   | PR                                                                                                                                                                                                         | Ticket                                                          | Owner, model                                                          | Size / bytes                                      | Depends on                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| 0   | `refactor(sdk): import zod as a namespace so esbuild can drop unused zod` (36 files plus an ESLint guard). The PR runs typecheck and tests for shared, sdk, control-plane and ingest                       | new FOLLOW (the trim; "an ESC or a trim first" in the 1444 row) | sdk-engineer, **Sonnet**: mechanical, fully covered by existing tests | −1,212 B                                          | ESC-092 (A1)                                |
| 1   | `docs(compliance): DPIA §1 and notice §1 name the login-token read [FOLLOW-1455]`                                                                                                                          | 1455 (D1-B)                                                     | compliance-engineer, **Sonnet**                                       | 0 B                                               | none, parallel with everything              |
| 2   | `fix(sdk): withdrawal and opt-out restore every directive; other tabs stop on withdrawal [FOLLOW-1446]` (+ reopen if D2-b)                                                                                 | 1446                                                            | sdk-engineer, **Opus**: consent logic plus DOM resilience interplay   | +203 B                                            | 0                                           |
| 2b  | `fix(control-plane): /api/adapt does not decide or log for consent_state none [FOLLOW-1446]`                                                                                                               | 1446 (D6)                                                       | backend-engineer, **Sonnet**                                          | 0 B                                               | ESC-092 (F)                                 |
| 3   | `feat(sdk): withdrawal control always shown, explained, confirmed [FOLLOW-1444]`: schema fields, `consent-text.json` strings (compliance writes them), ADR-0021 amendment, `follow-1316` R24 tests flipped | 1444                                                            | sdk-engineer, **Opus**; copy by compliance-engineer                   | +124 B                                            | 2 (shares `revert` / teardown), ESC-092 (C) |
| 4   | `feat(sdk): buyer can download their stored profile [FOLLOW-1445]` plus notice §3 slot                                                                                                                     | 1445                                                            | sdk-engineer, **Opus**; notice by compliance-engineer                 | +327 B (in-bundle strings) or about +240 B (est.) | 3 (same toggle and consent-flow code)       |

PRs 2–4 touch the same `consent-flow.ts` and `profiling-toggle.ts`, so they go in that order, not in
parallel. Each PR runs `build:check` and cites its measured delta. If PR 0 is not funded, PRs 2–4
cannot merge under the current ceiling (−647 B), and A2 applies.
```
