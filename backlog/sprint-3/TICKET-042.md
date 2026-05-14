# TICKET-042 — Decision API Integration in Sidebar Widget (fetchDirectives → render)

**Sprint:** 3 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** BLOCKED
**Depends on:** TICKET-037 (sidebar widget), TICKET-024 (JWT auth, merged PR #42) **Unblocks:**
TICKET-045

## Context

**Note:** `fetchDirectives` and `applyDirectives` were partially shipped in TICKET-FIX-010 (commits
`6e4840f`, `6ad9dd9`). The intent-state wiring into `fetchDirectives` is done, and the re-fetch loop
(every `REFETCH_SIGNAL_INTERVAL` signals) is done.

This ticket narrows to: **displaying the returned directives inside the sidebar widget** — so the
buyer can see what text is being applied to the listing page, and why.

The `index.ts` `refreshDirectives()` function already calls `applyDirectives()` to mutate the host
page (Tier 2+). For the sidebar, it should additionally call `sidebar.update(state)` with the
directive data so the sidebar shows what's active.

**References:**

- `packages/sdk/src/core/adapt.ts` — `fetchDirectives`, `applyDirectives` (done)
- `packages/sdk/src/index.ts` — `refreshDirectives()` function (lines 108-127)
- `packages/sdk/src/ui/sidebar-widget.ts` — `SidebarState.directives` (TICKET-037)
- `packages/sdk/src/core/intent.ts` — `IntentState`, `ArchetypeId`

## What to build

### Wire sidebar.update() into refreshDirectives()

In `packages/sdk/src/index.ts`, update `refreshDirectives()`:

```typescript
async function refreshDirectives(): Promise<void> {
  if (!config.decisionApiUrl) return;
  const resp = await fetchDirectives(config, currentSession, 'listing_list', currentIntentState);
  if (resp) {
    resetAdaptState();
    applyDirectives(resp.directives, {
      archetypeId: resp.archetype as ArchetypeId,
      confidence: resp.confidence,
      sessionId: currentSession.sessionId,
    });

    // NEW: Update sidebar with current adaptation state
    const archetypeLabel = formatArchetypeLabel(resp.archetype); // 'yield_hunter' → 'Yield Hunter'
    const sidebarDirectives = resp.directives
      .filter((d) => d.type === 'text' && d.text)
      .map((d) => ({ slot: d.slot, text: d.text ?? '' }));

    sidebar?.update({
      archetype: archetypeLabel,
      confidence: Math.round(resp.confidence * 100),
      signalCount: currentIntentState.signal_count,
      directives: sidebarDirectives,
    });

    // Show sidebar if archetype is non-neutral with sufficient confidence
    if (resp.archetype !== 'neutral' && resp.confidence >= 0.6) {
      sidebar?.show({
        archetype: archetypeLabel,
        confidence: Math.round(resp.confidence * 100),
        signalCount: currentIntentState.signal_count,
        directives: sidebarDirectives,
      });
    }
  }
}
```

Add a `formatArchetypeLabel(id: string): string` helper in sidebar-widget.ts that converts
`yield_hunter` → `Yield Hunter`, `family_buyer` → `Family Buyer`, etc.

### Re-fetch debounce (500ms)

The existing `REFETCH_SIGNAL_INTERVAL = 5` already throttles re-fetches. Do NOT add an additional
debounce timer — it would interact badly with the existing interval logic. The plan document
mentioned 500ms debounce but the current codebase uses signal-count gating which is more appropriate
for this use case.

## Acceptance criteria

- [ ] After `fetchDirectives` returns a non-neutral archetype with confidence ≥ 0.6, the sidebar
      becomes visible
- [ ] Sidebar shows archetype name in human-readable format (e.g. "Yield Hunter" not "yield_hunter")
- [ ] Sidebar shows confidence as a percentage (e.g. "85%")
- [ ] Sidebar shows the list of applied directives (slot name + text value) from the response
- [ ] When a new `fetchDirectives` response arrives, the sidebar **updates** (not remounts) the
      displayed data
- [ ] `formatArchetypeLabel()` is exported and tested in `sidebar-widget.test.ts`
- [ ] `neutral` archetype response does NOT trigger sidebar show (sidebar remains hidden)
- [ ] E2E test in `packages/sdk/e2e/sidebar-widget.spec.ts` verifies the directive text appears in
      the sidebar after mock Decision API returns a response

## Scope boundary

This ticket does NOT implement:

- Consent state interaction with the sidebar (that's TICKET-041)
- The chat input / question answering in the sidebar (that's post-MVP)
- Any host page DOM mutation (Tier 2 only, not Tier 1)
- npm publish (that's TICKET-043)
