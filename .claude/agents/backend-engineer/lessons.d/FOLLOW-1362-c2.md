## 2026-10-20 · FOLLOW-1362 C2 — structured EN | PL quiz editor (Faza Q package Q7)

Built: `definition-ops.ts` (pure immutable ops), `question-card` / `answer-row` / `confirmation-tab`
/ `lint-panel` / `validate-draft` / `weight-suggestions-panel`, editor state for `can_write`,
`invalid_active` (+ raw JSON banner), 409 reload, `base_version` + `source: 'editor'` on Save.

Risks weighed: Save now depends on client lint, so a draft that is serve-schema-valid but lint-dirty
must keep the form visible (only serve-schema failures hide it). A single "Not quite" alternative
violates the serve schema (min 2) and would have flipped the whole form to "fix the JSON" on the
first tick — held in component state until 2 are chosen. No saved row now starts from the built-in
default (what buyers are served), `invalid_active` never loads a starter (Rule K.2, consumer side).
Existing editor-test fixture moved to a lint-clean EN+PL definition (authoring lint blocks Save).

Guardrail I'd add: any editor control that writes a partial value into a JSON-as-state draft needs a
test that the form is still rendered after the first interaction (hard-error hiding is a UX cliff).
