## 2026-10-20 · FOLLOW-1362 C3 — simulator, versions UI, publish dialog, local draft, import/export

Built: `quiz-simulator` (drives `nextStep`, EN|PL confirmation copy, all-paths table with ties),
`versions-panel` (collapsed, fetches on open; diff / restore / revert via `ConfirmDialog`),
`publish-dialog` (+ `diff-view`), `use-local-draft` (localStorage by tenant + base version, restore
prompt, `beforeunload`), `import-export` (authoring schema, dropped-keys notice, draft only,
`source: 'import'`), `editor-banners` + `use-suggest-weights` extracted to keep the editor ~430
lines.

Risks weighed: autosave must not run before the restore prompt is answered, or the loaded text
erases the stored draft (the first pass after load only arms it). The versions panel is lazy: C2
tests chain `mockResolvedValueOnce` per fetch, an eager panel GET would steal their responses, and a
failed history read renders an error, never "no versions" (Rule K.2). The one-click Save became
Publish… + dialog, so the C2 tests that clicked Save now go through a `publish()` helper (button
regex `save definition` -> `publish`); behaviour assertions are unchanged. Restore/revert send
`base_version`; 409 shows a reload prompt, never an auto-retry.

Guardrail I'd add: a test helper convention that stubs `fetch` by URL, not by call order, so that
adding a sibling fetch to a page cannot silently re-route older tests' responses.
