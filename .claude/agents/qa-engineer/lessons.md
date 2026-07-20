# QA Engineer — Lessons Log

---

## 2026-06-18 / FOLLOW-336

**What I tested:** SSR admin auth — `checkStaffSession` (tracer-auth), `checkAdminSession`
(middleware admin gate), `SignInForm` sign-in form.

**Where a test could have passed over a dead wire:**

- `makeRequest` with a plain `headers` object created `NextRequest` that satisfies the TypeScript
  type but fails at runtime when `NextResponse.next({ request: req })` does
  `req.headers instanceof Headers`. A test using that helper would have thrown before ever reaching
  the assertions — so the tests were failing loud, not silently. But if someone had mocked
  `NextResponse.next` to skip the check, the admin gate tests would have passed over a dead wire
  (never exercising the real `checkAdminSession` path).

**Root cause of E119 (`request.headers must be an instance of Headers`):** jsdom patches
`globalThis.Headers` with its own implementation, breaking the `instanceof` check in
`NextResponse.next({ request: req })`. The fix is `@vitest-environment node` for any middleware test
file that exercises `NextResponse.next({ request })`.
`new NextRequest(url, { headers: new Headers() })` alone is insufficient in jsdom — the `Headers`
class used by `NextRequest.headers` (from Node.js's native fetch) is not the same as jsdom's shimmed
`Headers`.

**A guardrail I'd add:** For any test file that exercises Next.js middleware directly (not just
route handlers), document that `@vitest-environment node` is required when the middleware calls
`NextResponse.next({ request: req })`. A comment in the vitest.config.ts explaining this would
prevent the next engineer from spending time on the same diagnosis.

---

## 2026-07-18 / FOLLOW-583

**What I tested:** Extended the archetype-ID parity guard (FOLLOW-561) to a 4th hand-maintained
full-parity copy (`generate_description.py` `_ARCHETYPE_GUIDANCE`, feeds the live Modal
AI-description prompt) and 2 subset copies (`demo-override-store.ts` `REACHABLE_ARCHETYPES`,
legitimate; `route-helpers.ts`/`export/route.ts` mock archetype fixtures, which had an already-live
invalid id `family_upsizer`).

**Where a test could have passed over a dead wire:** if I'd hand-typed the 18 keys expected in
`_ARCHETYPE_GUIDANCE` into a fixture array instead of parsing the real `.py` file, the test would
have passed forever regardless of what the file actually contains — the multi-line, nested-quote
dict values made that shortcut tempting (a naive line-based split risks matching a substring inside
a value string, e.g. any prose line that happens to end `": ("`... though in practice no value line
does). Anchoring the key regex to `^\s{4}"([a-z_]+)":\s*\(` with the `m` flag and verifying it
matched exactly 18 (not more, not fewer) against the real checked-in file before wiring it into the
suite was the check that made this a real test rather than a restated fixture.

**A guardrail I'd add:** when a "subset-validity" guard covers two files that logically describe one
fixture set (here: `MOCK_ARCHETYPES` array + `buildMockExportRows()`'s inline literals), union them
into one assertion rather than two — otherwise a future drift where one file is fixed and the other
isn't goes undetected by whichever half-guard runs first. Did this here; worth calling out
explicitly as the pattern for any future "two files, one dataset" guard.

- **2026-07-19 / FOLLOW-585** · Added subset-validity parity assertions for 2 more `MOCK_ARCHETYPES`
  dev/CI fallback copies (`pilot/cta-lift`, `dashboard/analytics/lift`), red-first against the
  invalid `'investor'` literal, then fixed to `'portfolio_builder'`. · Where a test could have
  passed over a dead wire: when I first wrote the fix-comment I placed it _inside_ the array-literal
  block being regex-parsed (`between [ and ] as const;`); the comment's quoted word `'investor'` was
  picked up by the existing `/'([a-z_]+)'/g` scan as a false positive, producing a misleading "still
  red" result that looked like the fix hadn't landed rather than a parser artifact — caught only
  because I re-ran and inspected the failure message closely enough to notice it still said
  `investor` after editing the source array. · Guardrail I'd add: when a regex-based parity parser
  scans a full source block (not just an array literal), any future contributor adding an inline
  comment inside that block should keep it free of quoted strings matching the value pattern — worth
  a one-line note at the top of `archetype-id-parity.test.ts`'s parser helpers warning that
  comments-in-block can false-positive the scan. (Not adding it now — out of the ticket's declared
  scope of exactly 3 files.)

---

## 2026-07-19 / FOLLOW-587

**What I tested:** Swept the 3rd/4th non-canonical archetype literals FOLLOW-585 missed — both
inline object-literal fields (`top_archetype: 'family_nester'` in tracer sessions mock,
`archetype: 'investor'` in the audit-log mock), invisible to a `MOCK_ARCHETYPES`-name-anchored grep.
Added a red-first subset-validity guard for the tracer mock, fixed both literals, then applied the
durable compile-time root-fix: retyped the three hand-authored `MOCK_ARCHETYPES` arrays as
`readonly ArchetypeId[]`.

**Where a test could have passed over a dead wire:** the retype itself silently broke the existing
parity test's own parser regex (`MOCK_ARCHETYPES\s*=\s*\[...\]\s*as const;` no longer matched once
`: readonly ArchetypeId[]` sat between the name and `=`). Caught only because the parser's own
"matched > 0" guard threw loud
(`could not locate ... — the literal was likely renamed or reformatted`) instead of silently
reporting an empty match set as a pass. This is the exact fail-loud design the FOLLOW-561 doc
comment promises — worth calling out as a real payoff, not just theoretical: a compile-time root-fix
and a regex-based runtime guard covering the same literal are two independent layers, and changing
the first without touching the second can silently disarm the second unless it's built to fail loud
on structural drift.

**A guardrail I'd add:** whenever a ticket's "durable root-fix" step adds a type annotation to a
literal that an existing regex-parser test also scans, always re-run that parser test _before_
declaring the retype done — don't assume a `tsc`-clean retype is orthogonal to a runtime
string-parse guard on the same line. (Caught this time because the full parity suite was re-run as a
matter of course; would recommend making it an explicit sub-step in any future "add readonly type
annotation near a parsed literal" ticket.)

---

## 2026-07-20 / FOLLOW-589

**What I tested:** `apps/control-plane/src/app/api/admin/tracer/history/route.ts`
`buildMockEvents()` — the `archetype_deltas: JSON.stringify({ ... })` blob. Added a 12th
parser/assertion to `tests/integration/archetype-id-parity.test.ts` (subset-validity, same pattern
as the FOLLOW-587 guard). Captured RED against main's current state (`family_nester`, 11 passed / 1
failed), applied the one-line fix (`family_nester` → `family_buyer`), re-ran GREEN 12/12.

**Where a test could have passed over a dead wire:** none this time — the new parser is a genuinely
new structural shape (unquoted object-literal KEY inside a `JSON.stringify({...})` call), so
`JSON.parse` on the raw source text can't be used (it isn't valid JSON until stringified at
runtime); had to regex the `{...}` body directly and match keys via `/(\w+)\s*:\s*-?\d/g`. This is
the 3rd sub-shape of the same value-domain-literal bug class (quoted array literal → quoted
object-field value → unquoted JSON-blob key) that a naive "grep for the anchor name" sweep keeps
missing one shape at a time (FOLLOW-561→583→585→587→589). A repo-wide sweep for `JSON.stringify({`
blocks + a targeted grep across known-typo variants (`family_nester`, `luxury_seeker`, etc.) found
no other live instance of this shape.

**A guardrail I'd add:** Rule AD (promoted this session) should be checked BEFORE writing the next
parser, not just documented after — for any future archetype-literal ticket, enumerate the known
structural shapes (quoted array entry, quoted object field, unquoted object key, Python dict key,
SQL insert value) up front and grep for all of them in one pass, rather than fixing shapes
one-ticket-at-a-time as each new sweep stumbles on the next. This ticket is evidence the chain is
now closable — worth confirming in the next retro that no 6th shape surfaces.

---

## 2026-07-20 / FOLLOW-588

**What I tested:** hardened all 11 archetype-ID-parity parser helpers (`stripComments()`) so a
quoted/keyed archetype id sitting inside a `//`/`#`/`/* */` comment INSIDE a captured `[...]`/
`(...)`/`{...}` block can no longer false-positive the scan. Added 2 regression tests (JS `//` case
via `parseMockArchetypesGeneric`, Python `#` case via `parseNlpPyArchetypes`) using inline
self-contained fixture strings, NOT real repo files — run through the REAL parser functions (same
stripping path), not a reimplementation. Proved red→green by temporarily neutering `stripComments`
to an identity no-op: both new tests failed exactly as predicted (`investor` leaked through from the
comment) while all 12 pre-existing assertions against real files stayed green (confirming the
neutering didn't corrupt anything the real files depend on); restored the hardened version and
re-ran green 14/14.

**Where a test could have passed over a dead wire:** this ticket exists precisely because the
_previous_ parity tests were exactly that kind of trap — they passed even when the underlying regex
scan could be fooled by a comment, because no test had ever exercised that path. The fix here is the
regression test itself; nothing new introduced this time (the fixtures are run through the real
parsers, not hand-rolled duplicate parsing logic, per the QA charter's own guardrail against
dead-wire tests).

**A guardrail I'd add:** when a captured-block regex parser is added for a NEW literal shape (a 6th
shape, a new file), require a comment-injection regression test alongside it from day one — don't
wait for a real debugging incident (FOLLOW-585) to discover the gap. Consider adding a lint rule or
PR-template checklist item for "regex captures a delimited block + scans for quoted values inside it
→ has this been comment-injection tested?" so the pattern doesn't need re-discovering a 3rd time in
a different test file.
