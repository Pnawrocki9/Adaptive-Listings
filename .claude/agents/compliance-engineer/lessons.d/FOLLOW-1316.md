**2026-11-02 / FOLLOW-1316 (signed review)** · **Documented:** the signed record, DPIA §13.2 and
§13.5, ROPA Activity 18, Notice §3 (DO NOT PUBLISH), LIA, README. Verdict BLOCK on one red required
gate, PASS WITH CONDITIONS once it is fixed. · **Where a disclosure could have drifted:** the brief
said "class and reorder stay until reload", and the code restores only headline and description, so
`cta` and `feature` stay too; a draft of §13.2 repeated "text directives revert" until I read
`restoreOriginalSlots()`. The control is also absent with the flag off, so the banner's "deleted if
you withdraw" still has nothing behind it wherever the flag is off. And other open tabs keep
adapting. None was on the departures list. · **Guardrail I'd add:** run every gate that reads the
docs **before** reading anything else; `Consent corpus sync` was already red in CI on the PR under
review. For a withdrawal claim, read the revert function against the directive types the live
evidence actually served. Keep the "all N keys" sentence honest with a grep of every `setItem`: the
keys gate sees only three name suffixes.
