## 2026-10-21 / FOLLOW-1371

**What I built:** The quiz card caps its height at `min(100dvh - offset_y - 16px, 80dvh)` (a `vh`
line first as the fallback), scrolls its body, and keeps × + EN | PL in one sticky header row. The
placement offset is kept, so the opt-out toggle stays visible under the card. +127 B gzip.

**What was uncertain:** jsdom has no layout, so the proof is a Playwright spec measuring the real
card (375x667 EN/PL, 1280x720 PL, 667x375 PL): red first at -59 / -126 / -6 / -351 px. The shadow
host's `*{box-sizing:border-box}` is what makes `max-height` include the padding.

**A guardrail I'd add:** Any fixed-position SDK surface gets a viewport-fit Playwright check at
375x667 before merge.
