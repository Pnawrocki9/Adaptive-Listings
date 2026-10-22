- **2026-10-22 / FOLLOW-1377** · Added Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1 to the generation
  allow-lists, with one typed catalog (`lib/generation-models.ts`) feeding the generator, the
  `/api/adapt` gateway and the Platform Settings cost/time hints; fixed two off-list prices (Haiku
  4.5 4x under, Opus 4.8 3x over). · Risks weighed: adding ids to an allow-list alone would have
  shipped 100 % failed generations — every 5.x model thinks by default and thinking counts against
  `max_tokens`, and the generator read `content[0]` (the thinking block), so each reply looked
  "empty"; the global model also drives the `/api/adapt` full-gen branch at `max_tokens: 512`, which
  a description-only fix would have missed; kept 4.x request bodies byte-identical (parity corpus
  pins them); found that the current default Sonnet 4.6 truncates 3/4 fixture descriptions at the
  450 floor (reported, not changed). · Guardrail I'd add: a live smoke for any new model id through
  the real generator before it enters an allow-list (a static allow-list test cannot see thinking or
  tokenizer changes).
