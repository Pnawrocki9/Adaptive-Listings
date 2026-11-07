## 2026-11-07 / FOLLOW-1445

**What I built:** One "Download my data" `<button>` in the toggle (`showData()`), offered by
`mountOptOutToggle()` only for a sent, live xid; `postProfileErase` generalised into a private
`postProfile(config, action, xid)`, plus `downloadProfile()` (portability POST, Blob URL, detached
`<a download>`, revoke in a timeout). Label and failure text in the in-bundle COPY, so no
`text_version` change. +360 B gzip (plan +327 measured, +240 est.).

**What was uncertain:** Whether "no xid" cases stay control-free with the flag on: they do not, the
first decision marks the freshly minted id `sent` before the toggle mounts, so the control is
correctly offered on that same page. My first red tests assumed otherwise. Firefox and WebKit are
not installed locally, so the detached-anchor download was proven in Chromium only.

**A guardrail I'd add:** Before writing "absent when X" tests for a control gated on stored state,
list every writer of that state on the init path that runs before the mount (here `markXidSent()` in
`adapt.start()`), and pin the flag that disables each writer in the test.
