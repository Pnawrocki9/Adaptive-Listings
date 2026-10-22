# Default generation model: Haiku 5.5 vs Sonnet 5.5 (FOLLOW-1380, 2026-10-22)

**Status:** evidence record for the CEO's question (2026-10-22): which model should be the default
generation model. Nothing in this study changes code or configuration. The default in code is still
`claude-sonnet-4-6` (`DEFAULT_GENERATION_MODEL`,
`apps/control-plane/src/lib/global-config-store.ts`). Run by the ml-engineer agent (Opus 5.5) on
localhost with the Doppler dev Anthropic key. Nothing was written to a cache, a database or
production.

**Verdict: Sonnet 5.5.** This follows the decision rule stated below, but the margin is thin. In
blind reading Haiku 5.5 is as good as Sonnet 5.5: overall it wins 13 pairs and loses 10, p = 0.68,
and its Polish is no worse. It fails the faithfulness gate on counts:

- 10 claim-check refusals against 7;
- 8 contradictions of the listing against 4;
- 2 descriptions in the wrong language against 0.

None of these differences is statistically significant at n = 24. Most of the refusal gap comes from
a checker bug that does not depend on the model (§6). Re-test Haiku after the fixes in §6. At 20×
lower cost and 1.5× lower latency it would very likely be the right default if it passes.

---

## 1. Decision rule (fixed before the run, from the PM brief)

Recommend Haiku 5.5 as the default only if all three hold. Otherwise recommend Sonnet 5.5.

1. **Faithfulness gate:** Haiku 5.5 has no more hallucinations or claim-check refusals than Sonnet
   5.5.
2. **Polish fluency:** Haiku is not significantly worse on Polish fluency.
3. **Overall preference:** blind overall preference is not significantly worse for Haiku (sign test
   p ≥ 0.05 against it, or Haiku wins).

## 2. Method

**Generator.** Both models went through the real generator, `generateDescription()`
(`apps/control-plane/src/lib/description-generator.ts`). That covers the same v1.9 system prompt,
the curated `copy_template` for the locale, the verdict parser, `checkBodyClaims`, the headline call
and `checkHeadlineFacts`. Each model used its FOLLOW-1377 request profile from
`generation-models.ts`:

- Haiku 5.5: `thinking: disabled`.
- Sonnet 5.5: `between_tools` + `effort: low`.

No reply contained a thinking block. Every stop reason was `end_turn`. The two models ran
alternately, case by case. There was one sample per case at the API's default temperature, as in
production.

**Inputs.** 6 listings × 2 archetypes × {EN, PL} = 24 cases per model. Both models got the same
inputs. `listing_context` uses the production keys (`listing_title`, `listing_price`,
`listing_location`), shaped as `listing-details.ts` builds them.

| Key | Listing                                                                       | Kind                                | Original  | Archetypes                                  |
| --- | ----------------------------------------------------------------------------- | ----------------------------------- | --------- | ------------------------------------------- |
| fx  | Palm Coast FL house, the FOLLOW-819 fixture `839ecbd1-…` (as :8081 serves it) | house, short                        | EN, 31 w  | family_buyer, retiree_relocator             |
| krk | Krakow Podgorze apartment, let                                                | apartment, long, rent/lease figures | EN, 216 w | yield_hunter, first_time_buyer              |
| waw | Warsaw Mokotow apartment                                                      | apartment, medium                   | PL, 88 w  | first_time_buyer, lifestyle_expat           |
| alb | Albufeira studio                                                              | apartment, sparse facts             | EN, 15 w  | yield_hunter, second_home_buyer             |
| gda | Straszyn house near Gdansk, needs work                                        | house, medium, renovation needed    | PL, 76 w  | family_buyer, flip_investor                 |
| jav | Javea villa with tourist licence                                              | house, long, rental licence         | EN, 140 w | vacation_rental_investor, retiree_relocator |

Archetypes are quiz results. Two listings have Polish originals, so EN output from them tests
composition across languages. So does PL output from the English originals.

**Measures.**

1. **Generator outcomes.** Verdict (FIT, NEUTRAL, REFUSED, FAILED), refusal reason, headline served
   or refused, tokens, latency (wall time of the description call plus the headline call), and cost
   from `llm-pricing.ts` `computeCost`.
2. **Deterministic checks.**
   - Numbers in the text that are absent from the listing, with thousands separators normalised.
   - The generator's own digit tokens that its grounding misses, to explain each
     `hallucinated_number`.
   - Capitalised names absent from the listing (for manual review).
   - Output language (function-word vote) of the body and of the headline.
   - Length against the original.
   - `steersByFamilialStatus` (`@estalara/shared/playbook-traits`) and the protected-stem list from
     `playbooks.protected-characteristics.test.ts`.
3. **Blind pairwise judgment.** Every case where both models wrote a description body was judged: 24
   of 24 (FIT or REFUSED). The judge was `claude-opus-5-5`, a third model. Each pair was judged
   twice with the A/B order swapped. The judge never saw a model name, verdict or case id. It scored
   four criteria 1–5 and gave a per-criterion and overall preference:
   - faithfulness;
   - fluency in the target language (native-quality Polish called out);
   - archetype fit;
   - persuasiveness without hype.

   A preference counts only when both orders name the same model; otherwise it is a tie. The sign
   test is two-sided over non-tied pairs. Results are reported for all written pairs and for served
   pairs only (both FIT). Headlines were not shown to the judge: the headline prompt has no locale
   (§6), so both models' headlines follow the original's language.

4. **Blind single-text error audit.** `claude-opus-5-5` audited each of the 48 bodies alone, with no
   model name, in shuffled order. It used a strict definition that excludes the generic framing the
   generator prompt permits:
   - **contradiction:** the text contradicts the listing;
   - **invented property fact:** a specific fact about the property that the listing does not state;
   - **external claim:** a fact about the area or market from outside the listing.

   It also listed Polish grammar errors and calques.

## 3. Results

### 3.1 Generator outcomes (24 cases per model)

| Model      | FIT (served) | NEUTRAL | REFUSED                                                 | FAILED | headline served on FIT          |
| ---------- | ------------ | ------- | ------------------------------------------------------- | ------ | ------------------------------- |
| Haiku 5.5  | 14           | 0       | 10 (9 `hallucinated_number`, 1 `unsupported_guarantee`) | 0      | 13/14 (1 `unsupported_amenity`) |
| Sonnet 5.5 | 17           | 0       | 7 (4 `hallucinated_number`, 3 `unsupported_amenity`)    | 0      | 17/17                           |

In 7 cases only one model was refused: 5 Haiku-only, 2 Sonnet-only (sign test p = 0.45). Of the 17
refusals, **16 are checker false positives** and 1 is a true positive:

- **Number format (13 refusals: 9 Haiku, 4 Sonnet).** The text writes a listing number with a
  thousands separator ("949 000 PLN", "1 150 000 zł", "45,000 zł"). The listing has "949000 PLN" or
  "45 000 zł". `checkNumbers` tokenises "949 000" into "949" and "000" and finds neither in the
  grounding. My separator-normalised cross-check found **no** number in any refused text that is
  absent from the listing. Haiku is refused more often because it writes Polish-style "189 000 EUR"
  more often. Sonnet more often copies "189000 EUR" verbatim.
- **English-only amenity check on a Polish original (3 refusals, all Sonnet).** The text says
  "garage" or "fireplace", but the listing says "hala garażowa" or "kominek". The amenity regex
  looks for the English word in the grounding.
- **True positive (1, Haiku).** "Turnkey and ready to host from week one" in the Javea
  vacation-rental case. The word comes from the vacation_rental_investor `copy_template` preferred
  lexicon ("turnkey"). The template and the claim check contradict each other there (§6).

### 3.2 Cost, latency, tokens (all 24 cases; headline call included when FIT)

| Model      | mean cost / case | mean desc tokens in / out | desc call p50 / p95 | wall p50 / p95 (desc + headline) |
| ---------- | ---------------- | ------------------------- | ------------------- | -------------------------------- |
| Haiku 5.5  | USD 0.00122      | 8,082 / 665               | 3.8 s / 6.7 s       | 4.2 s / 6.7 s                    |
| Sonnet 5.5 | USD 0.02519      | 8,082 / 712               | 6.0 s / 9.8 s       | 6.3 s / 9.8 s                    |

Over the served (FIT) cases only, the cost is USD 0.00124 against 0.02544 per description plus
headline, a ratio of **20.5×**. That is USD 1.24 against 25.44 per 1,000 descriptions. The output
token counts are higher than the FOLLOW-1377 fixture-only means (494 / 479) because these listings
are longer.

### 3.3 Language, length and steering

| Check                                         | Haiku 5.5                                                                                                  | Sonnet 5.5 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| Description body in the wrong language        | **2**: gda.family_buyer.en (FIT, **served**) and gda.flip_investor.en (REFUSED), both Polish on an EN page | 0          |
| Headlines in the wrong language               | 6 of 14                                                                                                    | 6 of 17    |
| Mean words on the long original (krk, 216 w)  | 216 (on target)                                                                                            | 260 (+20%) |
| Familial steering (`steersByFamilialStatus`)  | 0                                                                                                          | 0          |
| Numbers absent from the listing (served text) | 0                                                                                                          | 0          |

The generator has no language check, so a Polish body on an English page is served. Both
wrong-language bodies came from Polish originals with an EN locale. Haiku wrote 2 of its 4 such
cases in Polish; Sonnet wrote all 4 in English (p = 0.5). Both models overshoot the ±10% length
target on short originals, where the prompt allows extension: the median ratio is 2.2–2.8 for both.
On long originals Sonnet writes about 20% longer than Haiku.

### 3.4 Blind single-text error audit (`claude-opus-5-5`, 48 bodies)

| Model      | scope        | texts | with an error | contradictions | invented property facts | external claims | PL grammar/calque quotes |
| ---------- | ------------ | ----- | ------------- | -------------- | ----------------------- | --------------- | ------------------------ |
| Haiku 5.5  | all          | 24    | 13            | **8**          | 11                      | 6               | 22                       |
| Haiku 5.5  | EN           | 12    | 7             | 4              | 5                       | 5               | –                        |
| Haiku 5.5  | PL           | 12    | 6             | 4              | 6                       | 1               | 22                       |
| Haiku 5.5  | served (FIT) | 14    | 9             | 1              | 9                       | 5               | 10                       |
| Sonnet 5.5 | all          | 24    | 12            | **4**          | 13                      | 10              | 29                       |
| Sonnet 5.5 | EN           | 12    | 4             | 0              | 5                       | 5               | –                        |
| Sonnet 5.5 | PL           | 12    | 8             | 4              | 8                       | 5               | 29                       |
| Sonnet 5.5 | served (FIT) | 17    | 8             | 2              | 10                      | 4               | 17                       |

Total errors are level: 25 against 27. On texts with a contradiction or an invented fact, each model
has 6 cases where only it erred. **Contradictions** differ: 8 for Haiku in 5 texts, 4 for Sonnet in
4 texts.

Haiku's contradictions are mostly mistranslations of Polish real-estate terms:

- "księga wieczysta **i hipoteka**" for "land and mortgage register", which implies an existing
  mortgage;
- "pełna własność **gruntu**" for a freehold flat;
- "two-bedroom flat" for "dwupokojowe", which is one bedroom plus a living room;
- "concierge" for "ochrona", which means security;
- "ready to live in" for a flat let until June 2027.

Most of them sit in texts the number false positive happened to refuse. Only 1 Haiku contradiction
is in served text.

Sonnet's contradictions:

- "przeszklona lanai" (glazed) for a screened lanai;
- "cena wywoławcza" (auction starting price) for an asking price, which Haiku also used once;
- "dwupokojowe" for a two-bedroom flat, twice, which Haiku also did. Both models get the Polish
  room-count convention wrong.

Sonnet makes more external market claims (10 against 6). Most of them are the template-led "Jávea is
an established tourist market" or "Mokotów … attracts people from abroad".

### 3.5 Blind pairwise judgment (`claude-opus-5-5`, 24 pairs × 2 orders)

W/T/L is counted from Haiku's side. p is the two-sided sign test over non-tied pairs. "Agreed" means
both orders named the same model. Mean scores are 1–5 over both orders.

**All written pairs (n = 24)**

| Criterion      | Haiku wins | ties | Sonnet wins | p     | agreed | mean H | mean S |
| -------------- | ---------- | ---- | ----------- | ----- | ------ | ------ | ------ |
| faithfulness   | 9          | 9    | 6           | 0.607 | 17/24  | 3.31   | 3.25   |
| fluency        | 11         | 8    | 5           | 0.210 | 16/24  | 3.50   | 3.35   |
| archetype_fit  | 4          | 13   | 7           | 0.549 | 17/24  | 3.85   | 4.10   |
| persuasiveness | 12         | 6    | 6           | 0.238 | 20/24  | 3.46   | 3.27   |
| **overall**    | **13**     | 1    | **10**      | 0.678 | 23/24  | –      | –      |

**By locale, all written pairs**

| Criterion      | EN (n = 12) H–T–S | p     | PL (n = 12) H–T–S | p     | PL mean H / S |
| -------------- | ----------------- | ----- | ----------------- | ----- | ------------- |
| faithfulness   | 3–6–3             | 1.000 | 6–3–3             | 0.508 | 3.46 / 3.04   |
| fluency        | 4–6–2             | 0.688 | **7–2–3**         | 0.344 | 3.38 / 3.08   |
| archetype_fit  | 2–6–4             | 0.688 | 2–7–3             | 1.000 | 3.88 / 3.96   |
| persuasiveness | 6–2–4             | 0.754 | 6–4–2             | 0.289 | 3.46 / 3.21   |
| overall        | 6–1–5             | 1.000 | 7–0–5             | 0.774 | –             |

**Served pairs only, both FIT (n = 12; EN 7, PL 5)**

| Criterion      | all H–T–S | p     | EN H–T–S | PL H–T–S |
| -------------- | --------- | ----- | -------- | -------- |
| faithfulness   | 3–6–3     | 1.000 | 2–4–1    | 1–2–2    |
| fluency        | 5–6–1     | 0.219 | 2–5–0    | 3–1–1    |
| archetype_fit  | 4–5–3     | 1.000 | 2–3–2    | 2–2–1    |
| persuasiveness | 6–3–3     | 0.508 | 4–1–2    | 2–2–1    |
| overall        | 6–1–5     | 1.000 | 4–1–2    | 2–0–3    |

On position bias, the overall pick across the 48 single judgments was Text A 25 times and Text B 23
times. In 23 of 24 pairs both orders agreed on the overall winner. When the judge preferred Sonnet,
its reasons often named phrasing that the curated `copy_template` asks for. Examples are the closers
"the retirement you imagined, made operational", "exit math is straightforward" and "producing in
week one, not month six". Sonnet reproduces these more faithfully, and the judge did not see the
template (see §7).

## 4. Verdict against the rule

| Condition                          | Result                                                                                                                              | Met? |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1. No more hallucinations/refusals | Refusals 10 vs 7 (discordant 5 vs 2, p = 0.45). Contradictions 8 vs 4. Wrong-language bodies 2 vs 0. Total audited errors 25 vs 27. | No   |
| 2. PL fluency not worse            | Haiku better: 7–2–3, p = 0.34; mean 3.38 vs 3.08; 22 vs 29 grammar/calque quotes                                                    | Yes  |
| 3. Overall not significantly worse | Haiku 13–1–10, p = 0.68 (served-only 6–1–5)                                                                                         | Yes  |

**Recommendation: Sonnet 5.5 as the default generation model.** It is chosen because condition 1
fails, not because Sonnet reads better; it does not. Condition 1 fails on counts that are not
significant at this sample size. The refusal gap is mostly the checker's number-format bug. The
signals that remain are the 2 Polish bodies on English pages (one served) and the mistranslated
Polish legal terms. Both concern correctness, not style, and both cluster on Polish originals, which
is our home market.

**Per-language split** (for example Haiku for EN, Sonnet for PL): **not supported by the data**, and
it would need code, because the setting is one global model today.

- On EN pages Haiku ties on overall preference (6–1–5) but has 4 contradictions there against
  Sonnet's 0, plus both wrong-language bodies. 3 of the 4 contradictions and both wrong-language
  bodies come from Polish originals, so the risk depends on the source language, not the page
  locale.
- On PL pages Haiku leads on fluency (7–2–3) and has the same contradiction count as Sonnet (4 vs
  4). It is refused more often (6 vs 3), almost entirely by the number-format bug.

## 5. Cost of this study

| Item                                                    | Calls | USD      |
| ------------------------------------------------------- | ----- | -------- |
| Generation, Haiku 5.5 (24 descriptions + 14 headlines)  | 38    | 0.03     |
| Generation, Sonnet 5.5 (24 descriptions + 17 headlines) | 41    | 0.60     |
| Pairwise judge, Opus 5.5 (24 pairs × 2 orders)          | 48    | 0.73     |
| Error audit, Opus 5.5 (48 bodies)                       | 48    | 0.62     |
| Smoke run (generation, 1 case × 2 models)               | 2     | 0.02     |
| **Total**                                               |       | **2.01** |

The budget was USD 3. All prices come from `llm-pricing.ts`, at list price with no caching.

## 6. Findings that do not depend on the model (proposed FOLLOWs; not fixed here)

1. **`checkNumbers` refuses correctly formatted numbers.** "949 000 PLN", "1 150 000 zł" and "45,000
   zł" are refused against "949000 PLN" and "45 000 zł", because the digit tokeniser does not join
   thousands separators on either side. 13 of 48 outputs were refused for this alone, 9 of them on
   PL pages. Today, a Polish page for any listing priced at 1,000 or more is likely to fall back to
   the agent's copy. Fix: canonicalise thousands groups (space, NBSP, comma, dot) on both sides
   before comparison.
2. **The amenity claim check is English-only.** A Polish original grounds no English amenity word
   ("kominek" does not ground "fireplace"). This caused 3 refusals.
3. **The headline prompt has no locale.** Headlines follow the original's language, not the page's.
   12 of 31 headlines written by the two models were in the wrong language (6 per model). Fix: pass
   `locale` into `renderHeadlinePrompt`.
4. **The generator has no output-language check.** A Polish body was served on an EN page. Add a
   cheap language check before FIT, in the same place as `bodyViolatesContract`.
5. **`copy_template` lexicon against claim check.** The vacation_rental_investor template prefers
   "turnkey", which `checkBodyClaims` refuses when the listing does not say it. Its closers ("in
   week one, not month six"; "made operational"; "exit math") also read as unsupported or calqued
   claims in Polish.
6. **Polish room-count convention.** Both models translate "two-bedroom" as "dwupokojowe" (one
   bedroom plus a living room). A one-line prompt note ("pokoje count includes the living room")
   would fix it for any model.

After fixes 1–4, re-run this comparison with at least 60 cases, at least half of them with Polish
originals, before deciding again. The scripts are reusable as they are.

## 7. Limitations

- **Small sample.** 24 cases, one sample each at default temperature. No difference in this report
  is significant at p < 0.05. The study can detect only a large quality gap, and it found none.
- **One judge model, from the same family.** `claude-opus-5-5` is a Claude model judging Claude
  models. Order bias was controlled (both orders, agreement rule) and showed no position effect
  (25/23). Family self-preference cannot be ruled out. No human rated the texts; the CEO sample
  (`MODEL-COMPARE-BLIND-SAMPLE-2026-10-22.md`) is the human check.
- **The judge did not see the `copy_template`.** Where Sonnet follows the template's mandated
  closers more literally, the judge marked them as hype or unsupported. Template adherence, a
  product requirement (FOLLOW-027), was not scored.
- **Constructed inputs.** Five of the six listings were written for this study and are
  realistic-shaped, not production data. In production the backend may supply a description per
  locale. If PL pages always get a Polish original, the cross-language cases here, where most Haiku
  errors sit, would be rarer.
- **Headlines were excluded from the quality judgment.** They are compared only deterministically
  (§3.3).
- **Manual and blind error audits.** The error figures in §3.4 come from the blind single-text
  audit. I also read all 48 texts unblinded and agree with every contradiction listed in §3.4. "Cena
  wywoławcza" is a borderline call: Polish agencies use it loosely.
- **Latency.** One machine, sequential calls to the public API. Use it to compare the two models,
  not as an SLA.

Raw JSONL (generations, judgments, audit) and the scripts (`gen.live.test.ts`, `judge.mjs`,
`errors.mjs`, `analyze.mjs`, `blind.mjs`) stay in the session scratch area. They are not committed.

NEXT: PM files FOLLOWs for §6 items 1–4. Then re-run this comparison (≥ 60 cases, ≥ 50% Polish
originals) and decide on Haiku 5.5 again.
