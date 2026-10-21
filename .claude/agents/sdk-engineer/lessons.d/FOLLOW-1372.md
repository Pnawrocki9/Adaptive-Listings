## 2026-10-21 / FOLLOW-1372

**What I built:** The quiz card is a non-modal `role="dialog"` named (`aria-labelledby`) by the
step's question / result line; Escape = × (it clicks the same button, so `dismissed` / `unconfirmed`
exactly as before); EN | PL is a labelled group of real buttons; a re-render keeps keyboard focus on
the button at the same position, only when focus was already in the card; 44 px targets; secondary
text #6b7280 (4.83:1). +195 B gzip.

**What was uncertain:** The card re-renders by `innerHTML = ''` on every selection and language
switch — without the focus restore a keyboard user lands on `<body>` after each press. In the e2e
lint project DOM return types resolve as error types; use Playwright locators (`:focus`,
`toHaveCSS`, `toHaveAccessibleName`) instead of returning DOM values from `page.evaluate`.

**A guardrail I'd add:** A widget that rebuilds its DOM on interaction needs a keyboard test that
asserts where focus lands after each action.
