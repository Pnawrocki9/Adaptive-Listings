# TICKET-037 — SDK Tier 1 Sidebar Widget (Shadow DOM)

**Sprint:** 3 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 8 **Status:** READY
**Depends on:** TICKET-031 (merged PR #50) **Unblocks:** TICKET-038, TICKET-039, TICKET-041,
TICKET-042, TICKET-044, TICKET-045

## Context

TICKET-031 shipped the SDK core: session, events, observer, `fetchDirectives`, `applyDirectives`,
and the `createShadowHost()` utility. The Shadow DOM host is already created in `index.ts` (step 5)
and the quiz widget demonstrates the vanilla DOM pattern for Shadow DOM components.

This ticket builds the **Tier 1 Observer sidebar panel** — the persistent, draggable sidebar that
buyers see. This is the main visible product. It contains a chat panel (Tier 1: shows current
archetype + collected signals; no DOM mutation on host page), a drag handle, and a close/minimize
button.

**IMPORTANT: Use vanilla DOM (not Preact).** The existing quiz-widget.ts pattern is the right model.
Preact adds ~3KB gzip to the bundle — use it only if the widget grows complex enough to warrant it
(post-MVP decision). For MVP the vanilla DOM approach is simpler and stays well under the 40KB gzip
gate.

**References:**

- `packages/sdk/src/ui/shadow-host.ts` — `createShadowHost()`, `ShadowHost` interface
- `packages/sdk/src/ui/quiz-widget.ts` — vanilla DOM component pattern to follow
- `packages/sdk/src/index.ts` — line 135 (shadow host creation); sidebar mounts here
- `packages/sdk/src/core/session.ts` — `SessionData` (sessionId, pageCount, etc.)
- `packages/sdk/src/core/intent.ts` — `IntentState`, `ArchetypeId` (what to display)
- `packages/sdk/src/core/adapt.ts` — `fetchDirectives`, `applyDirectives` (Tier 1 read path)
- `docs/MASTER_DESIGN.md` — sections B (SDK tiers), E.2 (adaptation), U (agency)

## What to build

New file: `packages/sdk/src/ui/sidebar-widget.ts`

The sidebar is a fixed panel at the right edge of the viewport, inside the Shadow DOM. On Tier 1
Observer it shows:

1. **Header** — Estalara icon + "Personalizing for you" text + close button (×)
2. **Archetype chip** — current detected archetype (e.g. "Yield Hunter") + confidence %
3. **Signal summary** — "We noticed: [N scroll events, M listing views, K clicks]"
4. **Directives preview** (if `fetchDirectives` returned data) — the adaptation headlines/CTAs that
   were applied to `data-estalara-slot` elements on this page
5. **Drag handle** — left edge, allows repositioning vertically

The sidebar is hidden initially (`display: none`). It opens when the quiz trigger is clicked OR
after the first `fetchDirectives` response arrives with a non-neutral archetype (confidence ≥ 0.6).

### File structure

```typescript
// packages/sdk/src/ui/sidebar-widget.ts

export interface SidebarWidgetOptions {
  accentColor: string;
  language: 'en' | 'pl';
  onClose: () => void;
}

export interface SidebarState {
  archetype: string;
  confidence: number;
  signalCount: number;
  directives: Array<{ slot: string; text: string }>;
}

export function createSidebarWidget(
  shadowRoot: ShadowRoot,
  options: SidebarWidgetOptions,
): {
  show: (state: SidebarState) => void;
  update: (state: SidebarState) => void;
  hide: () => void;
  destroy: () => void;
};
```

The widget returns a controller object (show/update/hide/destroy). The caller (`index.ts`) calls
`update(state)` after each `fetchDirectives` response.

## Acceptance criteria

- [ ] `packages/sdk/src/ui/sidebar-widget.ts` exists and exports `createSidebarWidget`
- [ ] Sidebar renders inside the existing Shadow DOM root (NOT as a new `attachShadow` call)
- [ ] Sidebar is visually isolated — no host page CSS leaks into the widget (test via Playwright:
      add a `* { color: red !important }` style to host page and verify widget text is NOT red)
- [ ] Sidebar shows archetype name and confidence when state is provided
- [ ] Close button hides the sidebar (dispatches `sidebar.closed` event via eventQueue)
- [ ] Drag handle allows vertical repositioning (mousedown + mousemove on handle element)
- [ ] Sidebar does NOT modify any host page DOM — read-only Tier 1 observer constraint
- [ ] `index.ts` is updated to call `createSidebarWidget` and wire `update()` after each
      `refreshDirectives()` response when archetype confidence ≥ 0.6
- [ ] Unit test in `packages/sdk/src/__tests__/sidebar-widget.test.ts` covers:
  - mount / show / hide / destroy lifecycle
  - state update reflects in DOM
  - close button fires `onClose` callback
  - drag handle listeners are attached
- [ ] No new production dependencies added (zero new `dependencies` entries in `package.json`)

## CSS guidelines

Follow the pattern from `quiz-widget.ts`:

- Inject `<style>` into Shadow DOM alongside the widget element
- Use BEM-like class names: `.estalara-sidebar`, `.estalara-sidebar__header`, etc.
- Sidebar width: 280px
- `position: fixed; right: 0; top: 50%; transform: translateY(-50%);` initial position
- Background: `#ffffff`, border-left: `3px solid {accentColor}`,
  `box-shadow: -4px 0 16px rgba(0,0,0,0.12)`
- Draggable: track `top` offset on drag (clamp 0–100vh)
