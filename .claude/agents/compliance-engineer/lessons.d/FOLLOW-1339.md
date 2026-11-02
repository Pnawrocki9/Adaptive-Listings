- **2026-11-02 / FOLLOW-1339** · Reviewed `X-Estalara-Session-Id` and the signed conversions, then
  applied DPIA v2.28, ROPA v2.23, LIA v2.2, Notice v1.16 and handover row 21 with ESC-091 open. ·
  Where a disclosure could have drifted: the DPIA's "Time2Show does not collect directly identifying
  information" went stale at ESC-085, because the sentence assumed the host was another company; the
  brief's "nothing links them in storage" missed `lead_id` on `chat.message.sent`; Notice §1's "or
  any account credentials" was already false against `boot.ts:160`; and I was told C-5 was applied
  while the helper and the delivered patch did not yet have it. The local helper landed minutes
  later, and the delivered patch still lacked it at sign-off, so a local tree and its handover diff
  are two facts. · Guardrail I'd add: _when a new system receives an AL identifier, grep the corpus
  for that system's name, and zero hits is itself a finding; re-grep any "already applied"
  instruction, in the tree and in the patch the CTO will apply, immediately before writing it into a
  legal record._
