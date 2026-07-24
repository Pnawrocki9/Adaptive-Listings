# PROPOSED-0019 — Per-tenant presentation & content config contract (white-label per-brand epic)

**Status:** PROPOSED (CEO reviews) **Date:** 2026-07-24 **Proposed by:** architect (session 58)
**Tickets:** white-label per-brand epic — FOLLOW-623, FOLLOW-639, FOLLOW-640, FOLLOW-641 (declared
`depends_on: [presentation-config ADR]` for 639/640/641). **Cross-references:** ADR-0011
(quiz-config transport), ADR-0014 (SoT archetype), ADR-0018 (superadmin/staff auth + atomic audited
writes), FOLLOW-101/554 (quiz→archetype persistence), FOLLOW-270/271/274/275 (shared quiz-config
types), FOLLOW-584 (canonical archetype ids), FOLLOW-600/614/615 (`/api/config` real-table wiring),
FOLLOW-627 / PR #616 (`data_source` provenance + 404-on-0-row PATCH), FOLLOW-372 / §H.9 (opt-out
scope), Rule H, Rule K.2, Rule L, Rule U, `docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md`.

---

## Context

The CEO's 2026-07-24 re-brand ruling (memory `project_single_tenant_rebrand_model`,
`docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md` §DECISION) changed what a "tenant" is: each
client brand is a **full white-label deployment of `app.estalara.com` on the client's own domain** —
same app, same known DOM, one shared data pool, one `tenants` row per brand. The SDK always runs
**inside our own app**, never on a third-party site. The governing constraint is
**DOMAIN-INDEPENDENCE**: every AL runtime decision resolves tenant identity from `api_key` /
`tenant_id`, **never** from the serving host or `window.location`.

Four per-brand customization surfaces are currently hardcoded or unwired, each with an open ticket:

| Ticket         | Surface                                | Current state                                                                                                        |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **FOLLOW-623** | Branding (color, logo, white-label)    | `tenants.brand_config` written/read by `/api/config` (PR #616) but **no SDK consumer** — a producer-only facade.     |
| **FOLLOW-640** | Quiz-widget placement + appearance     | Trigger position hardcoded `position:fixed; bottom:24px; left:24px` (`packages/sdk/src/ui/quiz-trigger.ts:141-148`). |
| **FOLLOW-641** | Visitor opt-out **toggle widget**      | SDK renders **no toggle UI**; `packages/sdk/src/core/profiling-opt-out.ts` is localStorage state only (§H.9).        |
| **FOLLOW-639** | Quiz **content** (fully editable tree) | Hardcoded `QUIZ_CONTENT` (EN/PL/ES) + hardcoded `resolveArchetype()` switch in `packages/sdk/src/ui/quiz-widget.ts`. |

These four are not four independent contracts. They are one thing: **the per-tenant presentation &
content configuration the SDK must fetch at runtime, keyed by tenant identity, to render
brand-correct widgets and run the brand's own quiz.** Shipping four disjoint
transports/columns/schemas would guarantee the drift this codebase's retros repeatedly flag (the
`quiz_config`-vs-snippet-attribute split fixed by ADR-0011; the `data_source` two-source-of-truth
family). This ADR defines the single unified contract.

### Where answer→archetype scoring lives today (load-bearing for FOLLOW-639)

The mapping from quiz answers to an archetype is **owned by the SDK, in code, not data**:

1. `resolveArchetype(branch, q2Answer, q3Answer)` (`packages/sdk/src/ui/quiz-widget.ts:254`) is a
   pure hardcoded switch: an answer-index tuple → **exactly one** leaf archetype string (or
   `neutral`). There are **no weights** today — it is deterministic argmax-by-construction.
2. The completion callback (`packages/sdk/src/index.ts:1200-1229`) applies that single leaf:
   `applyQuizLeaf(currentIntentState, resolvedArchetype)`, seeds the ADR-0014 sessionStorage
   source-of-truth via `persistResolvedArchetype(...)` (only when non-neutral — FOLLOW-554 guard),
   and fires `postQuizCompletionPing` → `POST /api/quiz/completion` (Postgres persistence,
   FOLLOW-200/101).

FOLLOW-639 ("fully editable per brand … answer→archetype mappings") therefore moves the **source**
of this mapping from the hardcoded switch to **served data**, while the **downstream persistence
contract must not change** (ADR-0014 SoT + FOLLOW-101/554 + the completion ping stay byte-for-byte).
The ADR reconciles the two below.

---

## Decision

### D1 — Transport: extend the existing `GET /api/quiz/public-config`, one fetch, superset response

The SDK already performs exactly one API-key-authenticated runtime fetch at init
(`GET /api/quiz/public-config`, ADR-0011 path ii). **All four slices are added to that same
response** as new **optional** top-level keys. No second endpoint, no second round-trip.

- **Auth / CORS / cache are inherited unchanged** from ADR-0011:
  `Authorization: Bearer <tenant-api-key>`, tenant resolved from the key (DOMAIN-INDEPENDENT — never
  from host), `Access-Control-Allow-Origin: *`,
  `Cache-Control: max-age=300, stale-while-revalidate=60`. No new auth surface, no new CORS surface,
  no new CDN cache key.
- **The route path stays `/api/quiz/public-config`.** Renaming to `/api/presentation-config` would
  break the fetch URL baked into the shipped SDK and bust the CDN cache for zero functional gain
  (see Alternatives A). The name is now historical; the response is the superset
  `PresentationConfigResponse`.
- **Rule L "all three limbs" per slice:** each slice ships producer (route field) + schema (shared
  Zod) + **real SDK consumer** together. No slice is added to the wire without the SDK code that
  reads it — that is the acceptance gate for FOLLOW-623/639/640/641 respectively.
- **Fetch ordering (unchanged from ADR-0011 §init sequence):** the fetch runs **after** consent
  resolves. Consequence: the consent banner keeps default styling; brand/placement/opt-out apply to
  the post-consent widgets. This mirrors the ADR-0011 locale addendum and is an accepted constraint,
  not a defect (escape hatch: D6).

### D2 — Storage: JSONB columns for bounded settings, a dedicated table for the quiz definition

| Slice                 | Store                                                             | Rationale                                                                                                            |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Brand (623)           | **existing** `tenants.brand_config` jsonb                         | Already exists, already written by `/api/config`. Formalize its shape in shared; add the SDK consumer. No migration. |
| Quiz placement (640)  | **existing** `tenants.quiz_config` jsonb, new `placement` key     | Quiz-widget UX is `quiz_config`'s charter (`schema/tenants.ts:39-67`). Keeps quiz appearance in one column.          |
| Opt-out widget (641)  | **new** `tenants.optout_widget_config` jsonb (additive migration) | Distinct widget, distinct §H.9 lifecycle; a cohesive small blob, not quiz-scoped.                                    |
| Quiz definition (639) | **new table** `quiz_definitions` (additive migration)             | Large, i18n-multiplied, **versioned + audited content** — not a settings blob. See below.                            |

**Why a table, not a JSONB blob, for the quiz definition:** a full editable tree × N languages is
large and is _edited content_ (rollback/audit matter). Storing it on `tenants` would (a) bloat the
row read on every `/api/config` and hot-path tenant lookup, and (b) lose version history (an edit
clobbers the prior tree with no audit rollback). `quiz_definitions` carries
`(id, tenant_id, version, definition jsonb, is_active, created_by, created_at)` with a partial
unique index on `(tenant_id) WHERE is_active` — one active version per tenant, history retained. The
public-config route reads only the active row.

**Migrations are additive and default-preserving** (Postgres auto-applies to prod on merge — memory
`project_postgres_migrations_no_autoapply`): a tenant with no `quiz_definitions` row and empty
`optout_widget_config` behaves byte-identically to today (D4).

### D3 — Schema shape: one shared Zod module, extends the ADR-0011 contract

New file `packages/shared/src/schemas/presentation-config.ts` (per the FOLLOW-270 precedent — quiz
types already live in shared). Zero `any`. Nullability is fixed **`string | null`, never
`string | undefined`, across the wire** (guardrail; matches `/api/config` `BrandConfig.logo_url`,
`route.ts:84-87`).

```ts
// ── Brand (FOLLOW-623) — byte-identical shape to apps/control-plane/.../api/config/route.ts ──
export const BrandConfigSchema = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logo_url: z.string().url().nullable(), // string | null — NEVER string | undefined (wire-consistent)
  white_label: z.boolean(),
});

// ── Widget placement (FOLLOW-640 / 641) — targets OUR known DOM, so a bounded corner+offset model ──
export const WidgetCornerSchema = z.enum(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
export const WidgetPlacementSchema = z.object({
  corner: WidgetCornerSchema,
  offset_x: z.number().int().min(0).max(200), // px from the horizontal edge
  offset_y: z.number().int().min(0).max(200), // px from the vertical edge
});

// ── i18n label bag (falls back to 'en') ──
export const LabelI18nSchema = z.record(QuizLanguageSchema, z.string());

// ── Opt-out toggle widget (FOLLOW-641) ──
export const OptOutWidgetConfigSchema = z.object({
  enabled: z.boolean(), // DEFAULT false → no widget (current behavior, D4)
  placement: WidgetPlacementSchema,
  labels: z.object({ on: LabelI18nSchema, off: LabelI18nSchema, aria: LabelI18nSchema }).partial(),
});

// ── Quiz definition (FOLLOW-639) — the fully editable tree ──
export const QuizAnswerSchema = z.object({
  id: z.string().min(1),
  label_i18n: LabelI18nSchema,
  weights: z.record(z.string(), z.number()), // archetype_id → weight; keys refined below
  next: z.string().nullable(), // next question id, or null = leaf
});
export const QuizQuestionSchema = z.object({
  id: z.string().min(1),
  prompt_i18n: LabelI18nSchema,
  answers: z.array(QuizAnswerSchema).min(2),
});
export const QuizDefinitionSchema = z
  .object({
    schema_version: z.literal(1), // versioned from day 1 (interface rule)
    root: z.string().min(1),
    questions: z.array(QuizQuestionSchema).min(1),
    languages: z.array(QuizLanguageSchema).min(1),
  })
  .superRefine((def, ctx) => {
    // HARD errors (reject the write):
    //  (1) every weights key ∈ CANONICAL_ARCHETYPE_IDS (packages/shared/src/archetypes.ts) — reject unknown
    //  (2) `root` and every answer.next reference an existing question id — reject dangling refs
    //  (3) no cycles reachable from root — reject
  });

// ── Unified wire contract — SUPERSET of ADR-0011's QuizPublicConfigResponseSchema ──
export const PresentationConfigResponseSchema = QuizPublicConfigResponseSchema.extend({
  brand: BrandConfigSchema.optional(), // FOLLOW-623
  quiz_placement: WidgetPlacementSchema.optional(), // FOLLOW-640
  opt_out_widget: OptOutWidgetConfigSchema.optional(), // FOLLOW-641
  quiz_definition: QuizDefinitionSchema.optional(), // FOLLOW-639
  // `data_source: 'db' | 'fallback'` is inherited from QuizPublicConfigResponseSchema (K.2, FOLLOW-277).
});
export type PresentationConfigResponse = z.infer<typeof PresentationConfigResponseSchema>;
```

**All new slices are `.optional()`** so the response stays backward-compatible (the shipped SDK
reading the ADR-0011 subset ignores unknown fields — forward-compatible per the interface rules) and
pre-existing cached responses still parse.

**The unreachable-archetype WARNING is deliberately NOT a Zod error** (CEO ruled it non-blocking).
It is a separate pure helper `computeUnreachableArchetypes(def): ArchetypeId[]` that the admin
editor calls to surface a non-blocking warning ("archetypes X, Y cannot be reached under this
tree"). Hard integrity (unknown archetype id, dangling `next`, cycles) blocks the write;
reachability only warns.

### D4 — Defaults / fallback: unconfigured tenant = byte-identical current behavior

The SDK ships built-in defaults; an absent slice means "use the built-in", so a tenant that has
configured nothing renders exactly as today:

| Slice           | Absent-from-response fallback (byte-identical to today)                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| brand           | Hardcoded widget colors (trigger `#ef4444`, quiz accent from `quiz_config.accent_color`), no logo.                                                                                       |
| quiz_placement  | `{ corner: 'bottom-left', offset_x: 24, offset_y: 24 }` (matches `bottom:24px; left:24px`). Applies to the **sticky trigger button** only; the quiz modal overlay stays bottom-centered. |
| opt_out_widget  | `enabled: false` → **no toggle UI rendered** (today's exact behavior; the widget is opt-in per brand).                                                                                   |
| quiz_definition | SDK built-in default tree (D5) — the current q1_gate branching tree, fed through the generic walker.                                                                                     |

**Color precedence** (resolves the `brand.primary_color` vs `quiz_config.accent_color` overlap):
`quiz_config.accent_color` (explicit quiz override, already set on existing tenants) **>**
`brand.primary_color` (brand umbrella) **>** SDK hardcoded default. This preserves every existing
tenant while making brand the default for widgets that had no per-widget color (opt-out toggle).

**Rule K.2 fail-loud, aligned with FOLLOW-627:** the response carries
`data_source: 'db' | 'fallback'` (inherited). When the DB is unreachable the route returns the
fallback subset with `data_source: 'fallback'` (the SDK `console.warn`s in debug) — a served default
is never silently indistinguishable from a stored config.

### D5 — Quiz mapping: definition owns the data; SDK reduces to a leaf; persistence contract unchanged

FOLLOW-639 moves the answer→archetype mapping from `resolveArchetype()`'s hardcoded switch to the
served `quiz_definition.weights`. To keep the entire downstream persistence path unchanged (ADR-0014
SoT, FOLLOW-101/554 non-neutral guard, the `/api/quiz/completion` ping), the SDK:

1. Gains a **generic tree-walker** that renders `quiz_definition.questions` following `answer.next`,
   accumulating the selected answers' `weights` vectors.
2. **Reduces the accumulated weight vector to a single resolved archetype by argmax**
   (empty/all-zero ⇒ `neutral`; deterministic tie-break by `CANONICAL_ARCHETYPE_IDS` order). This
   preserves the existing `applyQuizLeaf(state, resolvedArchetype)` →
   `persistResolvedArchetype(...)` → `postQuizCompletionPing` contract **byte-for-byte** — only the
   mapping _source_ changes from code to data.
3. The current `resolveArchetype()` switch and `QUIZ_CONTENT` become the **built-in default
   definition** used as fallback (D4). A minimal EN default tree stays in the bundle (D6); the full
   multilingual content moves server-side.

This keeps the ownership boundary explicit: **the quiz definition (data) owns the mapping; the SDK
walker owns reduction-to-leaf; the completion/SoT path (unchanged) owns persistence.**

### D6 — Bundle budget (≤42 KB gzip; currently ~39.9 KB → ~2.1 KB headroom)

Per-ticket size expectations (measured in each PR; the gate stays green):

- **FOLLOW-639 (net WIN):** the full PL/ES `QUIZ_CONTENT` (~2/3 of the quiz strings) moves
  server-side; a **minimal EN-only** default tree stays as offline fallback. Expected **−1.0 to −2.0
  KB**. The generic walker replaces the bespoke `buildStep()` state machine roughly at parity.
- **FOLLOW-640 (small ADD):** placement is data-driven CSS from the existing render — **≤ +0.3 KB**.
- **FOLLOW-641 (the risk — ADD):** a new Shadow-DOM toggle widget — **≤ +1.5 KB**.
- **FOLLOW-623 (small ADD):** apply brand color/logo in the existing render — **≤ +0.5 KB**.

**Sequencing rule to protect the gate:** **land FOLLOW-639 (the shrink) BEFORE FOLLOW-641 (the
grow)** so the quiz-content savings are banked before the opt-out widget is added. If 641 is
measured to breach 42 KB standalone, 639 is its hard predecessor.

### D7 — Admin write path & auth (ADR-0018): staff-atomic, audited, and composed with PR #616

- **Brand (623) writes** ride the **existing** `/api/config` PATCH (FOLLOW-600), which already
  applies the ADR-0018 §3a atomic staff-write + `staff_audit_log` (`action: 'tenant_config.update'`)
  and the FOLLOW-615 write-rank gate. **This ADR adds no new brand write path** — it adds the SDK
  _read/consume_ side + exposes `brand` on the public-config response. This **composes with, not
  conflicts with, PR #616 (FOLLOW-627)**: #616's `data_source` provenance + 404-on-0-row PATCH stay
  as-is; we reuse the same provenance pattern on the public endpoint and do **not** re-thread quiz
  fields through `/api/config` (that route deliberately drops `quiz.*` — `route.ts:56-63` — to avoid
  a divergent second write path; we honor that).
- **Quiz definition (639), quiz placement (640), opt-out widget (641) writes** are new staff-only
  admin routes/editor on the per-tenant page. Each MUST follow the ADR-0018 §3a reference pattern:
  service-role client, **mandatory `WHERE tenant_id = <validated id>` fence**, mutation + audit
  insert in **one `db.transaction()`** (`action`: `quiz_definition.update` / `quiz_placement.update`
  / `optout_widget.update`), write-rank ≥ `estalara:ops`. Staff-supplied `tenant_id` validated
  against `tenants` (invariant 3).
- **Nullability across the wire (guardrail):** `brand.logo_url` is `string | null` in `/api/config`
  (`route.ts:84`), on the public-config wire, and in the SDK type. It must never become
  `string | undefined` on any side. The implementing PRs grep both runtimes to confirm.

---

## Consequences

### Positive

- **One transport, one fetch, one schema module** for all per-brand presentation — no new
  round-trip, no CORS/auth/CDN surface, and the drift class that produced the ADR-0011 lineage
  cannot recur across these four slices.
- **DOMAIN-INDEPENDENT by construction:** every slice is tenant-keyed via the API key; nothing reads
  the host. A brand's config follows its `tenants` row regardless of which domain serves the app.
- **Honest facades:** FOLLOW-623 stops being a producer-only facade (branding actually renders);
  FOLLOW-641's dead opt-out state gains its promised UI; the "fully editable quiz" becomes real
  data.
- **Downstream contracts untouched:** ADR-0014 SoT, FOLLOW-101/554, and the completion ping are
  preserved byte-for-byte (D5); `/api/config` and PR #616 are composed with, not modified.
- **Net bundle win available** (D6) — moving multilingual quiz content server-side offsets the
  opt-out widget growth.

### Negative

- Adds one new table (`quiz_definitions`) and one new column (`optout_widget_config`) — additive
  migrations, but real schema surface + a new admin editor (the quiz-tree editor is the heaviest new
  UI in the epic).
- The consent banner keeps default (un-branded) styling because the fetch is post-consent (D1) — an
  accepted constraint carried over from ADR-0011, with an escape hatch (below) if a branded banner
  is later required.
- Bundle headroom is tight (~2.1 KB); FOLLOW-641 must be measured and is gated behind FOLLOW-639.

### Risks

- **Quiz-mapping semantic shift (D5):** today = deterministic single-leaf switch; new = weighted
  vectors reduced by argmax. A malformed weight set could change resolved archetypes vs today.
  Mitigated by: the built-in default tree reproduces current behavior exactly, and FOLLOW-639 AC5
  requires an end-to-end parity test (custom tree → resolved leaf → SoT persist → completion ping).
- **Staff write cross-tenant leak (ADR-0018's load-bearing risk):** the new write routes bypass RLS
  (service-role); correctness rests entirely on the explicit `WHERE tenant_id` fence. Every new
  route's test suite MUST include the "staff query is tenant-filtered" case (ADR-0018 invariant 5).
- **Editor integrity:** a brand could author a tree that never reaches some archetypes. Ruled
  non-blocking (warn only), so a poorly-authored tree can silently narrow the reachable archetype
  space. Accepted per CEO's full-editability ruling; surfaced by `computeUnreachableArchetypes`.

### Reversibility

- **High per slice.** Each slice is an optional response field + an isolated SDK consumer behind a
  default; removing a slice is deleting the field + consumer, and the tenant falls back to built-in
  behavior. The `quiz_definitions` table and `optout_widget_config` column are additive and can be
  left dormant. No existing contract is broken to adopt this.

---

## Alternatives considered

**A — A new `/api/presentation-config` endpoint instead of extending `/api/quiz/public-config`.**
Rejected: the SDK already fetches `public-config` at init; a second endpoint means a second
round-trip (against the p95 budget and the ADR-0011 rationale) or a migration of the shipped SDK's
fetch URL that busts the CDN cache — all for a cosmetic name. Extending the existing response is
strictly cheaper and keeps the "one fetch" property. The path name being historically "quiz" is a
documentation note, not a cost.

**B — Store the quiz definition as a JSONB blob on `tenants` (like `quiz_config`).** Rejected: the
definition is large, i18n-multiplied _edited content_, not a settings blob. It would bloat every
`tenants` row read (including hot-path tenant lookups) and lose version history — an edit would
clobber the prior tree with no audited rollback. A dedicated `quiz_definitions` table with an
active- version pointer isolates size and preserves history, at the cost of one migration.

**C — Keep the answer→archetype mapping in SDK code, make only the _strings_ editable (text-only).**
Rejected by the CEO's explicit ruling (FOLLOW-639: "fully editable per brand — not just wording:
structure, answers, and answer→archetype mappings"). Text-only would leave the mapping — the part
that actually differentiates brands with different buyer populations — hardcoded.

**D — Fetch brand config pre-consent so the consent banner is branded too.** Rejected for now:
ADR-0011 established that the runtime config fetch runs after consent resolves; moving branding
earlier reopens that ordering decision for a single UI affordance. The banner keeps default styling;
if a branded consent banner becomes a real requirement, the escape hatch below applies.

### Escape hatch (branded consent banner, if later required)

Mirror the ADR-0011 §Addendum pattern: emit brand primary_color as a static snippet data-attribute
(`data-brand-color`) read by `readConfig()` pre-fetch, used only to style the consent banner. This
is a display preference (pre-activation-stable), not post-activation-mutable config, so it does not
conflict with the ADR-0011 rationale. File a follow-up ADR amendment if adopted.

---

## Ticket impact

Which ticket consumes which slice of the `PresentationConfigResponse` contract:

- **FOLLOW-623 (branding — ENFORCE):** consumes `brand`. Admin **write** already exists
  (`/api/config` PATCH, PR #616 / ADR-0018 §3a). This ticket adds (a) `brand` to the public-config
  route response, (b) `BrandConfigSchema` in shared, (c) the **SDK consumer** applying
  primary_color/logo/white_label to the widget + Shadow-DOM styling per the D4 precedence.
  Nullability: `logo_url` stays `string | null` across all three limbs. Bundle ≤ +0.5 KB.
- **FOLLOW-639 (quiz content — FULL editability):** consumes `quiz_definition`. Adds the
  `quiz_definitions` table + `QuizDefinitionSchema` (with the D3 hard-integrity refinement against
  `CANONICAL_ARCHETYPE_IDS` and `computeUnreachableArchetypes` warning), the admin tree editor
  (ADR-0018 staff-atomic-audited write, `action: 'quiz_definition.update'`), and the SDK generic
  walker + argmax reduction (D5) that preserves the ADR-0014 / FOLLOW-101/554 / completion-ping
  persistence path. Net bundle WIN (D6). **Land before FOLLOW-641.**
- **FOLLOW-640 (quiz placement/appearance):** consumes `quiz_placement`. Adds the `placement` key on
  `tenants.quiz_config`, `WidgetPlacementSchema`, admin editor field (staff-atomic-audited,
  `quiz_placement.update`), and the SDK consumer positioning the sticky trigger. Default preserves
  `bottom-left, 24/24`. Bundle ≤ +0.3 KB.
- **FOLLOW-641 (opt-out toggle WIDGET):** consumes `opt_out_widget`. Adds `optout_widget_config`
  column, `OptOutWidgetConfigSchema`, admin editor (staff-atomic-audited, `optout_widget.update`),
  and the new Shadow-DOM toggle wired to `profiling-opt-out.ts` (§H.9 scope — suppress AL
  profiling + DOM adaptation, ingest rides §H.8; do NOT re-litigate per
  `project_optout_enforcement_h9_scope`). Default `enabled: false` = no widget = current behavior.
  Bundle ≤ +1.5 KB; **gated behind FOLLOW-639's shrink**.

**FOLLOW-622 / FOLLOW-642 (`allowed_origins`)** are explicitly **out of scope** here — de-scoped now
(Option B), re-enabled before the first external client (FOLLOW-642). This ADR does not touch ingest
CORS.

### On acceptance (per architect guardrails), before/with the first consuming PR

- `packages/shared/src/schemas/presentation-config.ts` (the Zod module above), with a `.test.ts`
  carrying ≥5 cases per new schema (valid brand; `logo_url` null vs url; unknown-archetype
  rejection; dangling-`next` rejection; unreachable-archetype warning-not-error; placement bounds;
  backward-compat parse of an ADR-0011-subset response).
- An entry in `docs/INTERFACES.md` for the expanded `GET /api/quiz/public-config` →
  `PresentationConfigResponse` (superset of the existing ADR-0011 row) with ≥2 examples.
- An example in `packages/shared/src/examples/` (a fully-populated `PresentationConfigResponse` and
  a minimal/unconfigured one).
- The ADR moves to ACCEPTED and is added to `docs/adr/README.md` §Index only on CEO ratification.

---

## References

- `docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md` — CEO domain-independence + 623-enforce
  ruling.
- `backlog/FOLLOW_UPS.md` — FOLLOW-638/639/640/641/642 stubs.
- ADR-0011 — quiz-config transport (the endpoint + auth + fetch-ordering this extends).
- ADR-0014 — SoT archetype (the persistence contract D5 preserves).
- ADR-0018 — superadmin/staff URL-scoped access + §3a atomic audited writes (the write model).
- `apps/control-plane/src/app/api/quiz/public-config/route.ts` — the route being extended.
- `apps/control-plane/src/app/api/config/route.ts` — brand write path (PR #616 / FOLLOW-627).
- `packages/sdk/src/ui/quiz-widget.ts` (`resolveArchetype`, `QUIZ_CONTENT`) — the code the
  definition replaces; `packages/sdk/src/ui/quiz-trigger.ts` (hardcoded placement);
  `packages/sdk/src/core/profiling-opt-out.ts` (§H.9 state, no UI);
  `packages/sdk/src/index.ts:1200-1229` (completion callback).
- `packages/shared/src/schemas/quiz-config.ts` (`QuizPublicConfigResponseSchema`,
  `QuizLanguageSchema`); `packages/shared/src/archetypes.ts` (`CANONICAL_ARCHETYPE_IDS`).
- `packages/db/src/schema/tenants.ts` — `brand_config`, `quiz_config` columns.
- Rules H (ADR for new dependency/auth/extensibility), K.2 (fail-loud provenance), L (all three
  limbs), U (typed columns / no unwired blob keys).
