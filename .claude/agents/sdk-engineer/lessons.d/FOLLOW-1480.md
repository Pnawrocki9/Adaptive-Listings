## 2026-11-07 / FOLLOW-1480

**What I built:** The profiling panel collapses to a 24 px `[data-estalara-toggle-icon]` `<button>`
(`aria-label` = locale title, `aria-expanded`) `COLLAPSE_MS` (3000) after it appears; the panel
stays in the DOM with `display:none`. One timer; pointer over the panel or focus inside it are
checked when the timer fires, and `pointerleave` / `focusout` / a withdraw click re-arm it. A
keyboard activation (click `detail === 0`) moves focus to the switch. Both harnesses reach
`[data-estalara-withdraw]` through an `openToggleControl()` helper (icon click, then hover). +240 B
gzip; headroom 271 B before, 31 B after.

**What was uncertain:** Whether `document.activeElement` has moved yet inside a `focusout` handler
differs by engine, so the hold is read when the timer fires, not in the handler. That also made
`focusin` unnecessary and paid for the bytes. Chromium (scratch Playwright page) showed a removed
hovered child leaves the parent with no `pointerleave`, so the withdraw click drops the hover flag;
and the icon needed `pointer-events:auto` under the `pointer-events:none` host. Firefox/WebKit not
run.

**A guardrail I'd add:** For a UI timer with "hold while X", check X at fire time and re-arm on the
"X ended" events only; flags kept in sync by enter/leave pairs cost bytes and break on touch.
