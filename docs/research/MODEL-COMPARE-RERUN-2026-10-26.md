# Default generation model, re-run: Haiku 5.5 vs Sonnet 5.5 (FOLLOW-1399, 2026-10-26)

**Status:** evidence record for the CEO's decision on the default generation model. It repeats the
first study (`MODEL-COMPARE-HAIKU55-SONNET55-2026-10-22.md`, FOLLOW-1380) at a larger n, after the
generator fixes FOLLOW-1381–1384 and 1388–1395 merged (`main` `9560950a`). Nothing in this study
changes code or configuration. The default in code is `claude-sonnet-5-5`. Run by the ml-engineer
agent (Opus 5.5) on localhost with the Doppler dev Anthropic key. Every sink was stubbed: nothing
was written to a cache, a database, ClickHouse or production.

**Verdict: Sonnet 5.5 stays the default.** The same pre-stated rule as the first study decides it,
and again condition 1 (faithfulness) is the one Haiku fails. The picture has changed, though:

- **Claim-check refusals are now level:** 12 for Haiku, 13 for Sonnet. In the first study they were
  10 against 7, and most of the gap was the thousands-separator bug that FOLLOW-1381 fixed.
- **Contradictions of the listing are level:** 20 against 24 in the blind audit.
- **Haiku still fails on two counts.** It wrote a Polish body on an English page 6 times, Sonnet 0
  times (6 of the 16 EN pages built from a Polish original; sign test p = 0.031). FOLLOW-1384 now
  stops these bodies, so they are not served, but they cost Haiku served copy. Haiku also invents
  more specific property facts: 41 items in 30 texts, against 26 in 19 (paired p = 0.071).
- **Quality is a split decision.** Overall preference is a tie (Haiku 24, Sonnet 30, p = 0.50).
  Haiku writes significantly better Polish (PL pages 15–9–4, p = 0.019). Sonnet fits the buyer
  profile significantly better (28–25–6, p = 0.0002) and writes better headlines (14–18–2, p =
  0.004).
- **Served rate is level:** a body was served in 42 of 60 cases for Haiku and 45 of 60 for Sonnet.
  Body and headline were both served in 40 of 60 cases for each model.

Haiku is about **21× cheaper** (USD 0.0013 against 0.027 per served description plus headline) and
**1.7× faster** (p50 4.2 s against 7.4 s). Once the wrong-language behaviour on Polish originals is
fixed in the prompt (§6.1), Haiku is a credible default, and the remaining trade-off (better Polish,
weaker buyer fit and headlines, more small invented details) becomes a product call, not a
correctness call.

---

## 1. Decision rule (unchanged from the first study, fixed before the run)

Recommend Haiku 5.5 as the default only if all three hold. Otherwise recommend Sonnet 5.5.

1. **Faithfulness gate:** Haiku 5.5 has no more hallucinations or claim-check refusals than Sonnet
   5.5.
2. **Polish fluency:** Haiku is not significantly worse on Polish fluency.
3. **Overall preference:** blind overall preference is not significantly worse for Haiku (sign test
   p ≥ 0.05 against it, or Haiku wins).

As in the first study, condition 1 is read on four counts: claim-check refusals, contradictions in
the blind audit, bodies in the wrong language, and invented property facts. External area or market
claims are reported next to them (§3.4).

## 2. Method

**Generator.** Both models went through the real `generateDescription()`
(`apps/control-plane/src/lib/description-generator.ts`) at `9560950a`. That covers the system
prompt, the curated `copy_template` for the page locale, the verdict parser, the contract,
truncation, output-language, meta-commentary and control-tag checks, `checkBodyClaims`, the headline
call and the headline checks. The model was passed as `generation_model`, the standard production
path, so each model used its request profile from `generation-models.ts`:

- Haiku 5.5: `thinking: disabled`.
- Sonnet 5.5: `between_tools` + `effort: low`.

The cache, Postgres, audit and LLM-register writes and the spend counter were stubbed in the test
harness. The two models ran alternately, case by case, one sample per case at the API's default
temperature, as in production. Both got byte-identical events.

**Inputs.** 14 listings, 60 cases per model.

- **Listings.** The first study's 6 listings are reused unchanged. 8 new ones are constructed and
  realistic-shaped. 8 of the 14 have a Polish original: the agency text is in Polish.
- **Archetypes.** For each listing, 2 archetypes are drawn from a pool of the quiz results that
  plausibly land on such a listing. The pools mix investment fits with family and relocation fits.
- **Locales.** Each (listing, archetype) pair runs on an EN and a PL page.
- **ES pages.** 4 pairs also run on an ES page: 2 drawn from Polish originals, 2 from English ones.
- **Seed.** The draw uses mulberry32 with seed `13992026`.
- **Result.** 34 of the 60 cases (57 %) have a Polish original. 11 of the 12 quiz results are
  covered; `downsizer` was not drawn.

| Key | Listing                                       | Kind                                       | Original  | Archetypes drawn                        |
| --- | --------------------------------------------- | ------------------------------------------ | --------- | --------------------------------------- |
| fx  | Palm Coast FL house (FOLLOW-819 fixture)      | house, short                               | EN, 31 w  | family_buyer, diaspora_buyer            |
| krk | Krakow Podgorze apartment, let                | apartment, long, rent and lease figures    | EN, 216 w | first_time_buyer, yield_hunter          |
| waw | Warsaw Mokotow apartment                      | apartment, medium                          | PL, 88 w  | lifestyle_expat, student_parent         |
| alb | Albufeira studio                              | apartment, sparse                          | EN, 15 w  | yield_hunter, second_home_buyer         |
| gda | Straszyn house near Gdansk, needs work        | house, medium, renovation                  | PL, 76 w  | diaspora_buyer, flip_investor           |
| jav | Javea villa with tourist licence              | house, long, rental licence                | EN, 140 w | second_home_buyer, vacation_rental_inv. |
| poz | Poznan Jezyce studio, let to a student        | apartment, short, rent figure              | PL, 59 w  | yield_hunter, student_parent            |
| wro | Wroclaw Jagodno new-build 4-room with garden  | apartment, long, family size               | PL, 105 w | diaspora_buyer, family_buyer            |
| zak | Zakopane apartment run by a short-let manager | apartment, medium, occupancy and income    | PL, 85 w  | vacation_rental_inv., second_home_buyer |
| sop | Sopot 1905 tenement flat near the beach       | apartment, medium, period building         | PL, 79 w  | lifestyle_expat, retiree_relocator      |
| lok | Lodz Piotrkowska retail unit let to a cafe    | commercial, lease income                   | PL, 65 w  | commercial_investor, yield_hunter       |
| kat | Katowice flat for full renovation             | apartment, sparse                          | PL, 19 w  | flip_investor, first_time_buyer         |
| lis | Lisbon Campo de Ourique apartment             | apartment, medium, city lifestyle          | EN, 92 w  | lifestyle_expat, diaspora_buyer         |
| tor | Torrevieja ground-floor bungalow              | house, short, single level, community pool | EN, 49 w  | retiree_relocator, second_home_buyer    |

ES pages: `wro.diaspora_buyer`, `gda.flip_investor`, `tor.second_home_buyer`, `lis.diaspora_buyer`.

**Measures.** The same as the first study, with headlines added to the judge.

1. **Generator outcomes.**
   - Verdict (FIT, NEUTRAL, REFUSED, FAILED) with its reason code, and whether the headline was
     served or refused (with its code).
   - Stop reason and content blocks (thinking or text) of every call.
   - Tokens, latency (wall time of the description call plus the headline call) and cost
     (`llm-pricing.ts` `computeCost`).
2. **Deterministic checks.**
   - Numbers absent from the listing, with thousands groups normalised.
   - Capitalised names absent from the listing.
   - Function-word language vote for the body and the headline.
   - Length against the original.
   - `steersByFamilialStatus`.
   - Every refusal diagnosed to the phrase that triggered it.
3. **Blind pairwise judge.** `claude-opus-5-5`, every pair twice with the A/B order swapped, no
   model name, verdict or case id shown. It scored four criteria 1–5 (faithfulness, fluency in the
   target language, archetype fit, persuasiveness without hype) and gave an overall preference.
   **New:** when both models had a headline (both FIT), the judge also scored and preferred the
   headlines.
   - A preference counts only when both orders name the same model; otherwise the pair is a tie.
   - The sign test is two-sided over the pairs that are not tied.
   - The judge saw every case where both models wrote a body: 59 of 60. In the 60th, Sonnet returned
     no text.
4. **Blind single-text error audit.** `claude-opus-5-5`, each of the 119 texts (headline + body)
   alone, in shuffled order, with the first study's strict definitions:
   - **contradiction:** the text contradicts the listing, including a mistranslation that changes
     the meaning;
   - **invented property fact:** a specific fact about the property that the listing does not state;
   - **external claim:** a fact about the area, market, law or demand from outside the listing.

   It also quoted language errors on PL and ES pages and flagged wrong-language texts.

## 3. Results

### 3.1 Generator outcomes (60 cases per model)

| Model      | FIT (body served) | REFUSED                                                                          | FAILED                                                     | headline served on FIT                                        |
| ---------- | ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Haiku 5.5  | **42**            | 12 (9 `unsupported_guarantee`, 2 `hallucinated_number`, 1 `unsupported_amenity`) | 6 `wrong_language`                                         | 40/42 (2 `hallucinated_proper_name`)                          |
| Sonnet 5.5 | **45**            | 13 (11 `unsupported_guarantee`, 2 `hallucinated_number`)                         | 2 (`empty`, `residual_tag`; both `max_tokens` in thinking) | 40/45 (4 `hallucinated_proper_name`, 1 `unsupported_amenity`) |

No NEUTRAL verdicts. **Fully served (body and headline): 40/60 for each model.** Discordant served
bodies: Haiku only 8, Sonnet only 11, p = 0.65. Discordant refusals: 6 against 7, p = 1.

| Served bodies (headline served) | EN page        | PL page        | ES page | English original | Polish original |
| ------------------------------- | -------------- | -------------- | ------- | ---------------- | --------------- |
| Haiku 5.5                       | 17/28 (15)     | **22/28 (22)** | 3/4 (3) | 18/26 (18)       | 24/34 (22)      |
| Sonnet 5.5                      | **21/28 (19)** | 21/28 (18)     | 3/4 (3) | 18/26 (17)       | 27/34 (23)      |

**Diagnosis of every refusal** (lesson from FOLLOW-1380: a refusal count enters a decision rule only
after each refusal is diagnosed):

- **"Turnkey" family, 16 of the 25 refusals (Haiku 7, Sonnet 9).** The texts say "turnkey", "pod
  klucz" or "llave en mano" for a listing that says "furnished". The `second_home_buyer` and
  `vacation_rental_investor` `copy_template`s contain exactly these words (and "lock-up-and-leave"),
  and the claim check refuses them by design. They are true positives of the check, induced by the
  template. FOLLOW-1385 named only the vacation-rental template; the second-home template has the
  same conflict in en/pl/es.
- **Negation false positives, 3 (Haiku 1, Sonnet 2).** "It is not turnkey", "it is not move-in
  ready", "nie jest gotowe do wprowadzenia": a correct statement refused because `NO_WORK_CLAIM_RE`
  has no negation guard.
- **Decade false positive, 4 (2 each).** "kamienica z lat 30." for "a 1930s building" is refused as
  `hallucinated_number` (30 is not in the grounding).
- **Borderline, 1 (Haiku).** "bez ryzyka pustostanu na starcie" ("no vacancy risk at the start") for
  a flat that is already let. The listing supports the fact, but the phrase matches `GUARANTEE_RE`.
- **Amenity, 1 (Haiku, `fx.diaspora_buyer.pl`).** Not diagnosed to the token.

So the refusal counts are level because both models mostly trip on the same template word, not
because both are equally faithful. No refusal in this run comes from the thousands-separator or
English-only amenity bugs of the first study.

**FAILED.**

- Haiku's 6 `wrong_language` bodies are all on **EN pages built from a Polish original** (waw, poz
  ×2, wro, zak, lok). Haiku wrote fluent Polish there; the FOLLOW-1384 check caught every one, so
  none was served. Sonnet wrote English in all 16 such cases.
- Sonnet's 2 failures are a different defect. On 5 of 60 description calls Sonnet 5.5 thought even
  at `effort: low`. Twice the thinking took the whole 2,720-token budget
  (`stop_reason: max_tokens`). One reply had no text (`empty`). The other ended in a truncated
  `<verified_facts_used>` block (`residual_tag`).

**Headlines.** All 6 headline refusals are `hallucinated_proper_name` on Polish place names or
English text around them ("Dolny Sopot", "Jagodnie we Wrocławiu", "Piotrkowska, Łódź", "Katowicach
Załężu"). They were not diagnosed to the token; they look like the inflected-place-name class that
FOLLOW-1395 narrowed and FOLLOW-1396 tracks. Every served headline is in the page's language (manual
check of the 9 the crude vote flagged: all English headlines starting with a Polish place name).

### 3.2 Cost, latency, tokens

| Model      | mean cost / case | per served description + headline | desc tokens in / out | desc call p50 / p95 | wall p50 / p95 (desc + headline) |
| ---------- | ---------------- | --------------------------------- | -------------------- | ------------------- | -------------------------------- |
| Haiku 5.5  | USD 0.00124      | USD 0.00128                       | 8,084 / 652          | 3.4 s / 6.0 s       | 4.2 s / 7.0 s                    |
| Sonnet 5.5 | USD 0.02678      | USD 0.02706                       | 8,084 / 839          | 5.8 s / 18.5 s      | 7.4 s / 18.7 s                   |

The ratio is **21.1×** per served description: USD 1.28 against 27.06 per 1,000. Sonnet's p95 is
long because of the thinking calls. Haiku never thought; every Haiku stop reason was `end_turn`.

### 3.3 Language, length, numbers, steering

| Check                                                | Haiku 5.5                              | Sonnet 5.5                                                              |
| ---------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Body in the wrong language (all caught, none served) | **6** of 16 EN pages from PL originals | 0 of 16 (p = 0.031)                                                     |
| Served headline in the wrong language                | 0                                      | 0                                                                       |
| Numbers in served text absent from the listing       | 0                                      | 0                                                                       |
| `steersByFamilialStatus` match                       | 0                                      | 4 PL texts (2 served), all `diaspora_buyer` / second-home "dla rodziny" |
| Mean words, long original (krk, 216 w)               | 205                                    | 257 (+25 %)                                                             |
| Median length ratio, sparse original (kat, 19 w)     | 4.8                                    | 7.0                                                                     |

The deterministic number check first flagged "3.4 m", "1.2 km" and "78.4 m²". All three are decimal
commas in the listing ("3,4 m"), an artefact of my cross-check, not of the texts. The steering
matches are Sonnet writing "zabezpieczenie dla rodziny" / "sprawdzi się dla rodziny" for the
diaspora profile, whose playbook description names "family context". The description path does not
run `steersByFamilialStatus` (only the `/api/adapt` gateway does), so two such texts were served.

### 3.4 Blind single-text error audit (`claude-opus-5-5`, 119 texts)

| Model      | scope   | texts | with an error | contradictions (texts) | invented property facts (texts) | external claims (texts) | PL/ES language-error quotes |
| ---------- | ------- | ----- | ------------- | ---------------------- | ------------------------------- | ----------------------- | --------------------------- |
| Haiku 5.5  | all     | 60    | 45            | 20 (13)                | **41 (30)**                     | 21 (17)                 | 60                          |
| Haiku 5.5  | EN page | 28    | 20            | 8                      | 16                              | 10                      | –                           |
| Haiku 5.5  | PL page | 28    | 21            | 8                      | 20                              | 8                       | 52                          |
| Haiku 5.5  | served  | 42    | 30            | 18 (12)                | 25 (20)                         | 16                      | 49                          |
| Sonnet 5.5 | all     | 59    | 44            | 24 (15)                | 26 (19)                         | **42 (30)**             | 83                          |
| Sonnet 5.5 | EN page | 27    | 20            | 4                      | 12                              | 18                      | –                           |
| Sonnet 5.5 | PL page | 28    | 20            | 17                     | 12                              | 21                      | 75                          |
| Sonnet 5.5 | served  | 45    | 35            | 20 (12)                | 13 (12)                         | 38                      | 61                          |

Paired by case, texts with the error, only one model erring (sign test):

- contradictions: Haiku only 5, Sonnet only 7, p = 0.77;
- invented property facts: Haiku only 21, Sonnet only 10, p = 0.071;
- external claims: Haiku only 6, Sonnet only 19, **p = 0.015**.

**What the errors are.**

- **Contradictions are mostly the Polish room-count convention, for both models** (FOLLOW-1386, not
  fixed yet). "Dwupokojowe" is written for a two-bedroom flat, and "two-bedroom" for "dwupokojowe";
  together these make 14 of Haiku's 20 and 11 of Sonnet's 24 contradictions. The Spanish "cuatro
  habitaciones" for "czteropokojowe" has the same root.
- **Other Sonnet contradictions** come from the listing's facts: a let flat sold "for your child to
  study in now", "strzeżony" (guarded) for gated, "saunas" for one sauna, "dom" for an apartment,
  and "the listing gives no rent" when it does.
- **Haiku's invented facts** are small, specific additions: "zadbane ogrody", "privacy", "fully
  equipped" for "furnished", "solid construction", a lanai "at the back".
- **Sonnet's external claims** are mostly template-led framing presented as fact: "a verified income
  stream", "a documented operating result, not a forecast", "value-add levers", "operational from
  week one".

### 3.5 Blind pairwise judge (`claude-opus-5-5`, 59 pairs × 2 orders)

W/T/L is counted from Haiku's side. p is the two-sided sign test over the pairs that are not tied.
Mean scores are 1–5 over both orders.

**All written pairs (n = 59)**

| Criterion       | Haiku wins | ties | Sonnet wins | p          | agreed | mean H | mean S |
| --------------- | ---------- | ---- | ----------- | ---------- | ------ | ------ | ------ |
| faithfulness    | 22         | 23   | 14          | 0.24       | 43/59  | 3.87   | 3.64   |
| fluency         | 24         | 23   | 12          | 0.065      | 45/59  | 3.74   | 3.63   |
| archetype_fit   | 6          | 25   | **28**      | **0.0002** | 42/59  | 3.41   | 3.94   |
| persuasiveness  | 19         | 21   | 19          | 1.00       | 40/59  | 3.34   | 3.33   |
| **overall**     | **24**     | 5    | **30**      | 0.50       | 54/59  | –      | –      |
| headline (n=34) | 2          | 18   | **14**      | **0.004**  | 24/34  | 3.85   | 4.18   |

**Served pairs only, both FIT (n = 34):** faithfulness 10–13–11 (p = 1), fluency 13–16–5 (p =
0.096), archetype fit 3–18–13 (**p = 0.021**), persuasiveness 12–14–8 (p = 0.50), **overall 16–2–16
(p = 1)**, headline 2–18–14 (**p = 0.004**).

**By page locale and by original language** (H–T–S, p)

| Split                         | n   | faithfulness   | fluency           | archetype_fit      | overall       | headline         |
| ----------------------------- | --- | -------------- | ----------------- | ------------------ | ------------- | ---------------- |
| EN page                       | 27  | 10–9–8, 0.82   | 7–13–7, 1.00      | 2–8–17, **0.001**  | 8–3–16, 0.15  | 0–4–9, **0.004** |
| PL page                       | 28  | 12–12–4, 0.077 | **15–9–4, 0.019** | 3–15–10, 0.092     | 15–1–12, 0.70 | 2–12–4, 0.69     |
| ES page                       | 4   | 0–2–2, 0.50    | 2–1–1, 1.00       | 1–2–1, 1.00        | 1–1–2, 1.00   | 0–2–1, 1.00      |
| Polish original               | 33  | 15–12–6, 0.078 | 14–10–9, 0.41     | 3–16–14, **0.013** | 15–3–15, 1.00 | 1–12–6, 0.13     |
| English original              | 26  | 7–11–8, 1.00   | 10–13–3, 0.092    | 3–9–14, **0.013**  | 9–2–15, 0.31  | 1–6–8, **0.039** |
| Polish original on a PL page  | 16  | 8–6–2, 0.11    | **10–4–2, 0.039** | 2–12–2, 1.00       | 11–1–4, 0.12  | 1–9–2, 1.00      |
| English original on a PL page | 12  | 4–6–2, 0.69    | 5–5–2, 0.45       | 1–3–8, **0.039**   | 4–0–8, 0.39   | 1–3–2, 1.00      |

PL-page mean fluency: Haiku 3.84, Sonnet 3.23. The audit quoted 52 Polish language errors in Haiku's
PL texts and 75 in Sonnet's. On the "Polish original" split, Haiku's fluency lead disappears
(14–10–9) because it includes Haiku's 6 Polish bodies on EN pages, which the judge scored 1 for
fluency.

Position bias: the overall pick was Text A 60 times and Text B 58 times. Both orders agreed on the
overall winner in 54 of 59 pairs.

## 4. Verdict against the rule

| Condition                          | Result                                                                                                                                                                                                              | Met?   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1. No more hallucinations/refusals | Refusals 12 vs 13 ✓. Contradictions 20 vs 24 ✓. **Wrong-language bodies 6 vs 0 (p = 0.031) ✗. Invented property facts 41 vs 26 (30 vs 19 texts, p = 0.071) ✗.** External claims 21 vs 42 (Sonnet worse, p = 0.015). | **No** |
| 2. PL fluency not worse            | Haiku significantly better on PL pages: 15–9–4, p = 0.019; mean 3.84 vs 3.23; 52 vs 75 error quotes                                                                                                                 | Yes    |
| 3. Overall not significantly worse | 24–5–30, p = 0.50 (served only 16–2–16, p = 1)                                                                                                                                                                      | Yes    |

**Recommendation: keep Sonnet 5.5 as the default generation model.** Condition 1 fails on two of its
four counts, and one of them is significant: Haiku switches to Polish on English pages built from
Polish originals. These bodies are no longer served, but each one leaves the buyer with the agency's
original copy. Haiku also adds more small invented property details. Sonnet's own weakness on the
same gate is the opposite kind: more external, template-led claims ("verified income", "operational
from week one"). The rule as stated does not count those against Sonnet, as in the first study.

The rest of the evidence does not favour either model overall:

- **Served rate:** bodies 42 vs 45; body and headline 40 vs 40.
- **Overall preference:** a tie.
- **Haiku is better** on Polish fluency, cost (21×) and latency (1.7×).
- **Sonnet is better** on buyer fit and headlines, and it never left the page language.

**Comparison with the first study (n = 24 → 60).**

| Measure                           | FOLLOW-1380 (H vs S)         | FOLLOW-1399 (H vs S)                          |
| --------------------------------- | ---------------------------- | --------------------------------------------- |
| Bodies served                     | 14/24 vs 17/24               | 42/60 vs 45/60                                |
| Claim-check refusals              | 10 vs 7 (16 false positives) | 12 vs 13 (16 template-led, 7 false positives) |
| Wrong-language bodies             | 2 vs 0 (1 served)            | 6 vs 0 (none served, FOLLOW-1384)             |
| Contradictions (audit)            | 8 vs 4                       | 20 vs 24                                      |
| Overall preference                | 13–1–10, p = 0.68            | 24–5–30, p = 0.50                             |
| PL fluency                        | 7–2–3, p = 0.34              | 15–9–4, **p = 0.019**                         |
| Archetype fit                     | 4–13–7, p = 0.55             | 6–25–28, **p = 0.0002**                       |
| Headlines                         | not judged                   | 2–18–14, **p = 0.004**                        |
| Cost ratio per served description | 20.5×                        | 21.1×                                         |

The larger sample turned two of the first study's hints into significant results: Haiku's better
Polish and Sonnet's better buyer fit. It also confirmed that Haiku's language slip on Polish
originals is real. The number-format refusal gap is gone.

**Per-language split** (Haiku for PL pages, Sonnet for EN): the data now lean towards it. On PL
pages Haiku is more fluent (p = 0.019), at least as faithful (12–12–4) and tied overall (15–1–12),
and it was served more often (22 vs 21). Its wrong-language failures happen only on EN pages. The
split would need code (one global model today) and would give up Sonnet's better PL headlines only
partly (2–12–4 on PL pages, not significant). It is a product decision for the CEO, not part of the
pre-stated rule.

## 5. Cost of this study

| Item                                                           | Calls | USD      |
| -------------------------------------------------------------- | ----- | -------- |
| Generation, Haiku 5.5 (60 descriptions + 42 headlines)         | 102   | 0.07     |
| Generation, Sonnet 5.5 (60 descriptions + 45 headlines)        | 105   | 1.61     |
| Smoke run (generation, 1 case × 2 models)                      | 4     | 0.03     |
| Pairwise judge, Opus 5.5 (59 pairs × 2 orders, pilot included) | 118   | 2.40     |
| Error audit, Opus 5.5 (119 texts, pilot included)              | 119   | 1.85     |
| **Total**                                                      |       | **5.97** |

The budget was USD 6. Prices come from `llm-pricing.ts`, at list price with no caching. Opus 5.5 ran
at `effort: low`, and its thinking tokens are included.

## 6. Findings that do not depend on the model (proposed FOLLOWs; not fixed here)

1. **Haiku 5.5 composes in the source language on cross-language pages.** 6 of 16 EN pages from a
   Polish original came back in Polish. FOLLOW-1384 stops them from being served. A stronger
   language instruction in the description prompt, as FOLLOW-1382 did for the headline, would likely
   recover these cases. Re-measure Haiku after it.
2. **`copy_template` lexicon against the claim check, wider than FOLLOW-1385.** `second_home_buyer`
   (en/pl/es: "turnkey", "pod klucz", "llave en mano", "lock-up-and-leave") and
   `vacation_rental_investor` caused 16 of the 25 refusals for both models. Either drop the words
   from the templates or ground them only on a listing that says it.
3. **Negation guard on `NO_WORK_CLAIM_RE`.** "It is not move-in ready" and "nie jest gotowe do
   wprowadzenia" are refused as unsupported guarantees (3 refusals).
4. **Decades.** "z lat 30." / "1930s" refused as `hallucinated_number` (4 refusals).
5. **Sonnet 5.5 can still think at `effort: low`.** In 5 of 60 calls it thought, and in 2 the
   thinking exhausted the 2,720-token cap: no text, or a truncated audit block. The thinking reserve
   or `thinking` setting for Sonnet 5.5 needs a look (FOLLOW-1377 measured 0 thinking on 4 calls).
6. **The description path does not run the familial-steering linter.** Sonnet wrote "dla rodziny"
   for the diaspora profile 4 times, and 2 of these texts were served. The `/api/adapt` gateway
   would have refused them.
7. **Polish room-count convention** (FOLLOW-1386) remains the largest source of contradictions for
   both models: 14 of 20 for Haiku and 11 of 24 for Sonnet.

## 7. Limitations

- **Moderate sample.** 60 cases, one sample each. Condition 1's invented-fact count (p = 0.071) is
  not significant. The wrong-language result rests on 16 cases.
- **One judge model from the same family.** Position bias was controlled and not visible (60/58).
  Family self-preference cannot be ruled out. No human rated the texts; the CEO blind sample
  (`MODEL-COMPARE-RERUN-BLIND-SAMPLE-2026-10-26.md`, 8 pairs drawn with seed 1399 among cases where
  both models were fully served) is the human check.
- **The judge did not see the `copy_template`**, as in the first study. Sonnet follows the template
  more literally. This is probably why it wins on archetype fit and also why it makes more
  "external" claims. Template adherence was not scored.
- **Constructed listings.** 13 of the 14 listings were written for these studies. They are
  realistic-shaped, not production data. If production always sends a Polish original to Polish
  pages and an English one to English pages, the cross-language cases, where Haiku's language slip
  sits, would be rarer.
- **The audit was not checked by hand.** I read every refusal and every contradiction the audit
  listed, and I agree with them. "Strzeżony" and "cena wywoławcza" are borderline calls. I sampled
  the invented-fact and external-claim lists; I did not check them item by item.
- **Headline refusals were not diagnosed to the token** (6 in all).
- **Latency.** One machine, sequential calls to the public API. Use it to compare the models, not as
  an SLA.
- **Coverage.** 11 of 12 quiz results were covered (`downsizer` not drawn), and only 4 ES cases.

The raw JSONL (generations, judgments, audit) and the scripts stay in the session scratch area and
are not committed: `gen.live.test.ts` (run from `apps/control-plane`, removed after the run),
`cases.ts`, `judge.mjs`, `audit.mjs`, `analyze.mjs` and `blind.mjs`.

NEXT: PM files FOLLOWs for §6 items 1–6 (item 7 is FOLLOW-1386). After §6.1, re-test Haiku 5.5 on
the 16 EN-page cases from Polish originals before the CEO rules on a per-language split.
