# Research basis for a ≥ 90 % buyer-archetype quiz (compiled 2026-10-19)

**Status:** evidence record for `docs/PLAN-QUIZ-ACCURACY-2026-10-19.md` (Faza Q, FOLLOW-1355).
Compiled by a read-only research agent (Opus) on 2026-10-19 from WebSearch/WebFetch; nothing here is
a decision. The plan's choices that rest on this record: purpose-first branching tree (≤ 3
questions + trait screen), facts not attitudes, mandatory "not sure" exit and final confirmation, a
soft prior instead of a 0.85 pin (Cromwell), Wilson intervals with n = 400 for the headline claim
and ~100 per class, expert-labelled agreement (κ) as the check on self-confirmation. Tags: **[E]**
empirical, **[V]** vendor/practitioner data with method not disclosed, **[T]** theory or method
paper, **[GK]** general knowledge the agent could not source in-session. Links were live on
2026-10-19; several full texts were paywalled (flagged inline).

Method: WebSearch and WebFetch only, nothing written to the repo. Tags: **[E]** empirical, **[V]**
vendor or practitioner data with method not disclosed, **[T]** theory or method paper, **[GK]**
general knowledge I could not source in this session.

Two caveats up front:

- Several full texts were paywalled or returned 403. I flag where a figure comes from a secondary
  summary.
- The search tool returned few primary housing papers. Area 1 is the thinnest.

---

## 1. Real-estate buyer segmentation

1. **NAR, Profile of Home Buyers and Sellers 2025** (sales July 2024 to June 2025) [E, annual
   survey]
   - https://www.nar.realtor/press-releases/first-time-home-buyer-share-falls-…
   - First-time buyers are a record-low 21% share, with median age 40. Repeat buyers have median
     age 62. All-cash buyers are 26%. Median down payment is 19% (10% for first-time, 23% for
     repeat).
   - The survey covers owner-occupants only. Investor and vacation purchases are excluded.
   - The segment-defining variables it uses are prior ownership, age, household composition, down
     payment source and tenure.
2. **NAR Vacation and Investment Home Buyers Survey, last edition I could source: 2016 purchases,
   published 2017** [E]
   - https://www.mortgagenewsdaily.com/news/04112017-vacation-investor-sales
   - Investors: 42% bought for rental income, 16% for appreciation.
   - Vacation buyers: 42% for a family retreat or vacation use, 18% for retirement.
   - I did not find a 2024 or 2025 NAR edition. The 2015 edition is at
     https://assets.documentcloud.org/documents/1699245/2015-nar-vacation-amp-investment-h….pdf.
3. **RCLCO, 2025 Vacation/Investment Home Survey** (published 2025-09-25, n&gt;1,000 US adults with
   net worth above $1M) [E, industry research firm]
   - https://www.rclco.com/publication/2025-vacation-investment-home-survey/
   - 42% say investment income is a major reason (33% in 2023). Among those with net worth above
     $10M the figure is 73%.
   - Younger buyers (44 and under) treat rental participation as more essential.
   - This shows "vacation buyer" and "yield hunter" overlap heavily in the affluent segment, so
     purpose must be asked as a primary versus secondary motive.
4. **NAR, International Transactions 2025** (April 2024 to March 2025) [E]
   - https://www.nar.realtor/newsroom/international-buyers-purchased-56-…
   - Foreign buyers bought $56B of US homes. 56% of purchases were by foreign-born buyers already
     living in the US (visa holders and recent immigrants). 44% were by buyers living abroad.
   - 47% paid cash, against 28% of all buyers.
   - Residence (in-country or abroad) and financing are strong discriminators for the cross-border
     and diaspora archetype.
5. **Zillow Consumer Housing Trends Report 2024** (secondary coverage only, original not fetched)
   [E, vendor survey]
   - https://realestatenews.com/2024/10/09/how-buyers-have-and-havent-changed…
   - First-time buyers are 44%, down from 50% in 2023. Affordability and job relocation are top
     motivators. I could not confirm Zillow publishes formal segment definitions.
6. **Homebuyer typology papers (cluster-based, regional)** [E, small and regional]
   - Borth and Summers, Housing Policy Debate 28(3), 2018:
     https://ideas.repec.org/a/taf/houspd/v28y2018i3p428-442.html. Q-method finds three Edmonton
     homebuyer segments defined by shared opinions about location, not by demographics.
   - Głuszak and Marona, J. Int. Studies 2011, https://jois.eu/files/GluszakV4N1.pdf.
     Preference-based segments differ from sociodemographic segments.
   - Finnish study (J. Consumer Affairs): four housing-preference clusters via PCA then hierarchical
     clustering.
   - Lesson from all three: attitudes and preferences segment buyers better than demographics.
7. **Downsizers**
   - Push-pull framework (68 downsizers, PMC):
     https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7742564/. Push-driven moves are linked to less
     control and lower satisfaction.
   - Burgess and Quinio (Housing Studies, 2020, via
     https://www.housinglin.org.uk/finder.cfm?i=21087). Only a minority of older households
     downsize, and the group is heterogeneous. Moves are tied to life events (health, retirement,
     widowhood).
8. **Investor versus owner-occupier discriminators** [E]
   - https://link.springer.com/article/10.1007/s11146-020-09766-5. Professional versus individual
     investors differ in bargaining power and in the quality of homes they buy.
   - Massachusetts study (MIT DSpace): https://dspace.mit.edu/handle/1721.1/77155. Many investors
     are misclassified as owner-occupiers in mortgage data (HMDA).
   - Stated occupancy is unreliable even in administrative data, which affects ground-truth design.

**Which questions discriminate best.** No source ranks questions head-to-head, so this is my
synthesis [GK]:

- Primary purpose (live, invest, vacation, flip) is the top split, and the sources above support it.
- Next: prior ownership or tenure, time horizon, financing (cash versus mortgage), household
  composition, and current residence or mobility (relocating or abroad).
- Renovation appetite separates flippers from yield hunters.

**Implication for our quiz.** Make purpose the first branching question. The NAR data show investor
and vacation buyers are purpose-defined, and RCLCO shows their motives overlap. Ask "primary" and
"secondary" purpose, not one tick-box. The archetypes that differ by life stage (downsizer, family,
first-time) are separated by household and prior-ownership questions. Do not rely on demographics
alone.

---

## 2. Questionnaire design for classification

1. **Domingos and Pazzani 1997, Machine Learning 29** [T, plus experiments]
   - https://home.engineering.iastate.edu/julied/classes/ee547/Handouts/domingos97optimality.pdf
   - Naive Bayes can be optimal for classification (zero-one loss) even when its independence
     assumption is badly violated. Its probability estimates are poor in that case.
   - So a simple scoring model can hit high accuracy, but the confidence it reports should not be
     trusted without calibration.
2. **Tree-based adaptive tests versus IRT-based CAT** [E]
   - https://pmc.ncbi.nlm.nih.gov/articles/PMC7495791 (title not verified). On 3,975 subjects,
     tree-based adaptive tests classified better than IRT scoring and cut the instrument from 173
     items to 3 to 6 per person.
   - Cardiac rehab study: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7055848/. On 2,837 patients,
     a classification tree cut questionnaire length by 72% (CAT by 36%) with sensitivity 0.78 and
     specificity 0.88.
   - Clinical samples, not real estate. They show branching trees are efficient for category
     assignment.
3. **Computerized classification testing (SPRT-based CAT)** [T]
   - https://en.wikipedia.org/wiki/Computerized_classification_test (secondary), and the Cito 2009
     report at https://cito.nl/media/cf3jcirb/2009-computerized-classification-t….pdf.
   - Stop asking as soon as the posterior or likelihood ratio crosses a threshold. This is the
     formal version of "ask until confident, then stop".
   - SPRT does not bound the maximum number of items, so add a max-length cap (a 2009 Cito report
     extends it to more than two categories).
4. **Typing tools in market research** [V, practitioner]
   - https://decisionanalyst.com/blog/segmentationtypingtools/. A typing tool classifies new
     respondents into pre-defined segments using far fewer questions than the original segmentation.
     Decision Analyst says accuracy "can range widely, 40% to 90%".
   - https://www.qresearchsoftware.com/how-to-apply-an-lda-typing-tool-in-q describes picking
     "golden questions" with linear discriminant analysis.
   - Sawtooth compares naive Bayes with stepwise discriminant analysis for typing tools:
     https://events.sawtoothsoftware.com/conference/presentation/naive-bayes-vs-stepswise-discrimin….
   - 90% is at the top of the range the practitioner source quotes for typing tools on statistically
     derived segments. That is a warning to design archetypes as crisp, rule-like categories.
5. **MBTI and 16Personalities reliability** [E, but I only reached secondary summaries]
   - Pittenger (1993, Review of Educational Research 63(4)):
     https://www.psychologytoday.com/us/blog/cutting-edge-leadership/201402/the-truth-about-myers-briggs-types.
     Roughly half of retakers get a different type about five weeks later. Other sources cite a
     range of 35% to 76% across studies.
   - Counter-view:
     https://www.psychologytoday.com/za/blog/my-brothers-keeper/202002/in-defense-the-myers-briggs.
     Capraro and Capraro (2002) report an overall reliability of 0.815, range 0.48 to 0.97.
   - Stein and Swan 2019, Soc. Pers. Psych. Compass 13(2), is another critique (conclusions not
     retrieved).
   - I found nothing specific to 16Personalities.
   - The root cause (my reading) is forcing continuous traits into binary types. Scores near the
     cut-point flip. Archetypes defined by discrete facts (own or rent, cash or mortgage, live or
     rent out) do not have this problem. Those defined by blended attitudes do.
6. **Survey-methods evidence on order, wording and satisficing**
   - Krosnick 1991, Applied Cognitive Psychology, and Krosnick and Presser's Handbook chapter:
     https://benjaminhirt.myblog.arts.ac.uk/files/2024/01/2009_handbook_krosnick-1.pdf.
   - Respondents under cognitive load pick the first reasonable option and acquiesce to
     agree/disagree statements. Response-order effects are documented.
   - Only secondary summaries were retrieved.
7. **Forced choice versus Likert** [V only]
   - https://www.opinionx.co/blog/maxdiff-analysis and https://www.surveymonkey.com/learn/maxdiff/.
     Vendors claim forced-choice and MaxDiff separate priorities that Likert ratings flatten.
   - I found no independent study comparing them for segment discrimination. Treat this as
     plausible, not proven. Louviere's best-worst scaling papers are the place to look and I did not
     retrieve them.

**What this implies for our quiz:**

- Use a short, branching tree: Q1 purpose, then 2 to 4 follow-ups chosen by the answer. It is more
  efficient than a fixed form, per the tree and CAT evidence above.
- Use single-choice questions about facts and intent (forced choice). Do not use agree/disagree
  grids.
- Rotate options where order carries no meaning, and keep wording behavioural ("I plan to rent it
  out") rather than abstract.
- Keep archetypes mutually exclusive, or define a precedence rule for overlaps (for example vacation
  plus rental).
- Include an explicit "not sure / mixed" exit, and a final confirmatory question ("Does this
  describe you?").
- The confirmation question also gives free ground truth (see area 3).
- Add a max-length cap even with early stopping.
- [GK] Written, non-overlapping archetype definitions that the team can apply by hand are a
  precondition for any accuracy measurement. If two humans cannot agree on a label, the quiz cannot
  be 90% right.

---

## 3. Measuring classification accuracy

1. **Wilson interval** [T]
   - Brown, Cai and DasGupta 2001, Statistical Science 16(2):
     https://projecteuclid.org/download/pdf_1/euclid.ss/1009213286.
   - The Wald interval has erratic coverage. Wilson (or Jeffreys) is preferred, and Agresti-Coull
     for larger n.
   - **Computed here** (95% two-sided Wilson, my calculation):

   | Labelled sessions | Observed accuracy | Interval      |
   | ----------------- | ----------------- | ------------- |
   | 150               | 90%               | 84.2 to 93.8% |
   | 300               | 90%               | 86.1 to 92.9% |
   | 500               | 90%               | 87.1 to 92.3% |
   | 1000              | 90%               | 88.0 to 91.7% |
   | 200               | 95%               | 91.0 to 97.3% |
   | 400               | 93%               | 90.1 to 95.1% |
   - "90% ± 5" needs about 140 to 150 sessions (Wald approximation 138). That only shows the
     estimate is near 90%.
   - To **prove** the true accuracy is at least 90% (lower bound ≥ 0.90) you need much more, or a
     quiz that is clearly better than 90%:

   | Observed accuracy | Sessions needed (two-sided 95% LB ≥ 0.90) | Sessions needed (one-sided 95%
   LB ≥ 0.90) | | ----------------- | ----------------------------------… |
   ----------------------------------… | | 97% | 69 | not computed | | 95% | 127 | 86 | | 94% | 204
   | not computed | | 93% | 362 | 248 |
   - Per-class claims are far more expensive. With 30 sessions per class at 90%, the interval is
     roughly 74 to 97% [GK, approximate]. About 100 per class is needed for ±6 points at 90%. Across
     13 archetypes that is about 1,300 sessions. Common archetypes will have enough traffic, rare
     ones will not, so sample stratified by archetype and re-weight to traffic.

2. **Calibration** [E and T]
   - Guo et al., ICML 2017: https://arxiv.org/abs/1706.04599. Reliability diagrams and expected
     calibration error (ECE) compare stated confidence with accuracy in bins. Temperature scaling is
     a cheap fix. The paper warns reliability diagrams hide how many samples sit in each bin.
   - Domingos and Pazzani (area 2) is why a classifier can have high accuracy and uncalibrated
     confidence.
   - For the quiz: bin sessions by the quiz's own confidence (for example &lt;0.6, 0.6 to 0.8, 0.8
     to 0.9, &gt;0.9) and check observed accuracy per bin. Needs a few hundred labelled sessions to
     be informative [GK].
3. **Label noise and ground truth** [T and E]
   - https://arxiv.org/pdf/2106.01254 (Principled Evaluation with Human Labels). With noisy
     evaluation labels, even a perfect classifier cannot score 1.0, and measured accuracy is biased.
   - https://arxiv.org/pdf/1307.0426 (annotator agreement and ground-truth estimation).
   - Kappa can be misleading under skewed labels (see arXiv 2605.25052, which uses Gwet's AC1).
     Agreement between labellers puts a rough ceiling on measurable accuracy.
4. **Ground-truth options.** These are general practice [GK], not sourced:
   - **A. Confirmed identity.** After the result, ask "Is this you?" with an option to pick another
     archetype. Cheap and scalable, but biased: users accept flattering or plausible labels (Barnum
     effect) and it is not independent of the quiz.
   - **B. Delayed behaviour.** Inquiry type (viewing for rent yield versus school catchment), saved
     searches and filters, later form submissions. Independent of the quiz but noisy and sparse, and
     partly circular if the site personalizes after the quiz.
   - **C. Expert-labelled sessions.** Two or more domain experts label a stratified sample blind to
     the quiz output, using the written archetype definitions. Resolve disagreements and report
     inter-rater agreement. This is the cleanest gold standard.
   - **D. Follow-up call or interview** on a small subset, as a check on the gold standard.
   - MIT/Massachusetts study (area 1): stated occupancy is unreliable even in administrative data,
     so do not treat any single self-report as truth.

**What this implies for our quiz.** Use expert-labelled sessions (C) as the primary gold standard,
with confirmed identity (A) and behaviour (B) as secondary agreement checks. Report a confusion
matrix, per-class precision and recall, macro and traffic-weighted accuracy, and a Wilson interval.
State which "90%" you mean before you measure.

---

## 4. Conversion and UX constraints

1. **RevenueHunt, State of Product Recommendation Quizzes 2026** (45M+ responses, 20,000+ stores)
   [V]
   - https://revenuehunt.com/state-of-product-recommendation-quizzes/
   - 69% of starters finish (31% drop off before results). About 5.5% of completers order. No
     breakdown by question count was given.
2. **Bluebarry, Product Quiz Benchmarks** (130k+ live sessions, updated 2026-09-18) [V]
   - https://bluebarry.ai/resources/product-quiz-benchmarks
   - 89% average completion, top stores 94% median. The 90%+ group asks 5 to 8 questions about the
     shopper's situation. Method not disclosed.
3. **Interact help centre** (top quizzes, over 10M takes) [V]
   - https://help.tryinteract.com/en/articles/10752954-how-many-questions-should…
   - About 70% completion and 41% lead opt-in. Ideal is about 13 questions for standard quizzes and
     7 for branching quizzes.
   - Interact's own 2026 report (https://tryinteract.com/blog/quiz-conversion-rate-report/) gives
     59.1% start-to-finish.
4. **Typeform lead-form analysis** [V, correlational, search snippet only; the page returned 403 on
   fetch]
   - https://help.typeform.com/hc/en-us/articles/4406587604116
   - Forms with more than 6 questions had completion below 50%. Forms completed in under a minute
     had about 15 points higher completion. Over 1,000 forms.
5. **Third-party length ranges** [V, unverified]
   - Outgrow (https://outgrow.co/blog/?p=62795): 3 to 7 questions, 65 to 85% completion; 8 to 15, 45
     to 65%; 16 plus, 25 to 45%.
   - Credspark's own analysis found length explained only 2.3% of variance in completion
     (https://support.credspark.com/support/solutions/articles/73000524383-best-quiz-practices).
     Vendors disagree on how much length matters.
6. **Galesic and Bosnjak 2009, Public Opinion Quarterly 73(2)** [E, experiment]
   - Start rates fell with announced length (75%, 65%, 62% for 10, 20, 30 minutes). Later questions
     got faster, shorter, more uniform answers (secondary summary).
   - Data-quality loss through the questionnaire is a second cost besides abandonment.
7. **Mobile**
   - Couper and Mavletova (meta-analysis chapter, https://dx.doi.org/10.5334/bar.f). Breakoff on
     mobile web ran roughly 2.6 to 12 times that on PC in the studies cited.
   - Their 2013 pilot found 12.7% mobile versus 1.1% PC. Small sample, older devices.
   - Only the abstract-level findings were retrieved. SMS invitations beat email for mobile
     participation.

**What this implies for our quiz.** Target 4 to 6 questions on screen per person (branching lets a 7
to 10 question bank deliver that). Assume no vendor figure transfers to real-estate buyers, and
measure your own drop-off per step. Design for mobile first with one tap per question. Put the
easiest, highest-information question (purpose) first. Show progress and allow skip or "not sure".

---

## 5. Bayesian or probabilistic assignment

1. **Cromwell's rule** [T]
   - https://en.wikipedia.org/wiki/Cromwell%27s_rule. A prior of exactly 0 or 1 cannot be changed by
     any evidence: posterior odds equal prior odds times the likelihood ratio, so 0 or 1 stays 0
     or 1.
   - Applied here: a quiz answer entered as probability 1.0 (or any value so high that real evidence
     cannot move it) locks the persona in forever.
2. **Naive Bayes optimality** (Domingos and Pazzani 1997, area 2) [T]. Good for ranking classes even
   when features are correlated, but its posteriors are overconfident when features are correlated.
   Combining many correlated clicks multiplies the same evidence repeatedly.
3. **Naive Bayes plus Markov model for shopper intent** [patent, secondary]
   - https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10373177. Updates the intent
     estimate at each click and notes static models fall short because online behaviour changes
     within a session.
4. **Bayesian profile updating from web logs** (CMU slides)
   - https://www.andrew.cmu.edu/user/alm3/presentations/WebShop%202003.pdf. Starts with an initial
     guess and revises it with each visit. Illustrates the prior-plus-evidence idea. Not
     peer-reviewed.
5. **Persona as classifier** (patent,
   https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9589149 and related) [patent].
   Each persona is a naive Bayes model over page features.
6. **Calibration** (Guo et al., area 3) is what makes the posterior meaningful. Without it, "0.85"
   is a score, not a probability.
7. I did not find a peer-reviewed paper that combines a survey prior with clickstream likelihood for
   property personas. This is **not sourced**. The pieces above are the closest.

**What this implies for our quiz:**

- Treat the quiz result as a soft prior, not a pin. For example set quiz-implied persona mass to 0.6
  to 0.8, spread the rest across other personas, and floor every persona above zero [GK, my numbers
  are illustrative, tune on data].
- Convert each behavioural signal to a likelihood ratio, cap its influence, and down-weight
  correlated signals (saved search plus listing views plus filter use can be one piece of evidence,
  not three).
- Calibrate the final posterior on labelled sessions and recheck as traffic changes.
- A hard-pinned 0.85 is a design error for three reasons:
  - It looks like a probability but is a score.
  - It cannot be overturned by evidence if implemented as a lock.
  - It will be wrong for the 10% or more of users whose quiz answers were casual.
- Keep a path for a user to correct the label (also yields ground truth).

---

## Synthesis: ten design principles

1. Define each archetype in writing with observable criteria, mutually exclusive or with an explicit
   precedence rule. Segment-defining variables are mainly purpose, prior ownership, horizon,
   financing, household and mobility.
2. Branch on purpose first: live, invest, vacation, flip. Primary versus secondary motive handles
   the vacation/yield overlap.
3. Use single-choice questions about facts and plans. Avoid attitude grids and Likert scales.
4. Branching tree, 4 to 6 questions per person, early stop at a posterior threshold with a hard cap.
5. Always offer "not sure / mixed" and a final "is this you?" confirmation.
6. Rotate option order where order carries no meaning. Keep wording behavioural.
7. Design for mobile, one question per screen, easiest question first. Measure your own per-step
   drop-off, since benchmarks are vendor data.
8. Output a probability vector, never a hard pin. Floor every persona above zero, calibrate the
   output, and combine behaviour as capped, de-correlated evidence.
9. Measure on expert-labelled sessions as the primary gold standard, with confirmations and
   behaviour as secondary checks. Report a confusion matrix, per-class recall and precision, and
   Wilson intervals.
10. Treat 90% as a lower-bound claim, not a point estimate, and define it first (overall, macro, or
    per-class floor).

## Recommendation: how to measure ≥ 90%

- **Ground truth.** Two domain experts independently label a stratified sample of sessions, blind to
  the quiz result, using the written definitions. Use the full session record: quiz answers shown to
  the user are excluded, and the expert sees behaviour, inquiry text and any contact-form content.
  Resolve disagreements by discussion or a third rater, and report inter-rater agreement (kappa,
  plus Gwet's AC1 if the labels are skewed).
- **Secondary check.** Compare against the user's confirmation click and against later behaviour
  (inquiry type). Report agreement between all three sources, and treat the gap as the noise in your
  ground truth.
- **Sample size for the headline claim (overall accuracy).** Label at least 400 sessions, stratified
  by archetype and re-weighted to traffic. If observed accuracy is about 95%, the Wilson lower bound
  clears 90% from about 130 sessions (two-sided). If observed accuracy is about 93%, you need
  about 360. A 400-session sample therefore supports the claim for a true accuracy of about 93% or
  better.
- **Sample size for per-class claims.** Aim for 100 labelled sessions per archetype, about 1,300 in
  total. Where an archetype is too rare, say so and report it separately rather than pooling.
- **Pass criterion (suggest agreeing in advance).** The lower bound of the 95% Wilson interval on
  traffic-weighted accuracy is at least 0.90, and no archetype has a point-estimate recall below
  about 0.80. State the exact thresholds before looking at data.
- **Calibration.** Report ECE and a reliability diagram using the same labelled set. Check that
  sessions where the quiz says it is above 0.9 confident are in fact about 90% or more correct. If
  not, recalibrate before using confidence to route users.
- **Monitoring.** Re-sample 100 sessions a month, plot the Wilson interval over time, and re-run
  after any change to questions, options or archetype definitions.

**Could not source, stated as general knowledge:** the ranking of which questions discriminate best,
the per-class sample sizes (approximate arithmetic), the ground-truth options, the soft-prior
numbers, and the advice on correlated evidence. No peer-reviewed real-estate persona quiz accuracy
study was found, and no independent forced-choice versus Likert segment-discrimination study.
11215136187772
