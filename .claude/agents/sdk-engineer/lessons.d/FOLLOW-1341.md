## 2026-11-02 / FOLLOW-1341 + FOLLOW-1342

**What I built:** Patches for web-master (no SDK change): `data-estalara-slot` markers for `cta`
(three text-only buttons) and `feature` (Amenities heading), and `data-debug` from
`PUBLIC_ESTALARA_DEBUG`.

**What was uncertain:** Copy fit of playbook `cta`/`feature` strings against the chosen elements; N3
has no hop for `cta`/`feature`, so K5 cannot assert them by script yet.

**A guardrail I'd add:** A slot element must hold exactly one text label (the text directive
overwrites `textContent`); check attributes set via `setAttribute` against the live DOM, not a
source grep.
