## 2026-11-06 / FOLLOW-1444

**What I built:** The withdrawal control renders wherever the toggle does, flag on, off or never
set. Its three sentences (`withdrawWhy`, `withdrawDone`, `withdrawFail`) are optional fields of the
served consent text, fetched on the granted path through the same `fetchConsentText()` call site.
The click empties the toggle into a `role="status"` line (in-bundle state text first, then the
served result); `deleteThenEraseXid()` now returns whether anything is left to delete, and the
teardown takes `keepUi`. +144 B gzip (plan estimate +124).

**What was uncertain:** Whether the toggle's checkbox can write storage after the denial while the
delete is in flight: it can, so the click removes the controls synchronously. Whether adding
optional served fields needs a `text_version` bump: the ADR says "every copy change", the code says
only `MIN_PROFILE_TEXT_VERSION` re-prompts, so a bump is harmless but was left to the PM.

**A guardrail I'd add:** When a fetch that fails closed on one path is reused on another, state in
the code and the ADR which failure mode each caller has, and test both: the same `null` means "halt"
for the banner and "fall back" for the withdrawal control.
