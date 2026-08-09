# FOLLOW-925 — compliance lesson (2026-08-09)

- **Date / ticket:** 2026-08-09 / FOLLOW-925 (the three ADR-0021 §D5 countersign conditions had no
  consumer).
- **What I decided:** Built `scripts/check-adr-0021-conditions.mjs` as a hard CI gate rather than
  adding the obligations to the FOLLOW-915 ticket text, because the ticket text is what already
  failed — the countersign said the conditions "gate the implementation PR" and nothing read them.
- **The design problem, and the answer:** all three conditions attach to artifacts FOLLOW-915 has
  not created. A gate that passes while they are absent is green-over-absence — the FOLLOW-918
  defect wearing this control's name. So the gate ARMS on the presence of ANY §D7 artifact and then
  demands all three, which also makes a HALF-landed implementation red. Condition 1 is enforced in
  both states, against a checked-in canonical byte record, so the sentences always have a live home
  and cannot be in flight between two homes with none.
- **Why a canonical record and not the Zod schema:** ADR-0021 §D7's schema locks the document's
  SHAPE. The countersign demands BYTE identity of two specific legally mandated sentences per
  locale, which no schema can express. Different artifacts, different jobs — and ESC-051 is byte
  pressure on exactly the file that holds those sentences, so the trimming failure mode is the live
  one, not hypothetical.
- **What the self-test caught in my own gate:** the key regex `disclosure13_1:` also matched
  `retired_disclosure13_1:`, so retiring a key by prefixing it left the gate believing `COPY` was
  still the source of record — silently disarming condition 3 and the no-home check. Two of eleven
  cases failed on the first run and found it. A gate without a red-first self-test would have
  shipped believing it was enforcing three conditions while enforcing one.
- **A guardrail I'd add:** when a gate decides "has this moved yet?" from the PRESENCE of a symbol,
  test the RENAMED form, not only the deleted form. Deletion is the shape nobody performs; renaming
  and prefixing is the shape people actually use — the same asymmetry FOLLOW-919 found in the Modal
  effect probe (deleted → caught, zero-byte → green) one day earlier.
