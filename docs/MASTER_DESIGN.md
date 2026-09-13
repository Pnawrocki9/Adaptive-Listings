# Estalara Adaptive Listings — Dogłębna analiza architektoniczno-biznesowa

**Wersja:** 4.12 (2026-09-13 — the localhost-first stage and the FOLLOW-820 go/no-go gate enter the SoT (§P.0 = definition, §Snapshot.0 + §Snapshot.1 row P.0 = status); the §Snapshot.5 "no end-to-end test" line is replaced by the measured state, cited by recorded `source` rather than by tally; CEO rulings #2–#5 of 2026-09-13 on measurement design recorded in §E.3.4 and §D.6, each with its owning stub [FOLLOW-1148, absorbing FOLLOW-1129 + FOLLOW-1197; CEO decision #1, `docs/AUDIT-2026-09-13.md` §8]. Poprzednio: 4.11 (2026-08-27) — §E.7.0 dodane: reguła gruntowania osi dyrektyw, ratyfikowana przez CEO jako ESC-076 [ESC-076].)

**Changelog v4.12 (13 September 2026 — the localhost-first stage and the FOLLOW-820 gate in the
SoT; §Snapshot.5 corrected; CEO rulings #2–#5 recorded [FOLLOW-1148 + FOLLOW-1129 + FOLLOW-1197;
source: `docs/AUDIT-2026-09-13.md` remark 13 D-1 / D-14 / D-15 and §8, RETRO-325 §4a LG-5]):**
Docs-only. No runtime code changes, and no ruling is made here: every decision below was ruled by the
CEO on 2026-09-13 and is transcribed with its owner. **Why:** the audit found the gate that orders all
work absent from the document every session boots from (D-14: only two incidental changelog
mentions of FOLLOW-819/820), §Snapshot.5 still calling the FOLLOW-819 harness a "critical gap"
(D-1), and FOLLOW-820's stub still calling condition 1 "not gradeable" after FOLLOW-1124 landed in
#850 (D-15). The CEO ruled (decision #1) that the gate belongs in the SoT rather than §Y declaring it
external. **RETRO-325 changed what "measured state" may say:** #894 (FOLLOW-1186, `9f19cb55`)
retired the AC(1) predicate that graded every recorded green, so the replacement text cites runs by
their recorded `source` and never by "6/6". **What changed, per section:** (1) **§P.0 (new)** defines
the stage, the critical path, and FOLLOW-820's four conditions, including how condition 1 is graded
(`results[AC(1)].evidence.outcomes.adapted`; AC(7) not gradeable alone until FOLLOW-1196). P.1–P.5
are marked as the historical 12-week plan. (2) **§Snapshot.0 (new, directly above §Snapshot.1)**
states per-condition status with file/PR citations. (3) **§Snapshot.1 gains row P.0.** No other row
was re-graded. Rows E.1–E.3 and H describe code that rulings #2 and #4 will change, but that code
has not changed, so their verdicts stand. The E.7 and H re-grade the audit asks for (D-5) stays with
FOLLOW-825. (4) **§Snapshot.5:** the critical-gap bullet is struck and replaced by the measured
state, and the coverage bullet gains a dated caveat (audit T-2, re-checked: nothing passes
`--coverage`). The other §Snapshot.5 bullets are not re-verified (FOLLOW-825). (5) **§E.3.4 (new)**
records rulings #2 (tamper-evident lift before the next harness run → FOLLOW-1201 + ESC-079), #3
(`reorder` fail-closed on missing embeddings, text directives fail-open → FOLLOW-1202), #4
(server-confirmed `inquiry.completed` or `live.signup` as the pilot conversion, `cta.clicked` a funnel
stage; supersedes CEO Decision D-4's wording → FOLLOW-1203) and #5 (tab-session unit, xid still
minted, dilution measured → FOLLOW-1204). Each states the HEAD behaviour with a file:line, so no
target is written as if it were built. (6) **§D.6** gains the unit-of-count paragraph (ruling #5). **Rule
H / architect guardrail:** each behavioural statement added here has either an implementing ticket
dated 2026-09-13 (FOLLOW-1201…1204, `backlog/FOLLOW_UPS.md`) or is a process gate owned by FOLLOW-820.
**Companion edits in the same PR:** FOLLOW-820 condition 1 rewritten; README
`tests/e2e/follow-819/README.md` §0 / §1 row (1) / §4.1 / §5.3 / §5.5 / §5.6 corrected or annotated;
`backlog/QUEUE.md` CORRECTION and grading-caveat lines (START HERE banner untouched);
`docs/AUDIT-2026-09-13.md` rows 1b/1c and remark 13 annotated. **§Y.2 propagation:** 1 `CLAUDE.md`
— no section renamed, so no required edit. Its "Localhost-first until FOLLOW-820 GO" section now
has a SoT counterpart in §P.0, and a pointer to §Snapshot.0 is recommended to the PM rather than
made here; 2 `docs/AGENT_WORKFLOW.md` — no-op (grepped: no FOLLOW-819/820, §Snapshot.5 or §P
reference); 3 `.claude/agents/*.md` — no-op (grepped, same terms); 4 `backlog/QUEUE.md` — dated
CORRECTION + caveat lines added in this PR; 5 `backlog/STATUS.md` — no-op by edit. It is a dated
2026-08-23 record, and its FOLLOW-819 lines describe that date; 6 `AUDIT_*.md` (repo root) —
`AUDIT_TEST_GAPS.md:296` and `AUDIT_REPORT_INVESTOR_READINESS.md:488` still say the differentiator
loop has no end-to-end test. Both are dated historical reports, left verbatim by convention and
flagged to the PM; 7 `docs/ops/OPERATING_PRINCIPLES.md` — no-op (§Y unchanged). Reszta jak v4.11.

**Changelog v4.11 (27 sierpnia 2026 — §E.7.0, reguła gruntowania osi dyrektyw [ESC-076; źródło: RETRO-315 LG-3, rozstrzygnięcie CEO]):** Ratyfikowana decyzja architektoniczna, nie korekta prawdziwości — pierwsza od v4.9. **Powód, dla którego powstała:** RETRO-315 zgłosiło cztery zaszyte na sztywno twierdzenia w wariantach playbooków (`'Tourist License, Near Beach'`, `'Fast Track Residency'`, `'Triple Net Lease'`, `'Near Top-Rated Schools'`) jako naruszenia HARD RULES ich własnych archetypów i zaproponowało ESC-076 jako pytanie o compliance. **CEO rozstrzygnął, że pytanie było źle postawione.** Rolą AL jest dopasowanie opisu do archetypu, a nie weryfikacja faktów; jeśli agencja napisała w listingu „top-rated schools", AL może tego użyć. Problemem tych czterech linijek nie jest to, że są twierdzeniami regulacyjnymi — tylko to, że **nie pochodzą z listingu**. Ta sama linijka jest dopuszczalna na gałęzi 3 (model widzi opis) i niedopuszczalna na gałęzi 2 (statyczny szablon, który listingu nigdy nie przeczytał). §E.7.0 zapisuje to jako regułę obu połówek: każda dyrektywa wywodzi się z treści listingu, ORAZ weryfikacja twierdzenia należy do sprzedającego. **Co reguła unieważnia:** przesłankę gałęzi 2 — `similarity` mierzy pewność co do archetypu KUPUJĄCEGO i nie mówi nic o nieruchomości, więc żaden próg na tej osi nie uczyni prawdziwym twierdzenia o tym listingu; oraz kształt allow-listy `buildDirectiveGroundingText`, która obok kontekstu listingu zawiera `slots[].en`, wszystkie warianty bandita i `copy_template.en`, przez co szablon autoryzuje sam siebie (FOLLOW-1034 dodało to świadomie pod starszym modelem, w którym wysyłane copy było prawomocnym gruntem). **Trzy konsekwencje jako jeden projekt, nie menu:** dyrektywa powstaje Z tekstu listingu albo nie powstaje (playbooki przestają być copy, stają się briefem głosu/framingu); gdy nie da się ugruntować — brak listingu (FOLLOW-1120) lub brak modelu — nie adaptujemy i zostaje copy agenta, co rozciąga na oś dyrektyw regułę, którą oś description miała od zawsze; korpus gruntujący zawęża się do listingu. **Koszty przyjęte świadomie i zapisane, żeby nie zostały później odczytane jako regresje:** gałąź 2 była jedyną ścieżką dyrektyw poniżej sekundy, więc każde żądanie niesie teraz wywołanie modelu; niedostępność LLM degraduje się do BRAKU adaptacji zamiast do adaptacji z puszki, więc mierzona częstość adaptacji w FOLLOW-819 / FOLLOW-820 SPADNIE — to reguła działająca, nie defekt; FOLLOW-1120 staje się nośne zamiast cicho absorbowane. **Odwrócenie wcześniejszego ustalenia, nazwane wprost:** RETRO-315 FOLLOW-1156 czyta zawężenie korpusu (skutek ESC-075) jako regresję P1; pod tą regułą zawężenie jest poprawne, a ticket zostaje odwrócony, nie wykonany jak zapisany. **Jedyna brakująca liczba:** udział ruchu na gałęzi 2 i na fallbacku — jedyny pomiar produkcyjny to [MP-010] (2026-08-17, ścieżka niegruntowana obsługiwała 100% ruchu), sprzed FOLLOW-1022 i nigdy nie powtórzony; rozkład `source` w `adaptation_decisions` odpowiada na to i jest dopięty do sesji localhost z FOLLOW-1155. §Y.2 propagacja: 1 `CLAUDE.md` — no-op (brak odniesienia do osi dyrektyw); 2 `docs/AGENT_WORKFLOW.md` — no-op; 3 `.claude/agents/*.md` — `ml-engineer.md` zaktualizowany w #865 (guardrail placeholderów), reguła gruntowania dopisana tym PR-em; 4 `backlog/QUEUE.md` — PM-owned, osobny PR; 5 `backlog/STATUS.md` — no-op (§Snapshot.1 nietknięte); 6 `AUDIT_*.md` — no-op; 7 `docs/ops/OPERATING_PRINCIPLES.md` — no-op. Reszta jak v4.10.

**Changelog v4.10 (14 sierpnia 2026 — §V.3.4 control-plane CORS truth correction [FOLLOW-954; source: RETRO-267]):** Docs-only pass — zero changes to runtime code, no new decision ratified. §V.3.4 was the estate's only architectural statement of control-plane CORS and every claim in it was wrong at `3f131b18`: it cited `apps/control-plane/src/middleware/cors.ts`, a file that does not exist (`ls apps/control-plane/src/middleware/` → no such directory — the real files are `src/middleware.ts` + `src/lib/origin-policy.ts`); its hardcoded `production` list named `'https://adaptive.estalara.com'`, a host that appears nowhere in the code, and omitted `'https://admin.estalara.com'`, which IS in `CORS_PROD_ORIGINS` (`origin-policy.ts:36-39`); it framed per-tenant origin enforcement as an ingest-only property when the control plane gained its own since #714 (`api-key-auth.ts:186`); and it asserted "Wildcard NEVER allowed" against three sites that require or accept `*` (`next.config.mjs:54` for `/consent-text.json`, required by ADR-0021 §D3; `intent/config/route.ts:55`; `quiz/public-config/route.ts:97`). Re-verified against HEAD (`main` `9c614f8c`) before writing, not inherited from the ticket table: every cited file:line was grepped directly (`origin-policy.ts:36-39,114-237,126-137,139-234`; `api-key-auth.ts:157-193`; `middleware.ts:69,94-126,172-181,341-353`; `brand-identity.ts:334-345`; the two `route.ts` wildcard lines; `next.config.mjs:54`) — all confirmed still accurate at this commit; none had drifted since RETRO-267's measurement. Rewrite: a three-layer model (preflight reflects because it cannot resolve a tenant; authenticated enforcement runs `resolveOriginDecision` and refuses with 403; the actual-response header is a separate third decision) replaces the fictitious code block; the per-tenant precedence `api_keys.allowed_origins ?? tenants.allowed_origins` and the first-party platform fallback are documented, including **what decides `isFirstParty`** — `classifyFirstPartyTenant`'s tri-state (`'confirmed' | 'external' | 'unverified'`) and its deliberately opposite fail-open/fail-closed defaults per branch (FOLLOW-951); the wildcard axis is restated as "is the response tenant-identified?" with the three current sites named and ADR-0021 §D3 cited as the reason one must stay, and the third (weight/quiz-config) pair flagged per FOLLOW-950 AC(3) as safe only because upstream enforcement runs, not because the header itself is safe. **The reflect-vs-platform-only split (AC(1)'s last clause) is documented at the level of an INVARIANT, not the data structure that encodes it** — deliberate, and stated as such in-section: two open, mutually conflicting PRs (#734/FOLLOW-949 — method-aware `isFullyOriginGated`, opt-out; #733/FOLLOW-950 — opt-in `ORIGIN_REFLECTING_ROUTES` registry) both change this mechanism at the time of writing, verified unmerged by reading `middleware.ts` at HEAD directly (still `isFullyOriginGated`, no `ORIGIN_REFLECTING_ROUTES`) rather than trusting either PR's ticket text; pinning this passage to either PR's shape would have reproduced exactly the defect this ticket exists to fix the moment one of them merges. Merge order is left as an explicit unresolved human decision. **FOLLOW-649 CLOSED, not executed as originally filed** (AC(4)): its diagnosis — that §V.3.4 was correct and only three sibling passages (`V.1.1` trust-boundary diagram, the `V.1.2` STRIDE Spoofing row, the `V.3.5` `api_keys` schema sample) needed a "hardcoded-env-CORS, not per-tenant" caveat — has inverted along with §V.3.4 itself: origin validation IS per-tenant now, so adding that caveat would introduce a NEW false claim. Re-checked all three at HEAD by content search (FOLLOW-649's original line numbers had drifted onto unrelated Profile-Mode text): the STRIDE row (`V.1.2`, "origin validation" as a Spoofing mitigation, `:4946`) and the `api_keys` schema sample (`V.3.5`, `allowed_origins` column with no annotation, `:5346`) are both now ACCURATE as-is and need no caveat — adding FOLLOW-649's originally-specified caveat to either would make them wrong. One genuine defect survives at the trust-boundary diagram (`V.1.1:4922`, _"Tenant-trusted: agency staff (adaptive.estalara.com)"_) — the same stale nonexistent host this ticket's table row 2 found in §V.3.4 — but a full-document grep for that string turned up **dozens** of further hits across §U and §V, all already the named scope of an older, still-open ticket, **FOLLOW-154** ("Update Master Design §U and §V to replace `adaptive.estalara.com` with `admin.estalara.com`", filed 2026-05-29, P2/architect, `promoted_to_queue: false`). Re-scoping FOLLOW-649 to own one of FOLLOW-154's own hits would have split ownership of one sweep across two tickets, so FOLLOW-649 is CLOSED with its finding folded into FOLLOW-154 (amendment added there) instead. **§Y.2 propagation (per item):** 1 `CLAUDE.md` — no-op (no §V.3.4/CORS reference, grepped); 2 `docs/AGENT_WORKFLOW.md` — no-op (no reference, grepped); 3 `.claude/agents/*.md` — no-op for prompts (grepped, none reference §V.3.4/CORS); two DATED historical `lessons.md` entries (`retrospective-analyst`, `backend-engineer`) cite the pre-#714 state of §V.3.4 as a record of what was true when written — left verbatim per the established convention for dated logs (Rule AI's corpus excludes historical retrospective/lesson entries); 4 `backlog/QUEUE.md` — PM-owned, outside this branch per brief, untouched; 5 `backlog/STATUS.md` — no-op (grepped, no §V.3.4/CORS reference, §Snapshot.1 untouched by this change); 6 `AUDIT_*.md` (repo root) — no-op (grepped, no reference); 7 `docs/ops/OPERATING_PRINCIPLES.md` — no-op (§Y itself unchanged). Reszta jak v4.9.

**Changelog v4.9 (8 sierpnia 2026 — description-axis signal-count floor raised to 5 [FOLLOW-913; ruling: ESC-054, CEO 2026-08-08]):** The FIRST product-behavior change to this gate (v4.5–v4.8 were docs-only truth corrections against unchanged code). **CEO ruling: keep the `aboveFloor`/`aboveDescriptionFloor` disjunction shape, but the description axis's signal-count arm is now its own constant, `DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT = 5` (`packages/sdk/src/core/adapt-floor.ts`), not the directive axis's `DOM_ADAPT_MIN_SIGNAL_COUNT = 2`.** Before this ruling both axes shared the same constant, so ONE real behavioral event (the init-time `device_type` prior already consumes the first of two, per FOLLOW-877's finding) was enough to fetch and apply LLM-generated long-form description copy at any confidence — including the ~0.05–0.10 cold-start band FOLLOW-343 was opened to guard against. `packages/sdk/src/index.ts` now computes TWO disjunctions instead of one and gates `applyDirectives()` and `applyDescriptionAdaptation()` in two separate `if` blocks; the directive axis is untouched. Three sections updated to match: **§A.1.5 Component 1**, the **FOLLOW-354 gating ladder note before §E.7.1**, and **§E.7.9's D.5 cross-reference** — all three previously said ESC-054 was OPEN (true as of v4.5/v4.6) and cited the shared `DOM_ADAPT_MIN_SIGNAL_COUNT (2)` for the description axis; all three now cite the ruled constant and value. **§E.4.6's separate ESC-054 citation (near the per-tenant `CONFIDENCE_THRESHOLD` tunability paragraph, `FOLLOW-889`) is a DIFFERENT sub-question — already ruled NOT WANTED by CEO, folded into FOLLOW-906 (architect-owned), and deliberately NOT touched by this revision; that citation is stale for a different reason and is out of this ticket's scope.** Test suite: `follow-877.test.ts` D-1 flipped (2 signals no longer opens the description axis) with a new D-1b pinning the new bar's positive case, and a new D-7 proving the directive axis is unaffected in the same run; `follow-354.test.ts` comments corrected (its own tests were signal-count-agnostic and needed no behavioral change). `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §9.1 annotated (the historical hop-10 narrative is unchanged, the architecture claim "same block" is corrected forward). `docs/specs/TICKET-DESC-PIVOT-001-v1.7.1.md`'s FOLLOW-887 correction note updated to point at this revision. `docs/AUDIT-2026-06-19.md` F-01 checked and left verbatim — its recommendation ("signal_count ≥ 2") was about the directive axis only, which this ruling does not touch. **Rule AI, klauzula 2:** pełna adjudykowana lista trafień trzech słowników jest w PR body FOLLOW-913; nie twierdzimy że dokument jest "czysty". §Y.2 propagacja: 1 `CLAUDE.md` — no-op; 2 `docs/AGENT_WORKFLOW.md` — no-op; 3 `.claude/agents/*.md` — no-op (sdk-engineer lesson fragment filed per Rule AG); 4 `backlog/QUEUE.md` — PM-owned, poza tą gałęzią; 5 `backlog/STATUS.md` — no-op (§Snapshot.1 nietknięte); 6 `AUDIT_*.md` (repo root) — no-op; 7 `docs/ops/OPERATING_PRINCIPLES.md` — no-op. Reszta jak v4.8.

**Changelog v4.8 (8 sierpnia 2026 — §Snapshot.1 wiersz B.6, trzecia warstwa tej samej klasy [FOLLOW-900; źródło: pierwsze w historii odpalenie detektora FOLLOW-893, Actions run `31241996385`]):** Docs-only pass — zero zmian w logice produktowej. **Detektor FOLLOW-893 zadziałał przy pierwszym scheduled runie i mówił prawdę:** `schema_validation_history` = **0 wierszy**, `cron_heartbeats` = **0 wierszy**, mimo że `modal app list` raportował `estalara-schema-validation` jako `deployed`. Przyczyna nie leżała ani w schedule, ani w sekrecie, ani w early-return przy braku tenantów: `modal app logs` powtarzał `File "/root/schema_validation.py", line 58 → from crons.observability import ... → ModuleNotFoundError: No module named 'crons'`. Modal 1.4.2 usunął automounting lokalnego źródła (od 1.0), a `modal deploy .../crons/schema_validation.py` importuje entrypoint **po ścieżce**, więc `__package__` jest puste i modal wybiera gałąź `FILE` swojego implicit entrypoint mount (`modal/_utils/function_utils.py::FunctionInfo`) — do kontenera trafia JEDEN spłaszczony plik `/root/schema_validation.py`, bez pakietu `crons/` obok. Kontener umierał na imporcie **przed** `init_sentry`, więc awaria nie miała żadnego kanału. **Ta sama klasa co ESC-053 i FOLLOW-891, o jedno piętro niżej:** `deployed` ≠ `running`, a teraz `running` ≠ `importable`. **AC(6) audit pozostałych apek Modal:** `apps/intent-engine` miał defekt **identycznego kształtu, jeszcze mniej widoczny** — `process_chat_message` importuje `nlp`/`redis_writer` **wewnątrz ciała funkcji** (a te ciągną `observability`/`schemas`), więc rejestracja przechodziła, app listował się jako `deployed`, i dopiero pierwsza realna inwokacja umarłaby w `.spawn()`, po tym jak ingest Worker dostał już swoje 202; nigdy nie został w prod zawołany, więc defekt był utajony. `apps/llm-gateway` jest zdrowy, ale **przez przypadek układu plików**, nie przez deklarację: jego `@app.function` żyją w `jobs.generate_description`, więc modal wybiera gałąź `PACKAGE` i montuje `jobs/`. Remedium jest strukturalne, nie trzy łatki: **`scripts/check-modal-local-imports.py`** (hard gate w `ci.yml` + krok w każdym jobie `modal-deploy.yml`) wymusza, by każdy lokalny moduł importowany przez deployowaną apkę Modal — na dowolnej głębokości, łącznie z importami w ciele funkcji — był zadeklarowany w `add_local_python_source(...)`; gate ma self-test (Rule Q) i przy pierwszym uruchomieniu na `main` odtworzył defekt produkcyjny w trzech apkach statycznie. **Wiersz B.6 NIE flipuje** — flip-condition (scheduled run zaobserwowany zielony + wiersz historii) jest celowo węższy niż to, co zmierzono ręcznym `modal run`. Reszta jak v4.7.

**Changelog v4.7 (7 sierpnia 2026 — staging-plane retirement + deploy-state reconciliation [FOLLOW-878 + FOLLOW-891; źródła: RETRO-259 §4d DG-1/§5a, RETRO-261 §3/§4a, ESC-052 RESOLVED]):** Docs-only pass — zero zmian w logice runtime, żadna nowa decyzja produktowa nie jest tu ratyfikowana. **(A) FOLLOW-878 — warstwa `staging`.** ESC-052 ustalił (dwukrotnie, niezależnie, po sha256 całego URL), że Doppler `stg.DATABASE_URL_ADMIN` jest **byte-identyczny** z `prd`; CEO wybrał **option 2** — localhost-first jest oficjalny także dla data plane, a nic nie może dalej *sprawiać wrażenia* izolacji, której nie zapewnia. Zbiór korekt ESC-052 zatrzymał się jeden dokument przed SoT — ten wpis to domyka: **§V.6.1** (usunięte `environments: dev / staging / prod`; wycofane zdanie _"Staging deploys read from `config=dev` (same token)"_ — nieprawdziwe w obu połowach: `db-migrate.yml:100` używa `--config stg` pod osobnym `DOPPLER_TOKEN_STG`, a `stg` mirroruje `prd`, nie `dev`) i **§V.6.3** (blok environment isolation oznaczony RETIRED; wycofane zdanie _"Brak shared secrets między environments"_ — to była dokładnie ta teza, którą ESC-052 obalił). Retirement samego configu `stg` i joba `migrate-staging` należy do **FOLLOW-873** i NIE jest tu wykonywany po raz drugi (FOLLOW-878 AC(4)). **(B) FOLLOW-891 — §Snapshot.1 wiersze A.1, B.6, D.** Pięć zdań w czasie teraźniejszym było prawdziwych w `fe73e8da` i zostało obalonych dwie godziny później (21:43 CEST) przez krok operatorski, o który poprosił ten sam PR #691; werdykty statusowe miały flip-condition, **narracja nie miała**. Korekta wykonana przeciwko **świeżo uruchomionym** sondom (Rule P), nie przeciwko stubowi ani PR body: `modal app list --json` → **TRZY** deployed apps (`estalara-description-generator`, `estalara-intent-engine` `ap-MpUyBq9gCwO5sL79w6X46y`, `estalara-schema-validation` `ap-YHoXtVM7ZnF5uMbqpRlzbd`), a sonda rejestracji (`modal.Function.from_name(...).hydrate()`) daje dla `estalara-intent-engine` dokładnie `chat_nlp_endpoint` + `process_chat_message`, natomiast `batch_enrich_conversations` → `NotFoundError`. Stąd **wiersz D** dostaje pierwszy w swoim życiu split CODE-VS-PROD (Rule AA): tier batch Sonnet 4.6 (§C.3) **nie jest w produkcji**; pytanie "czy ma być" to **FOLLOW-874 item 2** i NIE jest tu rozstrzygane. **Wiersz B.6 zachowuje status 🟡 `CODE_COMPLETE_OPERATOR_PENDING` i flip-condition verbatim** — żaden scheduled run nie został zaobserwowany i nie istnieje żaden wiersz `schema_validation_history`; obserwacja należy do FOLLOW-893 — którego autor (PR #696) dostarczył notę o **pierwszej weryfikacji** dopisaną pod flip-condition (owner: Piotr Nawrocki, data 2026-08-08, komenda `check-cron-heartbeat.sh`, runbook `SCHEMA_VALIDATION_CRON.md` — oba przychodzą z PR #696, nie z tą zmianą), wraz z zastrzeżeniem, że `schema_validation.py:411-414` robi early-return przy braku aktywnego tenanta z site-schema: **zero wierszy historii nie oznacza zepsutego crona**. Flip-condition NIE jest tu zmieniana. Oś ruchu (`chat_intent` shadow key w prod) pozostaje nieudowodniona → FOLLOW-892. **Rule AI, klauzula 2 — brak twierdzenia "dokument jest czysty":** pełna adjudykowana lista trafień trzech słowników (symbol `env.staging`/`--config stg`/nazwy apek; wartości — liczba apek, hosty `*-staging.estalara.com`; parafraza prozą — _"never been deployed"_, _"exactly ONE deployed app"_, _"pre-prod testing"_, _"Brak shared secrets"_) jest w PR body FOLLOW-878/891; trafienia w datowanych zapisach historycznych (RETROSPECTIVES, AUDIT-*, ADR-*, dpia/ropa revision-rows, `docs/decisions/`, `docs/ai-council/`) pozostają verbatim jako zapisy epoki i są objęte **FOLLOW-896**. Egzekucja mechaniczna: nowy CI gate `scripts/check-no-staging-plane.sh` (hard fail, self-test, register `scripts/baselines/staging-plane-register.txt`). **§Y.2 propagacja (per item):** 1 `CLAUDE.md` — no-op (brak rename sekcji, brak odwołań do §V.6/§Snapshot rows); 2 `docs/AGENT_WORKFLOW.md` — no-op (brak rename); 3 `.claude/agents/*.md` — no-op (brak rename; `devops-engineer` lessons dopisane osobno per learning hook); 4 `backlog/QUEUE.md` — **PM-owned, poza tą gałęzią per brief**, zmiany do naniesienia przez PM (wiersze A.1/B.6/D nie zmieniają statusu, więc sprint counts/ticket states bez zmian); 5 `backlog/STATUS.md` — no-op (żaden werdykt statusowy §Snapshot.1 nie został przeniesiony; B.6 celowo zachowane); 6 `AUDIT_*.md` (repo root) — no-op na osi werdyktów (AUDIT_IMPLEMENTATION_MAP/RISK_MATRIX/TEST_GAPS/INVESTOR_READINESS nie cytują §V.6 ani wierszy A.1/B.6/D w skorygowanym brzmieniu); 7 `docs/ops/OPERATING_PRINCIPLES.md` — no-op (§Y bez zmian materialnych). Reszta jak v4.6.

**Changelog v4.6 (7 sierpnia 2026 — gate-claim three-vocabulary sweep [FOLLOW-882 + FOLLOW-887; źródła: RETRO-260 §4d DG-1/DG-2, Rule AI amendment 2026-08-07]):** Docs-only correction pass — zero zmian w runtime-kodzie, żadna nowa decyzja nie jest ratyfikowana; **ESC-054 pozostaje OPEN (bez rulingu)** i żadna intencja nie jest tu zapisywana. v4.5 skorygowało trzy miejsca bramki adaptacji i uczciwie nazwało czwarte; ta rewizja zamyka miejsca **CZWARTE–SIÓDME** tej samej klasy błędu (dokument permissive na granicy, której kod nie ma; knob, którego kod nie ma): **(4) §E.4.6** [FOLLOW-882] — pseudokod skorygowany do kształtu HEAD: bramka serwera to `if (confidence <= CONFIDENCE_THRESHOLD (0.6)) → directives: []` (`route.ts:86,275` — wymagane strictly `> 0.6`), po stronie SDK DOM mutuje tylko dysjunkcja `aboveFloor` (`index.ts:827-829`) — brakująca gałąź `signal_count` dodana; zdanie _"CONFIDENCE_THRESHOLD tunable per-tenant (pilot: może być 0.4)"_ WYCOFANE jako opis stanu — `route.ts:86` to twarda stała modułu i żaden mechanizm per-tenant nie istnieje w HEAD (proweniencja fantomowego knoba: AUDIT-2026-06-04 `:1132` zakładał wpis w `.env.example`, nigdy nie zaimplementowany); intencja per-tenant progu NIE jest usuwana po cichu — zgłoszona PM jako stub-kandydat FOLLOW-889 (decyzja produktowa). **(5) §D.7 Fallback rules item 1** (`:2086`; w RETRO-260 / FOLLOW-887 cytowane jako "§D.5") — `< 0.6` → `<= 0.6`; sąsiednie `:1780` i `:2139` już używały poprawnego operatora, więc była to wewnętrzna sprzeczność, nie house style; miejsce **niewidoczne** dla symbolowego grepa FOLLOW-882 AC(4) (bare literal — stąd trzy-słownikowy sweep). **(6) `packages/sdk/src/__tests__/follow-354.test.ts`** (kod, nie ten dokument — odnotowane tu, bo ten changelog prowadzi rachunek miejsc klasy): nagłówek `:19-22` (_"SOLE gate"_, _"returns [] below it"_) i nazwa testu `:349` (_"the sole gate"_) uzgodnione z własnym AC-1 pliku (`:28-29`) i ze skorygowanym docblockiem `adapt-floor.ts`; `follow-877.test.ts:6` cytuje wycofane sformułowanie wyłącznie jako historię retrakcji — poprawne, bez zmian. **(7) §E.1 decision tree** (`:2145-2146`) — znalezione przez trzy-słownikowy sweep (Rule AI amendment 2026-08-07): granice similarity skorygowane `0.6 < s < 0.85`→`0.6 < s <= 0.85` oraz `s < 0.6`→`s <= 0.6` per `route.ts:87-88,323,328` — ta sama klasa permissive-boundary, sąsiednia stała tej samej funkcji. Dodatkowo `docs/specs/TICKET-DESC-PIVOT-001-v1.7.1.md` (datowany snapshot 15 maja 2026) otrzymał notę korekcyjną w nagłówku: jego payload §E.7.9 twierdzi _"confidence > 0.6 jest warunkiem wywołania endpointu"_, a `/api/adapt/description` nie ma serwerowej bramki confidence — payload historyczny zostawiony verbatim, nota kieruje do żywego §E.7.9 tego dokumentu. Zamknięcie **NIE** twierdzi, że dokument jest "czysty" (Rule AI amendment, klauzula 2): pełna adjudykowana lista hitów trzech słowników jest w PR body FOLLOW-882/887; hity w logach historycznych (RETROSPECTIVES, FOLLOW_UPS, QUEUE, AUDIT-2026-06-04/19, dpia/ropa revision-rows) pozostają verbatim jako zapisy epoki. §Y.2 propagacja: brak rename sekcji — pozycje 1-3, 6, 7 checklisty = no-op; pozycja 4 `backlog/QUEUE.md` = PM-owned (poza tą gałęzią per brief); pozycja 5 `backlog/STATUS.md` = no-op (§Snapshot.1 nietknięte — korekta nie zmienia żadnego wiersza statusu). Reszta jak v4.5.

**Changelog v4.5 (7 sierpnia 2026 — gating-ladder truth correction [FOLLOW-881; źródła: FOLLOW-875/877, RETRO-259]):** Docs-only correction pass — zero zmian w kodzie, żadna nowa decyzja nie jest ratyfikowana. Trzy stwierdzenia o bramce adaptacji DOM opisywały bramkę, której SDK nie ma — wszystkie trzy błędne w kierunku permissive, wszystkie trzy skorygowane przeciwko HEAD (verify-not-guess, OP Rule 5): (1) **§A.1.5 Component 1** — bramka SDK NIE jest samotnym floorem 0.5: to **dysjunkcja** `resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5) || currentIntentState.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT (2)` (`packages/sdk/src/index.ts:827-829`), a `adapt-floor.ts` jest modułem dwóch stałych bez żadnej ścieżki kodu (nie może "zwrócić `[]`"); (2) **nota FOLLOW-354 przed §E.7.1** — "sole gate" i "No third SDK gate exists" wycofane: gałąź `signal_count` jest drugą bramką SDK na OBU osiach; usunięty także akapit "This is intentional" — pytanie, czy `signal_count >= 2` powinno omijać cold-start floor FOLLOW-343 na osi opisu, jest **OTWARTE (ESC-054, bez rulingu na dzień tej rewizji; rekomendacja workera: `>= 5`)**; nota zapisuje teraz pełny zestaw guardów osi opisu (dysjunkcja → `archetype !== 'neutral'` → obecność slotu + listing-id → `source === 'ai_cached'`), zgodnie ze skorygowanym docblockiem `adapt-floor.ts` (FOLLOW-877, PR #692 — niezmergowany w chwili tego wpisu); (3) **§E.7.9 cross-ref do D.5** — j.w. Dodatkowo wszystkie trzy miejsca zapisują teraz, że bramka serwera `/api/adapt` to **strict greater-than**: `route.ts:275` = `if (confidence <= CONFIDENCE_THRESHOLD) → []`, więc dokładnie 0.6 zwraca `[]` (boundary locked: `route.test.ts:267`; próg liczony po client-sent `body.confidence ?? 0.5`, `route.ts:1224,1278`). Czwarte przedawnione stwierdzenie znalezione w **§E.4.6** (pseudokod `<` zamiast `<=`, claim "CONFIDENCE_THRESHOLD tunable per-tenant" bez kodu w HEAD, brak gałęzi `signal_count`) — POZA AC tego ticketu, zostawione in-place, stub zgłoszony do PM (kandydat FOLLOW-882). §Y.2 propagacja: brak rename sekcji (pozycje 1-3, 6, 7 checklisty = no-op); pozycja 4 QUEUE.md = PM-owned (poza tą gałęzią per brief FOLLOW-881); pozycja 5 STATUS.md = no-op (§Snapshot.1 nietknięte — zmiana nie dotyka wierszy statusu). Reszta jak v4.4.

**Changelog v4.4 (30 lipca 2026 — shadow-key write-admission rule [ADR-0020]):** Jedna decyzja architektoniczna, spec-only. FOLLOW-735 rozstrzygnął pytanie produktowe otwarte przez trzy odwrócone rundy `/code-review` w PR #642 (FOLLOW-730, revert `1ff873ef`): **nieudana ekstrakcja NIE neutralizuje serwowanego prioru**. Awaria wywołania Anthropic (a także "udana" ekstrakcja bez żadnego wymiaru — "hi", "dziękuję") nie mówi nic o kupującym, a strata jest sesyjnie trwała przez one-shot latch Rule R (`chatPriorApplied`, FOLLOW-252). Reguła jest kluczowana na **treści** (brak jakiegokolwiek użytecznego wymiaru), nie na `data_source` — provenance pozostaje DIAGNOSTIC ONLY. Mechanizm: pojedyncze atomowe `SET … NX` (bez GET, bez Lua, bez read-backu) — więc `payload.model_dump()` pozostaje jedyną ścieżką zapisu cytowaną w ROPA/DPIA/C-07, a TTL zachowanego rekordu nie jest odświeżany (retencja może się tylko skrócić, nigdy wydłużyć). Brak rekordu scalonego: `data_source`/`extraction_error` zawsze opisują wymiary leżące obok nich w tym samym rekordzie. §D.1.1 rozszerzone o tę regułę, **oznaczone jako SPEC — nie zaimplementowane w HEAD** (właściciel: FOLLOW-736, ml-engineer; czerwony test do odwrócenia: `test_degraded_payload_currently_still_overwrites_a_prior`). Zero zmian w SDK i control-plane. §Y.2 propagacja: brak rename sekcji (pozycje 1-3, 6, 7 checklisty = no-op); `backlog/QUEUE.md` + `backlog/FOLLOW_UPS.md` dotknięte w tym samym change (FOLLOW-736 stub + status FOLLOW-735); §Snapshot.1 BEZ zmian — reguła nie jest jeszcze zaimplementowana i wiersz D pozostaje prawdziwy do czasu merge'u FOLLOW-736.

**Changelog v4.3 (9 lipca 2026 — §Snapshot.1 truth-reconciliation refresh [FOLLOW-470]):** Docs-only reconciliation pass — no new decisions ratified. The Implementation Status Snapshot header had been dated 2026-05-24 (~5 weeks stale) and its per-section verdict table pre-dated the 2026-07-01 Full-Stack Audit; the audit's "Update 2026-07-01" block explicitly deferred the table refresh to FOLLOW-470. This change walks every §Snapshot.1 row, grep-verifies the cited symbol/file against HEAD (verify-not-guess, OP Rule 5), and corrects the rows that no longer match shipped code: **A.1** (intent-engine + llm-gateway description job are now real Modal services; `archetype-pipeline`/`adaptation-engine` apps no longer exist; stream-consumer chat-NLP is code-complete but not deployed in prod — F-03); **B.1** (Tier 1/2/3 framing retired per CEO 2026-06-05 §E.7 — flagged, section body NOT renamed per §Y.2); **B.2** (SDK budget raised to 42 KB gzip [ESC-028], IIFE now 39.86 KB gzip — under budget, thin headroom [FOLLOW-469], was 🟥 over-budget); **C** (SDK emits 21/46 event types per 2026-07-01 audit, taxonomy since grown to 52 via FOLLOW-461, was 8/37); **D** (intent-engine real, not a 27-line placeholder; 18-archetype set consistent across code, not "3 divergent places"); **E.1–E.3** (bandit feedback loop wired in CODE [FOLLOW-450 DONE] but prod feedback endpoint still operator-gated → bandit frozen at Beta(1,1) in prod — CODE-VS-PROD axis, Rule AA); **E.4** (Quiz v2.0 cascading tree IMPLEMENTED — `applyQuizLeaf` shipped, was "impl PENDING"); **E.7** (description pipeline IMPLEMENTED + LIVE in prod via Modal `estalara-description-generator` [ADR-0016, 2026-07-03] with `description_cache_persistent`, was "impl PENDING"); **H** (consent umbrella §H.8 + opt-out §H.9 wired, always-`legitimate-interest` bug fixed). §Snapshot.6 rule-count corrected 8→27 and retro/follow-up counts refreshed. `README.md` corrected from "Sprint 0" to Sprint 22b. `CLAUDE.md` Tier 1/2/3 language EDITED to flag the tiers as retired/historical (CEO ruling 2026-06-05 §E.7) — a retirement callout was added and the Tier bullets kept as explicitly-labeled legacy rather than silently rewriting the framing (§Y.2 respected, no section rename); the stale SDK-bundle line was corrected `<40KB` → `<42KB` (ESC-028). The edit was applied by the top-level orchestrator on the architect's behalf (the `architect` subagent has no shell tool); the architect's original plan to only *flag* was superseded — see RETRO-168 DG-1 / FOLLOW-544, which corrects this line's earlier "flagged, not edited" self-description. §Y.2 propagation: no section renames; `backlog/QUEUE.md` (FOLLOW-380 promotion) + `backlog/FOLLOW_UPS.md` (stub marked promoted) touched in the same change. Reszta jak v4.2.

**Changelog v4.2 (1 lipca 2026 — Full-Stack Audit Remediation epic):** CEO zlecił drugi, głęboki end-to-end audyt kodu (session 2, 8 równoległych torów: SDK / ingest+data / intent-engine / control-plane+LLM / analytics / compliance+security / plan-reconciliation). Werdykt: **🟡 YELLOW (borderline)** — fundament jest zdrowy i wart dokończenia (NIE scaffold-theater: 18 archetypów spójnych w 15 miejscach, `apps/intent-engine` to realny 651-LOC serwis Modal z prawdziwymi wywołaniami Haiku, SDK emituje 21/46 typów zdarzeń, bug consent always-`legitimate-interest` NAPRAWIONY, ścieżka opisu LLM ma realne zabezpieczenia anty-halucynacyjne) — ale **pętle pomiaru i uczenia pilotażu są po cichu zepsute w produkcji** przez zbiór luk wiring/deploy/config. 21 findingów (F-01…F-21). Plan naprawy zapisany jako **`Sprint 22b` w `backlog/QUEUE.md`** — tickety **FOLLOW-449…FOLLOW-471**, każdy z runtime-wired acceptance gate (Rule H) + krokiem weryfikacji (Operating Principle 5). **P0 (blokery mierzonego pilotażu):** FOLLOW-449 (migracja CH 0015 `intent_events.session_id` do prod + de-silence odrzuconych insertów — przyczyna count=0), FOLLOW-450 (włączenie feedback endpoint → pętla bandit uczy się; dziś 503-gated → Thompson uniform-random), FOLLOW-451 (realna auth API-key na POST /api/adapt — dziś tylko demo-JWT, klucz realnego tenanta → 401 → SDK fail-open null). **Definition of Done epiku = czysty re-audyt (FOLLOW-471):** ponowny przebieg tego samego audytu, każdy F-01…F-21 zamknięty z dowodem file:line (lub jawnym CEO-deferralem w ESCALATIONS.md), dołożony e2e różnicujący (behavioral trace → ingest → intent → adapt → DOM → mierzony lift, luka §Snapshot.5), bramki bazowe zielone — dopiero GREEN zamyka epik. Trzy pytania decyzyjne dla CEO wpływające na priorytety: (Q1) model auth pilotażu demo-JWT vs realny klucz (steruje ostrością FOLLOW-451); (Q2) czat w zakresie TEGO pilotażu (steruje FOLLOW-458 blocker vs fast-follow); (Q3) pilotaż mierzony vs pokazowy (steruje ostrością FOLLOW-450/452/453). §Y.2 propagacja: `backlog/QUEUE.md` (Sprint 22b) + §Snapshot.1 "Update 2026-07-01" w tym samym commit; brak rename sekcji. Pełny raport audytu = wynik sesji 2026-07-01 (referencja w ticketach `source:`).

**Changelog v4.1 (21 czerwca 2026 — Platform-wide consent umbrella + per-user opt-out toggle):** Dwie zmiany CEO-ratified (2026-06-21). (1) **§H.8 Platform-wide consent umbrella** — CEO decision: Adaptive-Listings owns the full consent layer for the entire Estalara platform. Consent is mandatory at app.estalara.com registration; without it the investor cannot register or use chat. The AL consent layer must disclose and cover all six processing purposes: (a) behavioral tracking, (b) reading investor chat, (c) transfer of derived insights to agency/agent, (d) buying-intent identification, (e) lead ranking by buying-intent strength, (f) agent-facing summaries of chat questions (LIVE + Estalara AI chat). Raw chat text remains APP-SIDE only — AL keeps only the 12-dim intent vector, 24h TTL, no free text (C-07 boundary). Rafał implements app-side data retention/deletion windows as a separate HANDOFF. Tracking ticket: FOLLOW-373. (2) **§H.9 Per-user opt-out toggle for DOM adaptation** — reversible, AL-only opt-out: suspending (not erasing) AL profiling + DOM adaptation for one logged-in user. OFF suspends; ON resumes. Does NOT affect app.estalara.com buying-intent / lead-ranking / agent chat-summaries (those ride the mandatory registration consent). Dual purpose: legal safeguard + product showcase (with/without DOM adaptation comparison). §G.2 updated to note Mode B (Consented Mode) is the canonical model for app.estalara.com pilot investors. Tracking ticket: FOLLOW-372. §Y.2 propagation: downstream docs reviewed; no section renames; QUEUE.md + STATUS.md updated in same commit.

**Changelog v4.0 (5 czerwca 2026 — Quiz Widget v2.0 + permanent description cache + coverage matrix + signal enrichment findings):** Cztery zmiany CEO-ratified (audit session 2026-06-04/05). (0) **§C.1 + §D.7 Signal Enrichment** — audit §3 (2026-06-05) identified 5 new low-cost, high-discrimination signals absent from the SDK: referrer URL + UTM keywords (F-22), device type (F-23), listing-view rate (F-24), favorites/bookmark (F-26), filter.applied enriched payload (F-27); plus micro-poll widget (F-25, FOLLOW-209). Expected behavioral-only accuracy improvement: 35–45% → 50–60%. Tickets FOLLOW-207 through FOLLOW-211 added. §C.1 updated with new signal taxonomy entries. §D.7 updated with BEHAVIORAL_DAMPING calibration note (FOLLOW-212, P3, post-pilot). §Snapshot.1 row C updated. (1) **§E.4 Quiz Widget REDESIGNED (v2.0)** — zastąpiony płaski 2-pytaniowy quiz → **drzewo decyzyjne z bramą Q1** rozdzielającą na 3 gałęzie (INWESTOR / WŁASNY UŻYTEK / CROSS-BORDER), 2–3 pytania, 17 liści (jeden per archetype non-neutral). Wszystkie 17 archetypów non-neutral bezpośrednio osiągalnych (poprzednio 4 komórki × 18 archetypów z nakładaniem). Nowa funkcja `applyQuizLeaf()` (direct assignment, confidence ~0.95) zastępuje `applyQuizPrior()` (Bayesian multiplier) dla ścieżek drzewa. Post-quiz drift detection z `DRIFT_HOLD_COUNT = 3` anti-thrash guard. Nowa tabela MOAT `quiz_completions` (Postgres/RLS). Wielojęzyczność: `en|pl|es`, 4-poziomowy priorytet detekcji języka. `admin.estalara.com/dashboard/quiz` toggle. (2) **§E.7 Description cache REDESIGNED** — Tiers i TTL **wyeliminowane**. Decyzja: Adaptive Listings nie ma Tiers — wszyscy tenanci dostają jedno doświadczenie. Redis key: `desc:{tenant_id}:{listing_id}:{archetype}:{locale}` bez EX/TTL. Nowa tabela Postgres `description_cache_persistent` — trwały, nieulotny rekord; invalidacja przez `listing.updated` event (nie przez czas). Kolejność lookup: `description_cache_persistent → Redis → template_fallback + Modal enqueue`. Parametr `tier` usunięty z API. (3) **§D.6 Coverage Matrix UPDATED** — 3 archetypy poprzednio "🔴 None" (student_parent, retiree_relocator, diaspora_buyer) teraz "🟡 Quiz path" przez dedykowane ścieżki w gałęzi CROSS-BORDER drzewa decyzyjnego. Snapshot.1 rows E.4/E.7/D.6 zaktualizowane.

**Changelog v3.9 (3 czerwca 2026 — Conversion Label Loop + prompt v1.9):** Dwie zmiany. (1) Nowa sekcja **§T. Conversion Label Loop (PROPOSED)** — audyt (read-only) ustalił, że system **NIE** zbiera etykiet konwersji nadających się do późniejszego fine-tuningu TALLRec/LoRA: predykcje lądują cienko w ClickHouse `adaptation_decisions` (bez `model_version`, bez snapshotu cech, bez `lead_id`), a outcome z `POST /api/adapt/feedback` jest zwijany w liczniki Beta `ab_bandit_weights` (para predykcja↔outcome niszczona). §T projektuje pętlę logowaną **od dnia 1**: EXTEND `adaptation_decisions` (migracja 0013: +`lead_id`/`model_version`/`features_snapshot`, REUSE `adapt_decision_id` jako `prediction_id`) + NEW tabela `conversion_labels` (Postgres/RLS, enum outcome, `label_source` system/manual), agregacja+kalibracja, ręczna reklasyfikacja + eksport korpusu w adminie, ingest głębokich outcome z CRM (PII-stripped). Plan tasków: **FOLLOW-170…175** (`backlog/FOLLOW_UPS.md`), ściśle uporządkowane (T0 = enrich predykcji, blokujące). (2) **Prompt v1.9 archetype-fit gate** ([ADR-0010], PR #184): model opisu może zwrócić `<adaptation_verdict>NEUTRAL</adaptation_verdict>` i odmówić adaptacji listingu fundamentalnie niedopasowanego do archetypu (DOM zostaje neutralny) zamiast „spinować" mismatchowane fakty. Brak rename sekcji (propagacja §Y.2 = bez zmian downstream — §T jest additive). Reszta jak v3.8.

**Changelog v3.8 (1 czerwca 2026 — detection→adaptation bridge, no-code app.estalara.com, AI-Vision quality strategy):** CEO potwierdził, że **app.estalara.com to żywy produkt i pozostaje no-code** — jego kod nie jest modyfikowany poza standardowym snippetem loadera SDK; adaptacja jest napędzana wyłącznie detekcją. Decyzja + mechanizm: **ADR-0008**; implementacja: **FOLLOW-159** (Plan A) + **FOLLOW-160** (Plan B). Konsekwencje: (1) **FIX-014 (sloty `data-estalara-*` w szablonie app.estalara.com) PORZUCONY/superseded** — `backlog/PLAN-V3-2026-05-30.md` + `CHK-B.md` oznaczone. (2) **Runtime augment-applicator (zaimplementowany)** — `packages/sdk/src/core/augment.ts` `annotateDetectedSlots()` rozwiązuje wykryte `detail_schema.slot_selectors` (primary→fallbacks, unikalne dopasowanie, nie nadpisuje istniejącego markupu, nie rzuca) i self-anotuje `data-estalara-slot` (mapowanie `headline→headline`, `cta_primary→cta`, `description→description`); potem istniejący silnik adaptuje BEZ markupu tenanta: **headline/cta** dyrektywami playbooka `/adapt`, **description** dedykowanym `/api/adapt/description` (§E.7) konsumowanym przez `core/description.ts` (textContent, XSS-safe). Parytet producent↔konsument: każdy wykryty detail-slot jest też modyfikowany. (3) **AI Vision rozszerzona** o detekcję detail-slotów (`detail_headline/cta/description_selector` w prompt + `buildDetailSlotSelectors`) zamiast hardkodu generyków. (4) **Zweryfikowane ograniczenie (verify-don't-guess):** obecna AI Vision wysyła **tylko tekst HTML** (nie screenshot, jak zakłada §B.5.1 L5) — dla bespoke sajtów Tailwind (app.estalara.com) zwróciła `confidence 0.3` (<próg 0.5 → null) i błędne/nierozwiązane selektory (headline→**cena**, cta/description brak); client-side deterministyczna detekcja zwraca `null`. (5) **Plan A (pilot, teraz — FOLLOW-159):** dla bespoke tenantów aktywowany schemat w `tenant_site_schemas` jest **kurowany/ręcznie autorski** (realne, zweryfikowane selektory) — nadal no-code (selektory w DB Estalary, nie w kodzie tenanta); applicator + opis działają bez zmian. Pozostałe kroki Plan A: rozszerzyć `getTenantSchema` (dziś reorder-only `TenantSiteSchemaMin`) o `detail_schema.slot_selectors`; **B1** — dołączyć `slot_selectors` jako **additive, opcjonalne pole odpowiedzi `/api/adapt`** (kanoniczny per ADR-0004/0006/0007); SDK konsumuje je w `refreshDirectives`. (6) **Plan B (self-serve, follow-up — FOLLOW-160):** prawdziwa **screenshot-based AI Vision** (realign do §B.5.1: screenshot+HTML→Claude Vision) dla robust detekcji bespoke sajtów bez ręcznego autorstwa; ryzyko kruchości kurowanych selektorów łagodzi Continuous Schema Validation (§B.6). Brak rename sekcji (propagacja §Y.2 = bez zmian downstream). Reszta jak v3.7.

**Changelog v3.7 (30 maja 2026 wieczór — CEO ratifications wave for Plan v3):** Po zapisie Plan v3 jako v3.0 (commit `09f9ac2`) CEO odpowiedział interaktywnie na 11 pytań otwierających. **10 z 11 deliverables ratified**, 1 (R-1 ZIP app.estalara.com) pending. **Kluczowe zmiany merytoryczne vs Plan v3.0:** (1) **Conversion definition** — `inquiry.completed` (typowy real-estate inquiry form) zastąpiony przez **`live.signup` OR `chat.contact_initiated`** (logical OR, równe wagi 1.0). Estalara nie operuje jak typowe portale nieruchomości — primary funnel events to zapis na LIVE event w listingu lub bezpośredni kontakt z agentem na czacie. `inquiry.completed` schemat pozostaje jako secondary fallback dla przyszłych agencji. Nowy ticket **SCHEMA-001** dodaje `live.signup` event do `packages/shared/src/schemas/events/live.ts` + ClickHouse column + Zod parser. **FIX-006** zmienia scope z form-onSubmit na live-signup CTA + chat first-message listener. (2) **Harmonogram 8 → 10-12 tygodni** (R-5 priorytet jakość) — dodatkowe bufory na FIX-014 SvelteKit cross-stack (Sprint 3 +2d), CHAT-001 expanded scope (Sprint 4 +3d), manual QA walk-through + pełna dokumentacja runbooków + dodatkowe e2e tests (Sprint 5 +5d). **Pilot start = tydzień 13** (nie 9). Dodany formalny **mid-pilot Council checkpoint** w tygodniu 7. (3) **SDK Estalary już wpięte na app.estalara.com** — FIX-017 redukuje z M (loader integration) do S (verify + adjust). (4) **AI Vision pipeline w pełni zaimplementowany** w `apps/control-plane/src/app/api/detect/route.ts:348` (Claude Sonnet 4.6, ANTHROPIC_API_KEY) — nowy ticket **VERIFY-001** weryfikuje że aktywny dla auto-detect schema na pilot listing pages po R-2 redeploy. (5) **R-2 Vercel env DONE** — 5 env vars w prd (ANTHROPIC_API_KEY, SUPABASE_JWT_SECRET, DEMO_MODE_JWT_SECRET, CLICKHOUSE_URL, CLICKHOUSE_PASSWORD); wymagany redeploy (`vercel --prod`) żeby weszły do runtime'u. (6) **AUTH-001 seed** — peter@estalara.com + rafal@estalara.com obaj jako agency:owner (nie 1 owner + 2 admin jak v3.0 zakładał). Krystian zostanie dodany przez UI po wdrożeniu Magic Linka. (7) **D-3 6 families ratified** (nie 18) — FIX-018/019/020 (compatibility layer dual-keyed bandit_arms) aktywne, brak destructive migration. (8) **Discovery Day batched** — CHK-A/B/C/E mogą startować natychmiast po otrzymaniu ZIPa R-1; CHK-D czeka na ZIP. APPROVED_TO_IMPLEMENT pozostaje **pending R-1 only** (ZIP app.estalara.com) — wszystkie inne deliverables zamknięte. **Pełna sekcja §0 ratyfikacji w `backlog/PLAN-V3-2026-05-30.md` v3.1**.

**Changelog v3.6 (30 maja 2026 — Adaptive Listings audit YELLOW + Remediation Plan v3):** CEO zlecił niezależny end-to-end audyt Adaptive Listings ("czy obecny fundament wystarczy do realnego pilotażu?"). Audyt (Claude Opus 4.7) zwrócił werdykt **🟡 YELLOW** z 23 findingami (F-01…F-23). Główne deficyty: brak realnej powierzchni adaptowalnej (jedyny adapt-slot'owany DOM to dashboard mockup, nie publiczna strona listingu); pokrycie sygnałów ~10% briefu (chat capture w ogóle nie istnieje — `apps/intent-engine/src/main.py` to 28-linijkowy placeholder); pętla pomiarowa otwarta (`inquiry.completed` ma schema i konsumentów ale brak producenta w SDK → bandit Thompson sampling stoi na Beta(1,1)); GDPR consent label mismatch (`events.ts:54` zawsze `legitimate-interest` mimo że schema ma `consented`); SQL injection-shaped risk w `logDecisionAsync` (raw string concat, escape tylko `'`); tenant isolation bypass na POST `/api/adapt` (presence-only auth); 18 archetypów ale klasyfikator z ~3 efektywnymi sygnałami; visible UX defekty (`Rental Yield: %` puste placeholdery, flapping copy na refetch). AI Council (session `20260530_150401`) dał `approve_with_changes`: thin pilot loop framing, defer chat z v1.0 (D-2=b), zwinąć 18 archetypów do 6 rodzin klasyfikatorów (D-3=b), dodać 4 Phase-0 pre-checks. CEO zaakceptował kierunek ale **rozszerzył scope** o: Magic Link login (BLOKER — dziś nie istnieje, CEO nie może się zalogować na admin.estalara.com); backoffice rebrand admin landing; pełny security audit (SEC-001); demo popup z archetype simulator (infrastruktura `demo_sessions` istnieje, popup nie); statystyki + eksport PDF/Excel; **chat WRACA do v1.0** (D-2 odwrócone — integracja z istniejącym chatem Estalara AI na app.estalara.com, oczekiwanie na ZIP R-1). Plan v3 = 31 ticketów (AUTH-001/002/003, CHK-A/B/C/D/E, FIX-001…032 podzbiór, SEC-001/002, DEMO-001/002, CHAT-001/002/003, STATS-001/002/003), 6 sprintów (Sprint 0 Login → Sprint 5 Validation), ~40 dni roboczych z 4 workerami równolegle, **~8 tygodni kalendarzowych**. APPROVED_TO_IMPLEMENT pozostaje **false** do ratyfikacji D-1, D-3, D-4, D-5, D-6 (D-2 ratyfikowane 2026-05-30) i dostarczenia R-1 (ZIP app.estalara.com), R-2 (Vercel env check), R-3 (admin email seed), R-4 (login workaround decision), R-5 (8-week confirm). Co rusza natychmiast bez decyzji CEO: Discovery Day = CHK-A (canonical /api/adapt ADR) + CHK-B (grep adapt-slotów) + CHK-C (FOLLOW-039 DSR status verify), ~6h pracy total. **Pełny rozkład planu, decyzje, deliverables, ścieżki kontynuacji po restarcie sesji w `backlog/PLAN-V3-2026-05-30.md`** — dokument samowystarczalny, nie wymaga dostępu do oryginalnej rozmowy. Audit chain: CEO → Opus audit → Plan v1 → AI Council 20260530_150401 → Plan v2 → CEO scope extension → Plan v3 → CEO ratification of plan (zapis + commit) 2026-05-30.

**Changelog v3.5 (29 maja 2026 — TICKET-PILOT-001 DONE; Sprint 13a pilot LIVE):** TICKET-PILOT-001
(Lane B: onboard `app.estalara.com`, shadow mode) is COMPLETE. All 6 ESC-012..017 escalations
RESOLVED. SDK→ingest→ClickHouse E2E verified. Key architectural facts now in the record:

- **Telemetry architecture correction.** Redpanda Cloud is **Serverless tier — no Pandaproxy REST
  interface** (ESC-017, RESOLVED by PR #170). The original Master Design §A.1 "ingest →
  Pandaproxy REST → Redpanda → ClickHouse consumer" chain was never viable at this tier. Canonical
  pilot path = **direct Worker→ClickHouse HTTPS** (`apps/ingest/src/clickhouse-producer.ts`, port
  8443, INSERT FORMAT JSONEachRow). Redpanda dual-write call retained as no-op for future Dedicated/
  BYOC upgrade. Decision on tier upgrade vs. formalizing direct-ClickHouse: FOLLOW-157 (Sprint 4).
  E2E verified: event count 0→1 after POST, `event_id = 01928f00-...-a3fc180390b5`,
  `tenant_id = cbc51cfa-1056-40aa-b0a9-6e982b52b1de`, 1.4s latency.

- **Control-plane domain correction.** `CONTROL_PLANE_DOMAIN = admin.estalara.com` (live on Vercel,
  CNAME → `6f8ae58f0ad31434.vercel-dns-017.com`, ESC-014 RESOLVED). `adaptive.estalara.com` is a
  dead name — it was never provisioned. §U and §V still reference `adaptive.estalara.com`; update
  tracked as FOLLOW-154 (P2, architect).

- **SDK serving.** Pilot serves `sdk.js` from `https://admin.estalara.com/sdk.js` via Vercel static
  asset hosting (`apps/control-plane/public/sdk.js`). `cdn.estalara.com` = Phase 2 (ESC-015
  RESOLVED). `buildSnippet()` emits the `admin.estalara.com/sdk.js` src.

  **The served bundles are BUILD ARTIFACTS, never committed (CEO ruling 2026-08-03, ESC-047 /
  FOLLOW-808).** `apps/control-plane`'s build runs `scripts/copy-sdk-bundle.mjs`, which copies
  `packages/sdk/dist/estalara-{sdk,detect}.iife.js` into `public/` — Turbo already builds
  `@estalara/sdk` first via `build.dependsOn: ["^build"]`, so every Vercel deploy on merge to `main`
  serves bytes built from that commit. Both files are `.gitignore`d and declared Turbo build outputs
  in `apps/control-plane/turbo.json` (without that a cache HIT restores `.next/` but not the
  bundles, deploying a control-plane whose `<script src>` 404s). Enforced by the
  `Served SDK bundles build-generated (ESC-047)` CI gate. _Why:_ under the previous hand-committed
  model `public/sdk.js` froze on 2026-05-29 and `public/estalara-detect.iife.js` on 2026-06-17 while
  ~76 tickets touching `packages/sdk` merged behind them — all green in CI, all DONE in the queue,
  none reaching a tenant.

- **Integration tier.** Pilot runs Tier 2 — single `<script>` tag injected into `app.estalara.com`
  layout by CTO Rafał Palak (ESC-013 RESOLVED). Not Tier 3 Native. No SvelteKit DOM slot mapping
  required for shadow mode.

- **Pilot tenant.** `id = cbc51cfa-1056-40aa-b0a9-6e982b52b1de`, `slug = 000-app-estalara`,
  ClickHouse user `ingest_worker` — minimal least-privilege grant (applied ESC-032 Phase 2 /
  FOLLOW-424, 2026-06-29; see `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md`): INSERT on
  `default.{events, intent_events, adaptation_decisions, llm_calls, dsr_audit_log}`; SELECT on
  `default.{llm_calls, intent_events, adaptation_decisions}` and `system.mutations`; ALTER DELETE on
  `default.{events, adaptation_decisions, llm_calls, session_quality}`; ALTER UPDATE on
  `default.dsr_audit_log`. The prior `INSERT, SELECT ON default.*` wildcard was revoked. Migration
  sequencing:
  `POST /api/tenants` (tenant-create) BEFORE `pnpm db:migrate` — RAISE EXCEPTION guard in 0016
  passed (ESC-012 RESOLVED).

- **CORS.** `hono/cors` on ingest Worker, allow-list `app.estalara.com` + `admin.estalara.com`,
  includes `X-Session-ID`. Verified: OPTIONS returns 204 + `Access-Control-Allow-Origin` live
  (ESC-016 RESOLVED, PRs #169/#78cae88).

- **Open security gap (FOLLOW-155, P1).** Vercel prd is missing `DATABASE_URL_ADMIN`,
  `DATABASE_URL_DIRECT`, and `ADMIN_API_SECRET` — control-plane silently in mock mode AND
  `POST /api/tenants` is open to the internet. Most urgent follow-up.

- **Infrastructure hygiene gaps (FOLLOW-156/157/158, P2).** ClickHouse `default.events` DDL
  created ad-hoc (not version-tracked); Redpanda tier decision pending; OTel + Sentry unwired in
  prd ingest Worker (logs only in Cloudflare Tail).

- **§Snapshot.1 update.** Sprint 13a pilot LIVE in shadow mode as of 2026-05-29. SDK→ingest→
  ClickHouse E2E verified. Broader go-live gate still requires FOLLOW-155 (P1 security), TICKET-
  PILOT-002 (go/no-go runbook), FOLLOW-092, and YELLOW audit Sprint 2–4.

**Changelog v3.4 (28 maja 2026, wieczór — Sprint 13a-hardening-v2 + v3 COMPLETE):** Three PRs merged on main (head `073f5d6`) closing the last v3.3-surfaced P0 EU-go-live blockers AND a critical infra trap discovered along the way. **The pilot pre-flight is now operationally ready** (`tenants.pilot_frozen` column verified present in prd via doppler-driven information_schema query — `[{column_name:'pilot_frozen', data_type:'boolean'}]`), with one scoped sequencing constraint (ESC-012) that TICKET-PILOT-001 owns.

- **Sprint 13a-hardening-v2 COMPLETE (2/2 P0 done).** **FOLLOW-139** (PR #164, `e4e37ac`) implemented localStorage 90-day cross-session `__estalara_xid__` with erasure-on-withdrawal — closes v3.3's "§13.2 disclosure factually inaccurate" P0 blocker. **FOLLOW-141** (PR #165, `19d11d2`) added migration 0016 to seed `inquiry_submit_selector` on the pilot tenant row + corpus accuracy test — closes v3.3's "inquiry-conversion wire silently inert" P0 blocker. **Inline within PR #164** the worker also resolved RETRO-023's FOLLOW-143 (wire `getOrCreateCrossSessionId()` into SDK init — producer was dead-code) and FOLLOW-144 (reconcile "rotates monthly" / "every 30 days" cadence claim across 5 disclosure surfaces — 3 locale banners + DPIA §13.2 + Privacy Notice §3 — to the actual 90-day TTL constant, with the `consent-banner.test.ts` regex updated). RETRO-024 surfaced FOLLOW-147 (pilot-slug verification + post-apply assertion, P0 carry-forward).
- **DPIA §13.2 GREEN flip now substantially supportable.** PR #164's inline fixes operationally back the v3.3-bumped LIA balancing test for the 90-day cross-session identifier. RETRO-025 verdict on the inline fixes: FOLLOW-UPS-FILED (not CLEAN) — the producer is correctly wired into `index.ts:116,159`, but **NO integration / E2E test asserts `__estalara_xid__` is present after granted init AND absent after denied init**, and `dpia.md:1017` retains a legacy "30-day rotation bucket" sentence (a separate HMAC narrative) that now reads as a dual-id-narrative collision inside §13.2. **FOLLOW-150** (P1, sdk-engineer + compliance-engineer, 2h) — must close BEFORE DPO sign-off but does NOT block TICKET-PILOT-001 shadow-mode spawn (the §13.2 EU pilot launch gate is operationally satisfied; the DPO presentation tightening is a separate beat).
- **Sprint 13a-hardening-v3 COMPLETE (1/1 P0 done) — migration tooling hardened.** A pre-FOLLOW-149 diagnostic discovered TWO production-grade bugs that had silently invalidated bookkeeping for ~10 days: (Bug 1) drizzle-kit was generating 2025 timestamps for new migrations 0015/0016 (one-year year-drift, SECOND occurrence after `c92da81`'s 2026-05-18 repair of entries 6/8/9/10/11), so Drizzle's migrator silently skipped them; (Bug 2) `packages/db/scripts/migrate.ts` always printed "Migrations applied successfully." even with zero migrations applied. The prior "Migration 0015: prd ✅ applied" claim in v3.1 bookkeeping was therefore false the whole time. **FOLLOW-149** (PR #166, `073f5d6`, devops-engineer on opus-4.7-xhigh, ~3h) landed four parts:
  - **Part A** (`8a384c6`) — `_journal.json` entries 15/16 `when`-values repaired to commit-aligned 2026 values; full 17-entry journal asserted monotonic.
  - **Part B** (`d6131f6`) — new CI gate `Migration journal monotonicity check` (`scripts/check-migration-journal.sh`, 7–9 s) that fails on non-monotonic journals OR `when`-values more than 7 days from the SQL file's git commit date; wired as real merge gate (not pre-existing-red); includes self-test fixtures.
  - **Part C** (`109dfbb`) — `migrate.ts` now reports honest before/after/applied/pending counts, exits non-zero with a loud warning when `pending > 0` AND `applied == 0` (trap-killer for Bug 2).
  - **Part D** (`be75cb3`) — migration 0015 applied to prd via isolated per-entry script (NOT via `pnpm db:migrate` — see ESC-012); column verified present (boolean / default false); `drizzle.__drizzle_migrations` row landed at `id=17` with hash `06190fd...` and `created_at=1779840001000`. **Rule O added** to `CONVENTIONS_PATCH.md` (provisional, pending second-occurrence promotion): "migration journal timestamps must be monotonic and within 7 days of the SQL file's commit date; CI-enforced."
- **ESC-012 OPEN — `pnpm db:migrate` no longer safe in tenant-less envs.** Drizzle wraps all pending migrations in a SINGLE transaction (`drizzle-orm/pg-core/dialect.js:60`). Migration 0016's `DO $ … RAISE EXCEPTION` (added by FOLLOW-141 to fail loudly when the pilot tenant `000-app-estalara` is missing) fires inside that txn and rolls back ANY 0015+ entries together. Worker bypassed for Part D via an isolated `BEGIN/INSERT INTO drizzle.__drizzle_migrations/COMMIT` mirror of Drizzle's per-entry logic. **TICKET-PILOT-001 owns the resolution**, two equivalent paths: (1) Magic Link wizard calls `db:migrate` AFTER `POST /api/tenants` creates the pilot tenant (sequence enforced in runbook), OR (2) data-engineer softens 0016's `RAISE EXCEPTION` to `RAISE NOTICE` no-op when slug absent. **RETRO-026 FOLLOW-151** (P0, architect+PM, 1h, must close BEFORE TICKET-PILOT-001 spawn) wires ESC-012 into TICKET-PILOT-001 spec + AC + PILOT_RUNBOOK recovery pattern so a worker cannot miss it.
- **RETRO-026 surfaced two additional gaps** (FOLLOW-152 P1, FOLLOW-153 P2). **FOLLOW-152**: Part C's exit-2 trap-killer has zero unit test coverage today — entire FOLLOW-149 thesis ("operator tooling must reflect reality") rests on visual inspection. AC4 includes a diagnostic SELECT to confirm the phantom `id=17` row anomaly is the expected non-transactional SERIAL increment after a rolled-back txn (most-likely explanation — non-blocking; tickets a documentation-only clarification if confirmed). **FOLLOW-153**: CI gate's git-log-recency path is the primary intended use case but the four self-test fixtures all use mtime; add a git-log-based fixture. Candidate **Rule P** "tooling output must reflect reality, not optimism" logged at 1 instance — promotes if a second similar finding appears in a future retro.
- **Pilot pre-flight state — what is and isn't ready:**
  - `tenants.pilot_frozen` column in prd ✅ — verified 2026-05-28 via `doppler run --config prd -- node` (above).
  - inquiry_submit_selector seed (migration 0016) **PENDING** — by design; applies after pilot tenant exists (TICKET-PILOT-001 step 2 Magic Link wizard creates it via `POST /api/tenants`).
  - DPIA §13.2 LIA disclosure operationally matches code (90-day cadence reconciled, producer wired, withdrawal erasure shipped). DPO presentation should wait on FOLLOW-150 narrative tightening but the LIA balancing test passes.
  - Migration tooling hardened: future drizzle-kit year-drift bugs are caught at PR time; future silent-success bugs in `migrate.ts` are killed at exit code 2.
- **Pilot launch gate updated.** **GO** for TICKET-PILOT-001 (Lane B) spawn — Lane A's 8 tickets, Lane B's hardening-v1/v2/v3 prerequisites, and the EU GDPR §13.1/§13.2 disclosures are all operationally satisfied. **Required spawn precondition:** FOLLOW-151 closed first (1h, wires ESC-012 into TICKET-PILOT-001 spec/AC/runbook). After spawn, TICKET-PILOT-001 must include either path (1) or (2) for ESC-012 resolution before its own go-live. YELLOW Sprint 2–4 still needed for broader pilot launch gate (Sprint 14, post-pilot).
- retrospective-analyst RAN on PR #164 inline fixes (RETRO-025) and PR #166 (RETRO-026), both 2026-05-28. §Snapshot.1 status moves when Lane B + YELLOW Sprint 2–4 land.

**Changelog v3.3 (27 maja 2026, wieczór — Sprint 13a-hardening COMPLETE, pre-pilot gate CLOSED):** A targeted pre-pilot hardening wave landed 4 PRs on main (`29c97ab`), closing the last gates before TICKET-PILOT-001 (Lane B) can go live. These were surfaced by RETRO-013/017/018 during the Wave 3 + YELLOW Sprint 1 retros.

- **FOLLOW-127 (P0, PR #161, `6a27841`) — inquiry tracking is now production-ready.** The auto-detection engine now PRODUCES `inquiry_submit_selector` (deterministic probe + LLM fallback); `/api/detect` returns it and `/api/schema/activate` persists it into `tenant_site_schemas.schema` JSONB. FOLLOW-097/114 had closed the schema→snippet→SDK consumer chain, but no production code had ever populated the field on a real detected schema (it lived only in the hand-authored `000-app-estalara` fixture) — so `inquiry.started` would never fire for a non-pilot tenant. Closes the transitive Rule L producer gap (RETRO-017). Interim hand-set value documented on the pilot schema so TICKET-PILOT-001 is unblocked while the full detection rule generalizes.
- **FOLLOW-128 (P0, PR #160, `256b469`) — EU GDPR consent disclosures shipped.** The DPIA §13.1 (consent-denial server-side logging LIA) and §13.2 (90-day cross-session fingerprint LIA) were documented in v3.2 (PR #158) but the shipped SDK banner copy disclosed neither — and §13.2's three-part balancing test passes ONLY if the disclosure gap is remediated. Banner copy (en/pl/es) now discloses both the 7-day denial-logging notice and the 90-day rotating cross-session identifier; DPIA §13.1/§13.2 marked remediated (RETRO-018 documentation HALF_WIRE_C).
- **FOLLOW-129 (P0, PR #159, `10ae1e7`) — tenant-facing compliance artifacts + DPO gate.** Tenant Privacy Notice template carries both §13.1 + §13.2 disclosure paragraphs; DPO sign-off recorded against DPIA §13.1/§13.2 (replaces "DPO review pending"); QA verified "Deny"/"Withdraw" removes the cross-session `localStorage` fingerprint key on staging (§13.2 mandated verification). Includes the GREEN balancing test, privacy notice template, and EU pre-flight gate (RETRO-018 §4d DG-2).
- **FOLLOW-122 (P1, PR #162, `29c97ab`) — pilot dashboard renders honestly.** FOLLOW-094/098 made the pilot routes fail loud (HTTP 500) and emit `data_source` provenance, but `/dashboard/pilot/page.tsx` kept a duplicate `CtaLiftResponse` interface (dropped `data_source`) and gated only on `'summary' in raw` — swallowing the 500 into a silent blank panel. The page now imports the canonical type, renders a visible "mock data" badge when `data_source === 'mock'` and an error banner on non-2xx, so a go/no-go reviewer cannot mistake mock for real (RETRO-013, also closes RETRO-008 TG-2).
- **Pre-pilot gate CLOSED → Lane B unblocked.** With inquiry tracking production-ready, EU GDPR compliance complete, and the dashboard honest, **Sprint 13a Lane B — TICKET-PILOT-001 (onboard app.estalara.com, shadow mode) — is now READY**, pending CEO spawn go-ahead. The broader pilot go-live gate still also requires FOLLOW-092 + TICKET-PILOT-002 (within Lane B) AND YELLOW audit Sprint 2–4.
- retrospective-analyst RAN on PR #159–#162 (RETRO-019 through RETRO-022, written 2026-05-27). **The retros surfaced two NEW P0 EU-go-live blockers that the CEO must weigh before spawning TICKET-PILOT-001, even though the four hardening tickets are correctly DONE:** **FOLLOW-139** (RETRO-019) — the now-live FOLLOW-128 §13.2 banner string + FOLLOW-129 Privacy Notice disclose a "90-day cross-session `localStorage` identifier deleted on Deny/Withdraw" that does not exist (the SDK fingerprint is tab-lifetime `sessionStorage` with no withdrawal erasure), so the §13.2 lawful-basis disclosure is factually inaccurate and FOLLOW-129 AC3's staging-QA gate is unexecutable; and **FOLLOW-141** (RETRO-021) — FOLLOW-127's interim hand-set `inquiry_submit_selector` exists only in a test fixture with no committed seed/migration on the real pilot tenant row, so the pilot's inquiry-conversion wire may be silently inert at runtime. Plus two P1: FOLLOW-140 (§13.1 7-day retention claim unenforced) and FOLLOW-142 (`/dashboard/analytics` sibling still swallows the fail-loud 500). RETRO-019 promoted Rule N (doc-vs-reality, ≥2 occurrences). §Snapshot.1 status moves when Lane B + YELLOW Sprint 2–4 land.

**Changelog v3.2 (27 maja 2026 — Sprint 13a Lane A COMPLETE + YELLOW audit Sprint 1 integrated):** A massive merge wave landed on main (`6827305`).

- **Wave 3 MERGED (Sprint 13a Lane A, 5 PRs, all CI green).** **FOLLOW-094** (PR #153, `9f32aa8`): `/api/pilot/cta-lift` now fails loud on a ClickHouse error and exposes `data_source: 'mock' | 'clickhouse'` provenance, so a query failure can never masquerade as a fabricated significant lift (RETRO-008 CB-1, Rule K.2). **FOLLOW-093** (PR #154, `a7d9c03`): the two divergent CTA-lift query paths reconciled onto one canonical events-schema vocabulary (RETRO-008). **FOLLOW-098** (PR #155, `4ce6e37`): same fail-loud + provenance treatment applied to `/api/pilot/inquiry-starts` (RETRO-009). **FOLLOW-117** (PR #156, `38a8393`): the inert `pilot_frozen` Lane C measurement-window guard fixed — consumer now reads `cfg.enabled` (what the quiz config producer actually writes) instead of `cfg.quiz_enabled` (RETRO-012). **FOLLOW-114** (PR #157, `f882dae`): `buildSnippet()` now emits `data-inquiry-submit-selector`, so `inquiry.started` fires for real tenants (not just the hand-written e2e fixture) — completes the FOLLOW-097 half-wire fix end-to-end (RETRO-011, Rule L). **Sprint 13a Lane A is now 8/8 DONE; only Lane B (TICKET-PILOT-001/002 + FOLLOW-092) remains.**
- **YELLOW audit Sprint 1 MERGED (PR #158, `6827305`) — parallel work track.** A separate "YELLOW audit" launch-readiness plan (its own `F-NN` ticket numbering, NOT the FOLLOW-NNN retrospective system; canonical plan lives outside the repo) landed Sprint 1 as one bundled PR, tracked in QUEUE.md under reserved FOLLOW-118/119/120/121: **F-02** — `applyArchetypeHints()` wired in SDK `init()` so the cold-start Bayesian prior reflects site type before the first behavioral event (try/catch guarded). **F-09** — locale-correct slot copy: `SdkConfig.language` extended to `'en'|'pl'|'es'`, threaded through `fetchDirectives()` into `runDecisionTree()` (`s.pl ?? s.en` / `s.es ?? s.en`), Spanish UI strings added. **F-10** — per-tenant/session LLM cost attribution (`sessionId`/`tenantId` on `LlmGatewayInput` → ClickHouse cost rows carry real ids, no more `'unknown'`). **F-13/F-14** — GDPR Legitimate Interest Assessment documented in `docs/compliance/dpia.md` §13.1 (consent.denied server-side dispatch) and §13.2 (stable cross-session fingerprint), documentation-only per the Option B decision.
- **Remaining YELLOW audit work (Sprint 2–4):** **F-01, F-04, F-05, F-06, F-07, F-08, UX-01, plus a measurement dashboard.** Now **reserved in `backlog/FOLLOW_UPS.md` as FOLLOW-132…138** (2026-05-27, pm-orchestrator) with `recommended_sprint: 14` (post-pilot) so QUEUE.md stays the status SoT: FOLLOW-132=F-01, 133=F-04, 134=F-05, 135=F-06, 136=F-07, 137=F-08, 138=UX-01 (+ the measurement dashboard, folded into 138 pending the plan's own decomposition). **These are reservation stubs only — detailed scope/AC are NOT yet in the repo: the canonical F-NN plan that governs them lives outside the repo (confirmed RETRO-018) and was inaccessible at integration time; PR #158's body specced only the Sprint-1 bundle it shipped (F-02/F-09/F-10/F-13/F-14), not these.** Pull the real spec from the canonical F-NN plan before promoting any stub to a ticket at Sprint 14 planning. Sequence vs. Lane B is an open CEO decision (see below).
- **Pilot launch gate updated.** Go-live now requires BOTH (a) Sprint 13a **Lane B** — TICKET-PILOT-001 (onboard app.estalara.com, shadow mode) + FOLLOW-092 (cta.clicked producer→ClickHouse verification) + TICKET-PILOT-002 (go/no-go runbook) — AND (b) **YELLOW audit Sprint 2–4** (the remaining F-NN launch-readiness items + measurement dashboard). Lane B is unblocked on Lane A as of this merge wave, pending CEO spawn go-ahead.
- retrospective-analyst to run on PR #153–#158 (RETRO-013 through RETRO-018). §Snapshot.1 status moves when Lane B + YELLOW Sprint 2–4 land.

**Changelog v3.1 (26 maja 2026 — Sprint 13a Lane A Wave 2 MERGED):** Wave 2 landed on main. **FOLLOW-097** (PR #151, `3cf05ee`): the detected `inquiry_submit_selector` is now threaded from the activated tenant site schema → SDK config → `setupObservers()` at init, so `inquiry.started` fires in production (previously the options object was never passed, so the selector was always `undefined` and the event only fired in unit tests — RETRO-008/009 HALF_WIRE). **FOLLOW-106** (PR #152, `b83e6c0`): added the `tenants.pilot_frozen` boolean runtime flag (migration `0015_pilot_frozen.sql`, schema, control-plane adapt-route prophylactic non-blocking warning when a Lane C feature flag is on while `pilot_frozen=true` — per PILOT_FREEZE_RULE.md Decision 3); TICKET-PILOT-001 sets it `true` on the shadow→live flip to open the CTA-lift measurement window. Migration applied to **prd** ✅ (the config that matters for the pilot); **dev + stg deferred** ❌ — `DATABASE_URL_ADMIN` not set in Doppler for those configs (no admin DB credentials), backfill once provisioned (tracks with ESC-010). **Not a pilot blocker.** Sprint 13a Lane A: Wave 1 (FOLLOW-105) + Wave 2 (FOLLOW-097/106) DONE; **Wave 3 (FOLLOW-094/098/093 — pilot-route fail-loud + provenance) now READY**, awaiting CEO spawn go-ahead, then TICKET-PILOT-001 (Lane B onboarding). retrospective-analyst spawned on PR #151 + #152. §Snapshot.1 status moves when the remaining Lane A tickets land.

**Changelog v3.0 (25 maja 2026 — Phase-0 specs RATIFIED; APPROVED_TO_IMPLEMENT=true):** CEO Piotr Nawrocki ratified all `DECISION NEEDED` markers in the 4 Phase-0 spec documents (`PILOT_CTA_LIFT_METRIC_v1.md`, `PILOT_FREEZE_RULE.md`, `PILOT_RUNBOOK.md`, `ADR-0006`). Sprint 13a Lane A expanded to 6 tickets (FOLLOW-106 added for the `tenants.pilot_frozen` runtime flag). Sprint 14 gets FOLLOW-107 (Worker `/api/adapt` full retirement, Phase 2). FOLLOW-099 AC updated with a bot User-Agent regex requirement (block list runs before any event emission). ADR-0006 Worker disposition: phased 3c→3a (hard-fail `410 Gone` in FOLLOW-105 → retire in FOLLOW-107). Contract reconciliation: ADR-0004 contract block updated to match live (live wins). Rollback procedure added to ADR-0006. Pilot signal trustworthiness gates locked: ≥300 adapted + ≥30 holdout floor; 100% canonical route targeting (zero tolerance); bot/QA exclusion ≥99% verification; abort timeline matrix (24h NULL / 48h zero-significant / 24h negative). Sprint 13a now ~26.5–28.5h, 9 tickets ready to spawn.

**Changelog v2.10 (25 maja 2026 — AI Council ratification-with-changes; Sprint 13a/13b split; Phase-0 specs):** AI Council session `20260525_143939` ratified "Track 1 first" **with changes** and set `APPROVED_TO_IMPLEMENT=false` — only no-code spec/audit work proceeds until blocking questions B1–B8 close (B1/B2/B3/B7 gate coding). Changes applied:

- 🔀 **Sprint 13 split into 13a + 13b.** ~63.5h / 14 tickets is not review-safe under Piotr's ~2h/day capacity. **13a** = Lane A correctness + canonical-route enforcement (5 tickets) + Lane B pilot launch (3 tickets). **13b** = Lane C Adaptive Listings v1.0 intent build (6 tickets), parallel ONLY under the hard-isolation freeze rule.
- 📄 **Four Phase-0 spec artifacts authored** (no-code, for CEO ratification): `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md` (B1/B5/B7), `docs/ops/PILOT_FREEZE_RULE.md` (B2), `docs/ops/PILOT_RUNBOOK.md` skeleton (B4/B6; TICKET-PILOT-002 completes), `docs/adr/ADR-0006-canonical-adapt-enforcement.md` (B3, PROPOSED).
- 🧊 **Hard-isolation freeze rule.** FOLLOW-099 (SDK event emission) + FOLLOW-103 (app.estalara.com DOM adaptation) touch the pilot tenant directly → PROHIBITED during the CTA-lift measurement window (must land before it opens or after it closes). FOLLOW-087/100/101 = shadow-only; FOLLOW-102 = mergeable (tenant-gated off).
- 🛠️ **FOLLOW-105 substep split + estimate 6h→8-10h** (AI Council risk #6): 1a SDK config/runtime audit → 1b ADR-0006 ACCEPTED → 1c Worker disposition → 1d CI Rule H/J gate.
- 🔎 **CTA-lift ground truth confirmed (B7):** canonical = `events.cta.clicked` ⨝ `adaptation_decisions` on `session_id`, window on `ad.ts` (`apps/control-plane/src/app/api/pilot/cta-lift/route.ts`); the `dashboard/analytics/lift` path (`dqs_events` on `assigned_at`) is non-canonical → FOLLOW-093 reconciles.
- ✅ **§Snapshot.7 risk #1 RESOLVED** (2026-05-25, FOLLOW-105 Wave 1 / PR #150): canonical control-plane `/api/adapt` enforced (snippet + SDK Zod), Worker 410 Gone, ADR-0006 ACCEPTED, CI Rule H guard against re-divergence. Worker handler removal → FOLLOW-107 (Sprint 14).
- 🔄 **Snapshot.1 unchanged** — Phase-0 is no-code; status moves when Sprint 13a/13b implementation lands.

**Changelog v2.9 (25 maja 2026 — FOLLOW-105 P0 canonical /api/adapt added to Sprint 13 Lane A):** AI Council Ticket 4 P0 (route divergence) recommended by session 20260525_132514 added to Sprint 13 per CEO ratification 2026-05-25. Worker /api/adapt (3-bucket) vs control-plane /api/adapt (18-archetype + LLM) divergence is a pilot blocker — without an enforced canonical path, the SDK could silently target the 3-bucket path and the pilot would not exercise the 18-archetype playbook. NOTE: the canonical DECISION already exists as ADR-0004 (control-plane = canonical) and ADR-0005 is already taken (Modal Apps Disposition); per CEO decision FOLLOW-105 writes **ADR-0006 "Canonical /api/adapt Enforcement"** as a follow-on to ADR-0004 (re-affirm + enforce), retires/proxies the non-canonical Worker route, adds a CI Rule H regression, and flips §Snapshot.7 risk #1 OPEN→RESOLVED. opus-4.7-xhigh — architectural decision. Sprint 13 Lane A now 5 tickets (~63.5h total sprint).

**Changelog v2.8 (25 maja 2026 — Sprint 12 close, Sprint 13 three-track open):**

- 🔒 **Sprint 12 CLOSED.** Lane A hardening (FOLLOW-081 ClickHouse integration test, FOLLOW-075 CRON_SECRET enforcement, FOLLOW-078 DSR alerting) + Lane C ROI instrumentation (TICKET-PILOT-003 CTA-lift dashboard, TICKET-PILOT-004 inquiry-starts) merged across PRs #142–#146. Lane B (pilot onboarding) deferred — pilot did NOT launch this sprint.
- 🚦 **Sprint 13 OPEN — three-track structure (Track 1 first per CEO decision 2026-05-25):** **Lane A** (dashboard correctness — FOLLOW-094/098/093/097, from RETRO-008/009) → **Lane B** (pilot launch on app.estalara.com — TICKET-PILOT-001, FOLLOW-092, TICKET-PILOT-002; blocked until Lane A) → **Lane C** (Adaptive Listings v1.0 intent build — FOLLOW-099/100/087/101/102/103; parallel with Lane B during shadow window). 13 tickets, ~57.5h.
- ⚠️ **RETRO-008/009 surfaced launch-blockers:** both pilot dashboards fabricate statistically-significant metrics on ClickHouse error/absence (Rule K.2 — FOLLOW-094/098), and `inquiry.started` never fires in prod because the selector is not threaded into SDK init (FOLLOW-097). These gate go-live and form Sprint 13 Lane A.
- 📋 **RETRO-SPRINT-12 written** (`backlog/RETROSPECTIVES.md`) — sprint-level close per OP §Y.3 (third execution). FOLLOW-079 cancellation lesson recorded (a "tighten the gate" ticket is a discovery ticket, not a 1h fix).
- 🧹 **Tracking inconsistencies cleaned:** FOLLOW-104 stub created (ReorderDirective deferral); ESC-010 number assigned to the DOPPLER_TOKEN_DEV escalation; CANCELLED FOLLOW-079 pruned from TICKET-PILOT-001 `depends_on`; two stale escalations (commitlint PILOT-prefix, GitHub Actions billing PR #125) marked RESOLVED.
- 🔄 **§Snapshot.4 priority #1 updated** — Sprint 12 CLOSED / Sprint 13 OPEN. Priorities #7–12 (intent build) re-tagged as Sprint 13 Lane C.
- 🔄 **Snapshot.1 unchanged** — no implementation moved this close (Lane A hardened existing infra; Lane C added dashboards pending real traffic). Moves when Sprint 13 Lane C (FOLLOW-099/100) lands.

**Changelog v2.7 (25 maja 2026 — Adaptive Listings v1.0 Sprint 13-14 plan):**

- ✅ **§D.6 dodane** — Archetype Coverage Matrix: 18 archetypów × 3 źródła sygnałów (behavioral/quiz/chat NLP), status 🟢/🟡/🔴 per archetype. 5 archetypów (commercial_investor, diaspora_buyer, student_parent, golden_visa_buyer, retiree_relocator) oznaczone 🔴 None — residential app.estalara.com nie ma behavioral signals dla tych archetypów (chat-only path).
- ✅ **§D.1.1 dodane** — Mapowanie 12-dim intent vector → archetype posterior update. Specyfikacja `CHAT_INTENT_LIKELIHOODS` + `applyChatIntentPrior()` function. Schema TBD pending FOLLOW-087.
- ✅ **§D.7 dodane** — Confidence & Fallback Policy: thresholds, source weighting, conflict handling, neutral fallback. Thresholds TBD pending FOLLOW-100 calibration.
- ✅ **§D.8 dodane** — Privacy & Consent dla behavioral/chat signals (photo.dwell, mortgage_calc.used, chat NLP personalization = anonymized behavioral per DECISIONS D3, nie PII).
- ✅ **§D.9 dodane** — Observability Requirements dla intent pipeline (signal-received → posterior-updated → archetype-selected → directive-applied).
- ✅ **§C.1 zaktualizowane** — dodana kolumna "SDK Producer Status" (✅ Active / 🔧 Schema-only / 📋 Planned) do tabeli signal taxonomy.
- ✅ **§C.4 dodane** — Intent Pipeline Event Contracts (behavioral event schemas, chat.intent.detected = TBD pending FOLLOW-087).
- ✅ **§B.1 zaktualizowane** — quiz ON/OFF toggle dokumentacja: `SdkConfig.quiz.enabled`, `trigger_after_n_listings`, Supabase `tenants.quiz_enabled` jako primary SoT.
- ✅ **§E.2.3 dodane** — app.estalara.com Slot Mapping: 5 TextDirective slotów (headline, description, features, cta-primary, cta-live). AI Vision (L5) + `ANTHROPIC_API_KEY` już w Doppler → zero ręcznych markerów. photos/listings-grid ReorderDirective deferred → FOLLOW-104.
- ✅ **§B.5 zaktualizowane** — usunięty stały wpis o `ANTHROPIC_API_KEY` blokerze. Potwierdzone w Doppler 2026-05-25.
- ✅ **§Snapshot.4 zaktualizowane** — priorytety #7–#12 zastąpione spójnym Sprint 13-14 feature set (FOLLOW-099/100/101/102/103/087).
- 📋 **FOLLOW-099/100/101/102/103 dodane** do `backlog/FOLLOW_UPS.md` — pięć nowych stubów Sprint 13-14.
- 🔄 **Snapshot.1 bez zmian** — implementacja nie zmieniła się. Status zmieni się gdy FOLLOW-099/100 wylądują.
- 🔄 **Nota: FOLLOW-088/089/090** (z FOLLOW-079 cancellation) = format fix, Python CI fix, Rule I unblock — nie mylić z nowym feature set.

**Changelog v2.6 (25 maja 2026 — chat NLP model selection decision):**

- ✅ **§C.3 zaktualizowane** — dwutierowa architektura modeli dla chat NLP: Haiku 4.5 (`claude-haiku-4-5-20251001`) dla real-time (<500ms per wiadomość) + Sonnet 4.6 (`claude-sonnet-4-6`) dla batch enrichment (6h async, pełny kontekst konwersacji). Uzasadnienie: latency budget real-time path wyklucza Sonnet; batch path nie ma limitu czasowego — Sonnet daje wyższą accuracy na wieloturowych konwersacjach i mixed-language input (EN/PL/ES). Oba modele używają identycznego output schema (12-dim intent vector §D.1). Model jest parametrem konfiguracyjnym (`INTENT_REALTIME_MODEL`, `INTENT_BATCH_MODEL`), nie hardcoded.
- ✅ **§D.2 zaktualizowane** — dodano dwa nowe wiersze "Chat NLP real-time" i "Chat NLP batch enrichment" do tabeli model serving.
- ✅ **§I.3 zaktualizowane** — "Intent extraction z chatu" rozdzielone na dwa wiersze (real-time / batch enrichment).
- 📋 **FOLLOW-087 dodane** do `backlog/FOLLOW_UPS.md` — stub implementacji chat NLP w `apps/intent-engine` z zablokowaną decyzją modelową. Rekomendowany Sprint 13 (po Sprint 12 pilot launch).
- 🔄 **Snapshot.1 row D bez zmian** — decyzja modelowa nie zmienia statusu implementacji (`apps/intent-engine` = 27-line placeholder). Status zmieni się gdy FOLLOW-087 wyląduje.

**Changelog v2.5 (24 maja 2026 — Sprint 12 open, pilot launch on app.estalara.com):**

- ✅ **Sprint 12 OPEN** — AI Council Checkpoint 2026-05-24 approved "controlled pilot launch on app.estalara.com" as Sprint 12 scope. Session: `~/ai-council/sessions/20260524_224944`. Decision memo: `docs/ai-council/CHECKPOINT_2026-05-24_SPRINT_12.md`.
- 🚀 **Three-lane structure:** Lane A (pilot-critical hardening — FOLLOW-081 ClickHouse integration test, FOLLOW-075 VERCEL_CRON_SECRET enforcement, FOLLOW-078 DSR failure alerting; ~~FOLLOW-079 demo CI fail-loud CANCELLED 2026-05-25~~ → split FOLLOW-088/089/090 Sprint 13 P2) gates Lane B (app.estalara.com onboarding via Magic Link + shadow mode). Lane C (CTA lift dashboard + inquiry starts tracking) runs in parallel with Lane B.
- 🎯 **Pilot parameters locked:** Target = app.estalara.com (own domain). Free pilot (no billing infrastructure needed). EU region (infrastructure verified via FOLLOW-081; full multi-jurisdiction compliance deferred). Incident owner = Piotr Nawrocki. Primary metric = CTA lift. Secondary metric = inquiry starts. VERCEL_CRON_SECRET provisioned in Vercel + Doppler 2026-05-24.
- 🔄 **§Snapshot.1 update** — Sprint 12 OPEN entry appended to Updates block. Snapshot.1 date updated to 2026-05-24.
- 🔄 **§Snapshot.4 priority #1** — Sprint 12 definition replaces Sprint 11 CLOSED notice.
- 📐 **No new ADR.** Sprint 12 uses existing canonical adapt endpoint (ADR-0004).

> **READING ORDER (v1.8 update).** This document remains the canonical *strategic vision* + *target architecture*. As of 2026-05-16 a multi-agent audit was performed against the actual codebase. The audit findings — what is built, what is partial, what is design-only — are summarized in the new section **"Implementation Status Snapshot (2026-05-16)"** below the Executive Summary, and in detail in `AUDIT_REPORT_INVESTOR_READINESS.md`, `AUDIT_IMPLEMENTATION_MAP.md`, `AUDIT_RISK_MATRIX.md`, and `AUDIT_TEST_GAPS.md` at the repository root. Where this document and the audit disagree, the audit reflects reality at HEAD `398dc97`.

**Changelog v2.4 amend (24 maja 2026 — Sprint 11 close, RETRO-007 reconciliation):**

- 🔄 **§Snapshot.1 row B.4 updated (Edit M-12)** — Auto-Onboarding UI gap (c) end-to-end
  integration test now structurally closed: PR #137 (FOLLOW-068) provisioned the
  `demo-integration` CI job; soft-skips until DOPPLER_TOKEN_DEV + E2E_BEARER_TOKEN provisioned
  (ESC-009 carry-forward).
- 🔄 **§Snapshot.1 row F updated (Edit M-13)** — Sprint 11 FOLLOW-063 (PR #135) shipped the
  `archetype-embeddings-not-null` CI precheck + `post-migrate-seed.yml` idempotent auto-seed.
  Once ESC-009 / FOLLOW-040 escalation resolves, cosine path is CI-enforceable.
- 🔄 **§Snapshot.1 "Updates" prose (Edit M-14)** — appended Sprint 11 close summary listing all
  5 P1 pilot-blockers DONE, 0 new HALF_WIRE findings (second consecutive net-closure sprint),
  and RETRO-007's 11 surfaced FOLLOW-UPs (075–085).
- 🔄 **§Snapshot.4 priority #1 (Edit M-15)** — struck through "Sprint 11 OPEN — close pilot-
  blockers" and replaced with Sprint 11 CLOSED status + next-priority pointer to ESC-009 +
  FOLLOW-040 escalation + Sprint 12 top picks.
- 📐 **CONVENTIONS_PATCH.md unchanged** — no new Rule promotion this retro; Rule H amendment
  (2026-05-23) held cleanly across all 5 Sprint 11 PRs; Rule J live (PR #128, Sprint 10) but
  untouched this sprint.
- 📝 **No new ADR.** ADR-0004 (canonical adapt endpoint) and existing ADRs still apply.
- 📝 **Master Design version header refined** — "Sprint 11 in flight" → "Sprint 11 close" with
  explicit pointer to ESC-009 + FOLLOW-040 as the remaining operational blockers.

**Changelog v2.4 (24 maja 2026 — Sprint 11 in flight, FOLLOW-039 ClickHouse DSR hard-delete):**

- ✅ **§H.1 row "Data Subject Rights" updated** — was a TBD-style entry citing a
  hypothetical `DELETE /v1/sessions/{session_id}` endpoint that did not exist.
  Now describes the actual three-endpoint OTP flow (`initiate` / `access` /
  `erase` / `portability`) and the synchronous Postgres delete +
  asynchronous ClickHouse `ALTER TABLE ... DELETE WHERE` flow shipped by
  FOLLOW-039.
- ✅ **§H.1.1 added** — "Realistic erasure semantics (Art. 17, FOLLOW-039)"
  documents the data inventory (4 erased tables, 2 retained tables), the
  Vercel-Cron polling pattern (`/api/dsr/mutation-poll`, every 5 min), the
  retry-with-exponential-backoff strategy (1 min → 5 min → 30 min, max 3
  retries), idempotency via the new `dsr_clickhouse_mutations` Postgres
  operational table, and SLA reasoning.
- ✅ **§W.7.3 updated** — pre-FOLLOW-039 wording described a "daily cron"
  design that did not match the codebase. Now references §H.1.1 as the
  authoritative flow and clarifies retention for both audit tables.
- 🔄 **§Snapshot.1 row H updated** — RODO Art. 17 ClickHouse hard-delete P0
  open item closed. EU pilot gate now passable.
- 📦 **New artefacts:** `apps/control-plane/src/lib/clickhouse-dsr.ts` (SQL
  builder + poll + retry helpers), `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts`
  (Vercel Cron handler), `infra/clickhouse/migrations/0011_dsr_audit_log_clickhouse_mutation.sql`
  (audit-log columns), `packages/db/migrations/0014_dsr_clickhouse_mutations.sql`
  + Drizzle schema (operational state table), Vercel Cron registered in
  `apps/control-plane/vercel.json`.

**Changelog v2.3 (24 maja 2026 — Sprint 10 close, RETRO-006 reconciliation):**

- 🔄 **§Snapshot.1 row B.4 updated** — Auto-Onboarding UI: gap (b) listing-embedding seeding
  partially closed via PR #132 (FOLLOW-046 — DEMO_LISTING_MANIFEST seeds demo tenant on
  activation). Non-demo tenant auto-seed still pending. Gap (c) e2e integration test partially
  closed via PR #130 (FOLLOW-055 — spec shipped, opt-in behind `NEXT_PUBLIC_TEST_E2E=true`, CI does
  not yet run it). Gap (a) Magic-Link email still BLOCKED (TICKET-040).
- 🔄 **§Snapshot.1 row E.1–E.3 updated** — Both Sprint 9.5 half-wires CLOSED: FOLLOW-041 (SDK
  feedback ping, PR #127), FOLLOW-042 (SDK variant consumer, PR #127). Feedback endpoint auth
  hardened to HMAC-SHA256 in PR #133 (FOLLOW-051). Bandit feedback loop end-to-end wired. Note:
  the bandit *selection* is still keyed against seeded `ab_bandit_weights` rows; cosine-affinity
  conditioning on archetype embeddings awaits FOLLOW-063 (LG-1 closure).
- 🔄 **§Snapshot.1 row F updated** — FOLLOW-043 (PR #131 + 6 fix commits) ships
  `pnpm seed:archetypes` script and a manual `workflow_dispatch` GitHub Action. The script CAN
  populate archetype vectors. **No CI step or on-merge automation runs the seed automatically.**
  For any fresh DB pull, `archetype_embeddings.embedding` remains NULL until an operator runs the
  workflow — same effective state as Sprint 9.5 close, with an operator-runnable remedy. FOLLOW-063
  tracks the auto-seed enforcement.
- 🔄 **§Snapshot.1 row V.1 updated** — PR #133 added §V.3.2 threat model for `POST
  /api/adapt/feedback` (HMAC-SHA256 tenant-scoped signing). Broader §V.1 verdict unchanged
  (🟡 Partial — SBOM, MFA enforcement, full CSP still design-only); the §V.3.2 reference is the
  delta.
- 🔄 **§Snapshot.1 prose update** added at the bottom of the existing Updates block covering
  Sprint 10 close.
- 📐 **CONVENTIONS_PATCH.md Rule J is LIVE** — PR #128 (FOLLOW-052) shipped `scripts/check-mirror-
  files.sh` + JSON manifest + `rule-j` CI job + pre-push lefthook. Mirror-code byte-identity is
  now hard-gated for `bandit.ts` and `reorder.ts` pairs.
- 📐 **OP §Y.3 (Snapshot.1 re-verification at sprint close) is LIVE** — PR #134 (FOLLOW-061)
  codified the obligation in `docs/AGENT_WORKFLOW.md` Sprint-close checklist + the PM-orchestrator
  agent prompt. RETRO-006 §7 is the first execution.
- 📝 **No new ADR.** ADR-0004 (canonical adapt endpoint) and existing ADRs still apply.

**Changelog v2.2 (23 maja 2026 — Sprint 10, FOLLOW-061):**

- 📝 **§Snapshot.1 forward reference updated** — replaced "Per OP §Y.3 the next Snapshot.1
  re-verification is at Sprint 10 completion" with an explicit pointer to the sprint-close
  checklist in `docs/AGENT_WORKFLOW.md` where the obligation is now structurally enforced.
- 📝 **`docs/AGENT_WORKFLOW.md` updated** — added "Sprint-close checklist" section with four
  mandatory steps, the last being Snapshot.1 re-verification per §Y.3. This closes the process
  gap that caused Sprint 9.5 rows B.4 and J to go stale (RETRO-005 §7 Edits M-1..M-6).
- 📝 **`.claude/agents/pm-orchestrator.md` updated** — added step 8 "Sprint close" with
  Snapshot.1 re-verification as a mandatory sub-step, so the PM orchestrator executes it
  automatically at every sprint close.
- 📐 **§V.3.2 added (PR #133)** — Threat model for `POST /api/adapt/feedback` HMAC-SHA256 auth.

**Changelog v2.1 (22 maja 2026 — Sprint 9.5 close, RETRO-005 reconciliation):**

- 🔄 **§Snapshot.1 row B.4 updated** — Auto-Onboarding UI promoted from ⛔ Blocked to 🟢 Mostly
  Shipped. Sprint 9.5 merged PR #121 (Schema Discovery API), #124 (Magic Link wizard UI), #125
  (Detection Preview + activation), #126 (cache invalidation). Operator can paste URL → detect →
  preview → activate → receive SDK snippet end-to-end. Three open gaps listed in the row.
- 🔄 **§Snapshot.1 row J updated** — corrected the stale "TenantConfig with `auto_detected_schema`"
  claim. The canonical store is the dedicated `tenant_site_schemas` table, not a field on
  `tenants`. The QUEUE.md Sprint 9.5 preamble flagged this; Sprint 9.5 hardened the contract
  around the dedicated table but the Snapshot row was not updated until now.
- 🔄 **§Snapshot.1 row E.1–E.3 updated** — bandit variant selection now wired into canonical
  `POST /api/adapt` (PR #122). Two half-wires remain documented inline (FOLLOW-041 SDK feedback
  ping, FOLLOW-042 SDK variant consumer).
- 🔄 **§Snapshot.1 row F updated** — clarified that `archetype_embeddings` has 18 rows but every
  `embedding` column is NULL. FOLLOW-019's cosine path is unreachable in production today; djb2
  fallback always wins. FOLLOW-043 tracks the embedding population task.
- 🔄 **§Snapshot.1 prose update** added at the top of the snapshot covering Sprint 9.5 close.
- 🔄 **§Snapshot.4 priority #5** struck through (Sprint 2.5 unblock superseded by Sprint 9.5 close);
  new priorities surfaced (FOLLOW-041/042/043).
- 📝 **No new ADR** issued; ADR-0004 (canonical adapt endpoint) and existing ADRs still apply.
  Proposed ADRs FOLLOW-045 (decision-api/lib/bandit.ts disposition), FOLLOW-050 (Redis cache vs
  multi-region staleness), FOLLOW-051 (feedback endpoint auth threat model) are tracked.

**Changelog v2.0 (20 maja 2026 — Sprint 7.5 reconciliation + Document Governance Policy):**

- 🔄 **§Snapshot.1 row B.5 updated** — Schema Discovery Pipeline. Previously "🟡 Partial — L1/L2/L4/L5 work; L3 platform templates no-op". Now reflects Sprint 7.5 reality: 11 deterministic auto-detect techniques on `main` (data-estalara, json-ld, data-attributes, mui-components, article-tag, css-modules, css-in-js, angular, wordpress, drupal-php) + AI Vision fallback wired end-to-end via `apps/control-plane/src/app/api/detect/route.ts`. Corpus CI gate 100/100 precision/recall on 24 platforms (240/240 samples) since 2026-05-13. The only production blocker is `ANTHROPIC_API_KEY` empty in Doppler (dev/stg/prd) — a config issue, not a code gap. L3 (platform templates) remains no-op but de facto replaced by L1+L2 coverage.
- 🔄 **§Snapshot.1 row B.4 disambiguation** — Auto-Onboarding remains ⛔ Blocked, but the row text now explicitly distinguishes "Auto-Onboarding UI flow" (Sprint 2.5 — Magic Link wizard, Vision Modal, Schema Discovery API; UI BLOCKED) from "Auto-Detection Engine itself" (Sprint 7.5 — see §B.5, Mostly Shipped). Multiple prior sessions conflated the two.
- ✨ **Added §Y "Document Governance Policy"** (new top-level section, appended after §X "Sprint 1.5 Hardening Mini-Sprint"). Codifies how Master_Design stays in sync with `CLAUDE.md`, `AGENT_WORKFLOW.md`, subagent prompts, audit reports. Eliminates "stale version reference" as a class of problem. References `docs/ops/OPERATING_PRINCIPLES.md` v1.1.
- ✨ **Referenced `docs/ops/OPERATING_PRINCIPLES.md` v1.1** from §Snapshot.1 introduction. Operating Principles are the 5 fundamental rules every session applies; codified after the 2026-05-20 anti-pattern (6-hour POC duplicated existing repo code).
- 📝 **Anti-pattern of record (2026-05-20):** A session spent 6 hours building `estalara-demo-v0.3.x` (6 versions, 1245 lines JS) that duplicated functionality already shipped in `packages/sdk/src/auto-detect/techniques/` (4,329 LOC, 11 techniques, 100/100 corpus precision). Root cause: `CLAUDE.md` in repo root pointed to "Master Design v1.1 (2026-04-26)" while actual MD was v1.9 from 2026-05-17, and the session booted from the stale mental model and never recovered. Operating Principles v1.1 + this version's §Y Document Governance Policy are the structural fix.

**Changelog v1.9-D (17 maja 2026):** Dodano §A.1.5 "TypeScript Edge Engine — runtime intelligence layer". Sekcja dokumentuje rzeczywisty runtime warstwy inteligencji adaptive: in-browser Bayesian classifier (~600 LOC), edge holdout gate (Cloudflare Worker), canonical adapt route (Next.js). Zawiera honest limitations dotyczące pokrycia sygnałów behawioralnych (4/37), bandit thompsonSample wiring (FOLLOW-007), cross-tab persistence (czekająca na apps/intent-engine), chat-driven adaptation (post-MVP roadmap).

**Changelog v1.9-C (17 maja 2026):** §B.2 SDK bundle budget updated — honest disclosure that current 93.3 KB IIFE exceeds <40 KB target. Added context (raw/gzip/brotli), explanation (single bundle includes Tier 1 + Tier 2), and remediation plan (split entry points, TICKET-038).

**Changelog v1.9-B (17 maja 2026):** Retired false multi-region deployment claim. EU only (`eu-central-1`) is active today; US/UK/UAE deployment is post-seed roadmap (available on customer demand). Affected sections: §A.3 (Multi-region deployment — retitled "Region strategy" and reframed as EU-first today with post-seed expansion plan), §H (header retitled "Compliance & Privacy — Multi-Jurisdiction" to clarify the regulatory-readiness intent), §I.2 (Supabase row softened to remove "multi-region projects" claim), §L.2 (pricing rationale "multi-region z dnia 1" → "EU-first z dnia 1; multi-region post-seed"), §S (strategic summary "multi-region SaaS" reframed as "EU-first SaaS with multi-region roadmap"). §A.1 diagram and all vendor-capability descriptions (Redpanda, Upstash, R2 native features) untouched. This is change B of 4; sections §A.4 onward and other untouched material from v1.9-A remain unchanged.

**Changelog v1.9-A (17 maja 2026):** §A.1 diagram updated — removed 3 deleted Modal stubs (`apps/archetype-pipeline`, `apps/adaptation-engine`, `apps/auto-detect`), added **TypeScript Edge Engine** as a 1st-class component (in-browser SDK intent classifier + edge holdout gate + canonical adapt route). Modal services list trimmed to the 4 that remain (`llm-gateway`, `data-quality`, `intent-engine` to-build, `stream-consumer`). See ADR-0004 (canonical adapt endpoint) and ADR-0005 (Modal apps disposition). This is change A of 4; sections §A.2 onward are untouched in this revision.

**Changelog v1.8 (16 May 2026 — Implementation Status Reconciliation):**

- 📊 **Added "Implementation Status Snapshot (2026-05-16)"** section directly after the Executive Summary. Snapshot is a per-feature audit verdict (`✅ Shipped`, `🟡 Partial`, `🟥 Design-Only`, `⛔ Blocked`) backed by file-level evidence from a multi-agent audit. See `AUDIT_REPORT_INVESTOR_READINESS.md` for the deep dive.
- 📝 **Strategic vision in sections A–W remains intact and authoritative for direction.** Implementation deltas relative to v1.7.1 are NOT inlined into each section to preserve the strategic narrative; they are consolidated in the Snapshot section + the four root-level audit reports. Future ticket work should target closing the gaps in `AUDIT_REPORT_INVESTOR_READINESS.md` §11 (Recommendations).
- 🔍 **Verified architectural drift documented in the Snapshot:**
  - The four Modal Python services (`apps/intent-engine`, `apps/archetype-pipeline`, `apps/adaptation-engine`, `apps/auto-detect`) named as the differentiator's home in §A.1 are all 13–27-line placeholders. The real intent / archetype / adaptation logic currently lives in `packages/sdk/src/core/intent.ts` (in-browser Bayesian) + `apps/decision-api/src/lib/` + `apps/control-plane/src/app/api/adapt/route.ts`. **This is a documented architectural pivot from "Modal-hosted ML" to "TypeScript-edge + Modal-async-jobs", not yet a backlog gap.** §A.1 diagram has not been updated to reflect this; either the code must converge to the diagram (build Modal ML) or the diagram must converge to the code (acknowledge TS-edge engine).
  - Two parallel `/api/adapt` endpoints exist — a Cloudflare Worker (`apps/decision-api`) returning 3 hard-coded archetype buckets (`investor`/`family`/`neutral`), and a Next.js route (`apps/control-plane`) returning the full 18-archetype playbook + LLM tweak/full. The SDK calls whichever URL the tenant configures. Route divergence is a tracked architectural risk.
- 🟡 **Verified MVP-blockers (P0):**
  - `packages/platform-templates/src/templates/index.ts` exports `[]` — Layer 3 of the Schema Discovery Pipeline (§B.5.3) is currently a no-op for every site. TICKET-032 still BLOCKED.
  - Sprint 2.5 (Auto-Onboarding) — 4 of 6 tickets BLOCKED. Magic Link wizard (TICKET-030 READY), Vision Auto-Detect Modal (TICKET-033), Schema Discovery API (TICKET-034) not started. **Without these there is no path to the "self-serve onboarding in <60s" promised in §B.4.**
  - ~~DSR-erase does not hard-delete from ClickHouse — soft-delete audit log only. RODO Art. 17 non-compliance for any EU tenant (FOLLOW-039 P0).~~ **CLOSED 2026-05-24 by FOLLOW-039** — see §H.1.1 for the shipped erasure flow.
  - Doppler CI integration not wired (FOLLOW-040 P0) — staging deploys cannot inject secrets via CI.
  - JWT spoofing / RLS bypass / tenant header spoof / auth gate gaps (FIX-013..019) were patched in Sprint 8, but only after the system had been running with these issues for weeks. Process risk codified in RETRO-002/003.
- 🟢 **Verified strengths (no design gaps):**
  - Ingest worker (§C) is production-shaped: Sentry+OTel double-wrap, HMAC tenant auth, durable-object rate limit, idempotency middleware, REST-proxy Redpanda producer with retries, 1 MB body cap, W3C trace propagation injected as base64 record headers. Substantial.
  - GDPR posture (§H) is the strongest layer: DPIA v2.0 + ROPA + LIA template authored; `tenant_compliance_records` table + LIA CRUD API; DSR endpoints (initiate/access/erase/portability) with OTP / Resend / audit log; consent state gate at Decision API enforced *before* A/B assignment; `consent_required = true` by default on new tenants.
  - SDK Tier 1 Observer (§B.1): production-shaped, Shadow DOM scope-isolated, 4-event behavioral observer (page.view / scroll.depth / listing.viewed / cta.clicked), Bayesian intent classifier in-browser, quiz widget, consent banner.
  - A/B holdout + Thompson bandit (§E.3): 10% holdout enforced, HMAC(tenant_id, session_id) deterministic assignment, fair-housing-safe (no user attributes used). Bandit *math* shipped and tested; bandit-driven *variant selection per request* still open (FOLLOW-007).
  - Continuous schema validation (§B.6): daily Modal cron at 02:00 UTC with drift detection, Redpanda emission to `estalara.schema`, Sentry 24h dedup. Real (526 LOC).
  - Auto-Detection pipeline (SDK side, §B.5.1/5.2/5.4/5.5): 10 deterministic techniques in `packages/sdk/src/auto-detect/techniques/` + AI Vision fallback wired to Claude Sonnet 4.6 via `apps/control-plane/src/app/api/detect/route.ts`. 100/100 precision/recall on 24-platform corpus (CI gate).
  - LLM description warmer (§E.7): real 668-line Modal job, anti-hallucination WHITELIST, `<verified_facts_used>` audit trail, full mock-based test coverage.
- 📐 **Section renumbering preserved.** §A–§W structure unchanged from v1.7.1.

---

## Implementation Status Snapshot (2026-05-24; §Snapshot.1 per-section verdicts refreshed 2026-07-09 — FOLLOW-470)

> This snapshot is a verdict on each Master Design promise as of HEAD `main`. It is the _only_ place
> in this document where implementation status is asserted; sections A–W speak in the present tense
> about the _target_ architecture, not the current code. **The §Snapshot.1 per-section verdict table
> below was re-verified against HEAD on 2026-07-09 (FOLLOW-470); the prose "Updates" chain and the
> "Audit gate status at audit time" sub-table remain historical (dated as written). §Snapshot.2/.3/.5
> narrative snapshots are NOT yet re-verified and still cite pre-2026-07-01 state (e.g. §Snapshot.2
> lists `intent-engine` as a 27-line placeholder and `archetype-pipeline`/`adaptation-engine` apps
> that no longer exist) — a follow-up refresh is warranted.**
>
> **Updates 2026-05-21:** Sprint 9 COMPLETE (all 6 GDPR tickets DONE). Sprint 7.5 COMPLETE
> (auto-detection 100/100 corpus, AI Vision wired). Krok A merged (PR #119) — Master_Design v2.0 +
> Operating Principles v1.1 + CLAUDE.md sync. Krok B completed — `ANTHROPIC_API_KEY` activated in
> Doppler dev/stg/prd, AI Vision fully operational. Krok C AI Council Checkpoint completed —
> Sprint 9.5 (MVP Demo Readiness) defined and OPEN with 6 tickets: TICKET-033 (Schema Discovery
> API), TICKET-030 (Magic Link wizard UI), TICKET-AUTO-006-POLISH (Preview + Save & Activate),
> FOLLOW-018 (real tenant schema lookup), FOLLOW-007 (Thompson sampling wire-up, Opus 4.7 xhigh),
> FOLLOW-019 (real archetype-listing affinity, Opus 4.7 xhigh). Sprint 2.5 SUPERSEDED —
> TICKET-030/033 promoted to Sprint 9.5, TICKET-034/036 deferred, TICKET-032 cleanup deferred.
> FOLLOW-039 (ClickHouse DSR hard-delete) deferred to Sprint 11 per Q7 2026-05-21 (no EU pilot in
> 4-6 weeks). Per OP §Y.3, this Snapshot.1 will be re-verified at Sprint 9.5 completion. Per
> Operating Principles Rule 1, this snapshot is the SoT for "what is built today" — sections A–W
> remain target architecture.
>
> **Update 2026-05-22 (Sprint 9.5 close — RETRO-005):** Sprint 9.5 COMPLETE — 6 PRs merged
> (#121, #122, #123, #124, #125, #126). Auto-Onboarding UI end-to-end demoable on
> `app.estalara.com` and any new tenant (paste URL → detect → preview → activate → snippet).
> Bandit variant selection wired in canonical adapt route. Cosine archetype-listing affinity
> wired with djb2 fallback. **Open gaps surfaced by RETRO-005 that affect demo narrative
> honesty:** FOLLOW-041 (SDK feedback ping), FOLLOW-042 (SDK variant consumer), FOLLOW-043
> (archetype embedding vectors NULL → cosine path unreachable), FOLLOW-046 (listing embedding
> auto-seed), FOLLOW-055 (end-to-end integration test). See RETRO-005 §3 for the wiring audit
> findings and §7 for the Master Design edits applied. Sprint 10 Snapshot.1
> re-verification was performed at sprint close per the mandatory checklist in
> `docs/AGENT_WORKFLOW.md §Sprint-close checklist` (step 4), installed by FOLLOW-061.
>
> **Update 2026-05-23 (Sprint 10 close — RETRO-006; Sprint 11 OPEN):** Sprint 10 COMPLETE — 8 PRs
> merged (#127, #128, #129, #130, #131, #132, #133, #134). Closed all 4 P0/P1 half-wires from
> RETRO-005 (SDK variant + feedback ping, archetype embedding seed, listing embedding auto-seed
> for demo tenant). Hardened feedback endpoint to HMAC-SHA256 (PR #133, FOLLOW-051). Rule J
> mirror-code CI gate live (PR #128, FOLLOW-052). Sprint-close Snapshot.1 re-verification is now
> mandatory (PR #134, FOLLOW-061, OP §Y.3). **Open gaps surfaced by RETRO-006:** FOLLOW-063 (no
> automated archetype-embedding seeding outside manual `workflow_dispatch` — cosine path remains
> unreachable on any fresh DB pull until an operator runs the seed); FOLLOW-068 (E2E integration
> test merged but CI does not run it — guarded behind `NEXT_PUBLIC_TEST_E2E=true`); FOLLOW-069
> (no cross-runtime HMAC compatibility test between SDK and server); FOLLOW-073 (no Master Design
> threat model for `INTERNAL_API_SECRET`). See RETRO-006 §3 for the wiring audit and §7 for the
> Master Design edits applied. **Sprint 11 OPEN (2026-05-23) — 9 tickets, theme: Pilot
> readiness.** Three P1 pilot-blockers (FOLLOW-063 seed CI, FOLLOW-068 demo CI, FOLLOW-069 HMAC
> compat test) + FOLLOW-039 (ClickHouse DSR hard-delete — EU pilot gate, non-negotiable) +
> FOLLOW-040 (Doppler CI hygiene) + 4 P2 quality items (FOLLOW-065/071/073/074). Per OP §Y.3 and
> the AGENT_WORKFLOW.md sprint-close checklist, the next Snapshot.1 re-verification is at Sprint
> 11 completion.
>
> **Update 2026-05-24 (Sprint 11 close — RETRO-007):** Sprint 11 COMPLETE — 5 PRs merged (#135,
> #136, #137, #138, #139). All 5 P1 pilot-blockers DONE: FOLLOW-063 (archetype seed CI +
> auto-seed workflow), FOLLOW-068 (demo-integration CI job), FOLLOW-069 (cross-runtime HMAC
> compat + LG-3 regression guard), FOLLOW-040 (Doppler service token + doppler-run wrapper),
> FOLLOW-039 (ClickHouse DSR hard-delete — EU pilot gate cleared; Master Design v2.4 + §H.1.1
> added). Net 0 HALF_WIRE findings; second consecutive net-closure sprint. **Open gaps surfaced
> by RETRO-007:** ESC-009 (E2E_BEARER_TOKEN provisioning) + FOLLOW-040 escalation
> (DOPPLER_TOKEN_DEV provisioning) — both are manual Piotr actions (~20 min total) that unlock
> CI enforcement of FOLLOW-063/068/039. FOLLOW-081 (P1, ClickHouse integration test for
> mutation-poll — blocks EU pilot confidence). FOLLOW-075 (P2, VERCEL_CRON_SECRET enforcement
> on `/api/dsr/mutation-poll`). FOLLOW-078 (P2, DSR failure alerting — regulator-visible at
> pilot). FOLLOW-079 (P2, tighten demo-integration soft-skips after unblock). 4 P2 carry-overs
> from Sprint 11 (FOLLOW-065/071/073/074) remain READY. Per OP §Y.3 and the
> AGENT_WORKFLOW.md sprint-close checklist, the next Snapshot.1 re-verification is at Sprint
> 12 completion.
>
> **Update 2026-05-25 (FOLLOW-105 Wave 1 MERGED — PR #150, §Snapshot.7 risk #1 RESOLVED):** Canonical `/api/adapt` enforcement shipped to main (`bf0585d`). ADR-0006 → ACCEPTED; ADR-0004 contract block replaced with the live `AdaptationDirectives` shape (live-wins). Runtime enforcement: `buildSnippet()` emits `data-decision-url=${CONTROL_PLANE_URL}/api`, SDK Zod-validates the adapt response, Worker `/api/adapt` returns 410 Gone + structured logging, CI Rule H gate (`check-adapt-schema-drift` + Worker-410 assertion) guards re-divergence. `adapt_decision_id` (uuid) added to all response arms + ClickHouse migration 0012; `explainability_id` deferred to FOLLOW-108. §Snapshot.7 risk #1 OPEN→RESOLVED. Worker handler removal → FOLLOW-107 (Sprint 14, after 7-day zero-traffic window — the new structured logging is the signal). Wave 2 (FOLLOW-097 + FOLLOW-106) now unblocked. ESC-011 (CI not triggering) resolved: branch renamed to the `architect/**` agent-prefix for push-CI + Actions budget bumped.
>
> **Update 2026-05-25 (Phase 2 Wave 1 spawned — Scenario D Sequential):** PR #148 audit merged. 5 findings (3 BLOCKERS + 2 RISKS + 1 INFO) surfaced — scope expansion confirmed. CEO ratified Decision 4C (add `adapt_decision_id`, defer `explainability_id` → FOLLOW-108), Decision 5A (include SDK Zod validation in 1b), Decision 6D (sequential FOLLOW-105 → Wave 2 → Wave 3). FOLLOW-105 estimate 12-15h → 15-18h. ADR-0006 PROPOSED → ACCEPTED on Wave 1 merge. ADR-0004 contract block replaced entirely (live wins). FOLLOW-108 + FOLLOW-109 stubs added for Sprint 14. Wave 1 = substeps 1b+1c+1d as one comprehensive PR on `feat/follow-105-1bcd-canonical-adapt-enforcement`. Wave 2 (FOLLOW-097+106) + Wave 3 (FOLLOW-094/098/093) BLOCKED pending Wave 1 merge. §Snapshot.7 risk #1 stays OPEN until FOLLOW-105 completes.
>
> **Update 2026-05-25 (Sprint 13a Lane A — Phase 1 spawned):** FOLLOW-105 substep 1a (SDK config + runtime audit) IN_PROGRESS. Phase 2 (substeps 1b/1c/1d + FOLLOW-106/094/098/093/097) blocked pending CEO review of audit findings. **[BLOCKER] surfaced by 1a:** the embed-snippet generator `buildSnippet()` (`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:97`) emits no `data-decision-url`, so every wizard-onboarded tenant has adaptation silently disabled (SDK `adapt.ts:475` returns null when `decisionApiUrl` is absent). Substep 1c (Worker 410 Gone) is therefore insufficient alone — substep 1b must fix `buildSnippet()` to emit the canonical control-plane host. ADR-0004 response contract is fully drifted from the live `AdaptationDirectives` shape (1 of 9 fields match by name) → substep 1b replaces the contract block (live wins). Worker `/api/adapt` has no per-request logging → 410 Gone must add structured logging. Audit: `docs/audits/FOLLOW-105-1a-sdk-audit.md`. §Snapshot.7 risk #1 stays OPEN until FOLLOW-105 completes.
>
> **Update 2026-05-25 (AI Council ratified Track 1 with changes — Sprint 13a/13b split, Phase-0 specs):** AI Council `20260525_143939` set `APPROVED_TO_IMPLEMENT=false` — no-code spec/audit only until B1–B8 close. Sprint 13 split into 13a (correctness + pilot launch) / 13b (intent build, hard-isolation). Four Phase-0 specs authored (`PILOT_CTA_LIFT_METRIC_v1.md`, `PILOT_FREEZE_RULE.md`, `PILOT_RUNBOOK.md`, `ADR-0006`). FOLLOW-099/103 frozen mid-measurement-window (pilot-tenant-affecting). FOLLOW-105 6h→8-10h + substep split. §Snapshot.7 risk #1 resolution gated on FOLLOW-105 + ADR-0006.
>
> **Update 2026-05-25 (FOLLOW-105 added — canonical /api/adapt P0):** Sprint 13 Lane A expanded with FOLLOW-105 (P0, 6h, opus-4.7-xhigh) — route-divergence resolution gate added before Lane B pilot launch. Authors ADR-0006 ("Canonical /api/adapt Enforcement", follow-on to ADR-0004; ADR-0005 is already Modal Apps Disposition), enforces SDK→control-plane targeting, retires/proxies the Worker route, adds a CI Rule H guard. Lane A now 5 tickets; sprint ~63.5h.
>
> **Update 2026-05-25 (Sprint 12 CLOSED — Sprint 13 OPEN, three-track):** Sprint 12 closed with Lane A hardening + Lane C ROI instrumentation shipped (PRs #142–#146); Lane B pilot onboarding (TICKET-PILOT-001/002) deferred to Sprint 13 because RETRO-008/009 found the Lane C dashboards fabricate metrics on ClickHouse error (Rule K.2) and `inquiry.started` never fires in prod. The pilot did NOT launch. Sprint 13 opens three-track per CEO decision: Lane A correctness (FOLLOW-094/098/093/097) → Lane B pilot launch (PILOT-001/092/PILOT-002, blocked until Lane A) → Lane C intent v1.0 (FOLLOW-099/100/087/101/102/103, parallel with Lane B). RETRO-SPRINT-12 written. Two pre-spawn human actions outstanding: provision DOPPLER_TOKEN_DEV (ESC-010) + E2E_BEARER_TOKEN (ESC-009) secrets, and an AI Council Checkpoint on Track 1 vs Track 2 ordering.
>
> **Update 2026-05-25 (FOLLOW-079 CANCELLED — split into Sprint 13 P2):** FOLLOW-079 (demo-integration fail-loud) cancelled per pm-orchestrator decision — triggered Rule I (105 violations), Python CI matrix bug, and ESC-010 blocked simultaneously. Split into FOLLOW-088 (prettier format fix), FOLLOW-089 (Python CI matrix fix), FOLLOW-090 (Rule I unblock + demo-integration after ESC-010). Lane A reduced to 3 active P1 tickets: FOLLOW-081, FOLLOW-075, FOLLOW-078. Sprint 12 active: 9 tickets + 1 cancelled.
>
> **Update 2026-05-27 (Sprint 13a Lane A COMPLETE — Wave 2+3 merged + YELLOW audit Sprint 1; see Changelog v3.1/v3.2):** Wave 2 (FOLLOW-097 PR #151, FOLLOW-106 PR #152) and Wave 3 (FOLLOW-094 PR #153, FOLLOW-093 PR #154, FOLLOW-098 PR #155, FOLLOW-117 PR #156, FOLLOW-114 PR #157) are all on main — **Sprint 13a Lane A is 8/8 DONE.** The pilot dashboards now fail loud on ClickHouse errors and expose `data_source` provenance (no fabricated lift), the two CTA-lift query paths are reconciled, `inquiry.started` fires for real tenants (selector emitted in both SDK config and the onboarding snippet), and the `pilot_frozen` measurement-window guard is no longer inert. Separately, the **YELLOW audit** parallel track (own `F-NN` numbering) merged Sprint 1 as PR #158 (`6827305`) — cold-start prior wire (F-02), locale-correct copy en/pl/es (F-09), per-tenant/session LLM cost attribution (F-10), GDPR LIA in DPIA §13.1/§13.2 (F-13/F-14); tracked under FOLLOW-118/119/120/121. **Snapshot.1 per-section verdicts below are NOT yet re-verified** (these were correctness/launch-readiness fixes, not new target-promise implementation); full re-verification is due at the next sprint close once Lane B pilot launch + YELLOW Sprint 2–4 land. **Pilot go-live now gated on BOTH Lane B (TICKET-PILOT-001/002 + FOLLOW-092) AND YELLOW audit Sprint 2–4 (F-01/04/05/06/07/08 + UX-01 + measurement dashboard).** retrospective-analyst running on PR #153–#158 (RETRO-013→018).
>
> **Update 2026-07-01 (Full-Stack Audit — session 2; Master_Design v4.2):** A second deep end-to-end code audit (8 tracks) re-verified the core against HEAD and **corrected several stale §Snapshot.1 claims in the project's favor**: (D) the intent engine is NOT "3 divergent places" — the 18-archetype set is consistent across all 15 code locations; `apps/intent-engine` is a real 651-LOC Modal service making genuine Haiku calls (no longer a 27-line placeholder); (C) the SDK emits **21 of 46** event types (not 8/37 — FOLLOW-207…211 landed); (E.4) Quiz v2.0 cascading tree is **implemented** (not "impl PENDING"); (H) consent/opt-out §H.8/§H.9 are genuinely wired incl. the real 24h intent-vector TTL, and the always-`legitimate-interest` bug is fixed; the LLM **description** path has real anti-hallucination guards (whitelist + NEUTRAL fit-gate + fail-safe caching). **However, the pilot's measurement + learning loops are silently broken in prod** by wiring/deploy/config gaps: `intent_events` count=0 (CH migration 0015 not applied → F-02), feedback endpoint 503-gated → bandit frozen at Beta(1,1) (F-06), POST /api/adapt is demo-JWT-only → real API keys 401 (F-05), the real-time chat→NLP path is code-complete but **dead in prod** (stream-consumer never deployed → F-03), per-archetype lift is starved (holdout logged as `neutral` → F-08), and the dashboard UI renders fabricated zeros on error (F-07). Full finding set F-01…F-21. **Remediation plan = `Sprint 22b` in `backlog/QUEUE.md` (FOLLOW-449…471).** The epic's Definition of Done is a **clean re-audit (FOLLOW-471)** — every finding closed with file:line proof (or a CEO-ratified deferral), the differentiator e2e added (§Snapshot.5 gap), baseline gates green — only GREEN closes it. This block supersedes the collapsed per-section verdict table below where they disagree; the table is refreshed by FOLLOW-470.
>
> **Update 2026-07-02 (CEO decisions Q1/Q2/Q3 ratified):** **Q1 (pilot auth model) = BOTH PATHS.** POST /api/adapt must accept a demo-JWT AND a real tenant API key (reuse ADR-0015 `resolveApiKey`); FOLLOW-451 confirmed P0, not deferrable. **Q2 (chat in this pilot) = SHADOW-ONLY.** Live chat→archetype adaptation is out of scope for this pilot; FOLLOW-458 downgraded P1→P2 fast-follow — the shadow stream-consumer code is kept (deploy deferred, not deleted). **Q3 (measured vs showcase pilot) = MEASURED.** FOLLOW-450 (feedback/bandit loop), FOLLOW-452 (per-archetype holdout logging), FOLLOW-453 (dashboard fail-loud, no fabricated zeros) are confirmed P0/P1 go-live blockers. Separately, FOLLOW-449's code/CI/docs leg (de-silencing + contract test) merged (PR #413, `18367d3`); its prod-apply leg (CH migration 0015 attest+apply) remains an OPERATOR action tracked on the pilot go-live checklist in `backlog/STATUS.md`, not silently closed. Full decision record in `backlog/QUEUE.md` Sprint 22b ticket notes.
>
> **Update 2026-07-09 (FOLLOW-470 — §Snapshot.1 per-section verdict refresh; Master_Design v4.3):** The collapsed per-section verdict table was ~5 weeks stale (header dated 2026-05-24, pre-2026-07-01-audit). This pass grep-verified each row against HEAD and corrected the ones that drifted (rows **A.1, B.1, B.2, C, D, E.1–E.3, E.4, E.7, H**; details in Changelog v4.3). Net truth deltas: the description pipeline is now IMPLEMENTED + LIVE in prod (E.7), the Quiz v2.0 tree is IMPLEMENTED (E.4), the SDK bundle is UNDER its (raised, 42 KB) budget (B.2), and `intent-engine` is a real Modal service (A.1/D). The counter-truth the table now states honestly: the bandit feedback loop is wired in CODE but the prod feedback endpoint remains operator-gated → **frozen at Beta(1,1) in prod** until an operator flips `FEEDBACK_ENDPOINT_ENABLED` (E.1–E.3, CODE-VS-PROD axis / Rule AA; FOLLOW-450 operator leg). §Snapshot.6 rule-count corrected (8→27). This block, plus the 2026-07-01 audit block above, supersede any residual stale wording in §Snapshot.2/.3/.5, which were out of FOLLOW-470's scope and still await their own refresh. No new decisions ratified — truth-reconciliation only.
>
> **Update 2026-07-11 (FOLLOW-568 — Estalara backend host RENAMED `api.estalara.com` → `api.app.estalara.com`):** The Estalara-app Spring backend (listing-details / description-grounding source, ESC-018/ESC-019) was renamed by the Estalara infra side ~2026-06-30 (Let's Encrypt cert for `api.app.estalara.com` issued 2026-06-30; the old `api.estalara.com` host stopped being routed — Traefik default cert + universal 404 observed 2026-07-11). Verified live: `GET https://api.app.estalara.com/api/v1/listing/details?listing-uuid=…` answers with application-level JSON, **no login redirect** (the ESC-019 auth-guard symptom is gone on the new host). Changes applied under FOLLOW-568: Doppler prd `ESTALARA_BACKEND_URL` value updated; **Vercel prod env var ADDED** (it was entirely missing — prod control-plane had been silently defaulting to `http://localhost:8081`, so prod grounding fetches could never succeed from Vercel; fail-safe per FOLLOW-457 meant `template_fallback`, no hallucination risk); `apps/control-plane/.env.example` + `docs/ops/DOPPLER_SECRETS_MATRIX.md` corrected (the matrix also misstated `ESTALARA_DECISION_API_URL` as `api.estalara.com` — actual value is `decision.estalara.com`); §B.4.5 WordPress design-example URL repointed at the canonical `admin.estalara.com/api` host. Historical records (ESC-019, `backlog/sprint-15/FOLLOW-192.md`, PR #196 notes, HANDOFF snapshots) intentionally left verbatim — they describe the host as it was then. Related: FOLLOW-567 (Modal embed-seed → `POST /api/listings/embed` contract mismatch: the Modal job omits `text_fields` claiming the endpoint self-fetches, but the endpoint requires it — every ADR-0016 embed-seed dispatch would 400; fix unblocked by this rename since the endpoint can now fetch listing text from the live backend).

**Update 2026-05-24 (Sprint 12 OPEN — AI Council Checkpoint):** Sprint 12 OPEN — controlled pilot launch on app.estalara.com. AI Council Checkpoint session `~/ai-council/sessions/20260524_224944` approved sprint scope. Three-lane structure: **Lane A** (pilot-critical hardening — FOLLOW-081 ClickHouse integration test against system.mutations, ~~FOLLOW-079 demo-integration fail-loud (CANCELLED 2026-05-25)~~, FOLLOW-075 VERCEL_CRON_SECRET enforcement on `/api/dsr/mutation-poll`, FOLLOW-078 DSR failure alerting) gates **Lane B** (TICKET-PILOT-001 app.estalara.com SDK install + Magic Link activation + shadow mode, TICKET-PILOT-002 activation runbook). **Lane C** (TICKET-PILOT-003 CTA lift dashboard, TICKET-PILOT-004 inquiry starts tracking) runs in parallel with Lane B. **Pilot parameters:** free pilot on own domain, EU region, incident owner = Piotr Nawrocki, VERCEL_CRON_SECRET provisioned. P2 carry-over: FOLLOW-073 (INTERNAL_API_SECRET threat model), FOLLOW-074 (README local dev setup). Per OP §Y.3, Snapshot.1 re-verification at Sprint 12 completion.

**Audit gate status at audit time:**

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ 17/17 packages pass |
| `pnpm lint` | ✅ 0 errors, 3 unused-eslint-disable warnings |
| `pnpm test` | ✅ 26/26 tasks pass (control-plane alone: 37 files / 367 tests) |
| `pnpm build` | ✅ SDK IIFE 93.3 KB (Tier 1+2 budget §B.2: <40 KB → currently 93 KB, **over-budget**) |
| SDK auto-detect corpus | ✅ 100% precision / 100% recall on 24 platforms |
| `rule-h` CI gate (schema-without-consumer) | ✅ enforced |

### §Snapshot.0 — Current stage: localhost-first until FOLLOW-820 reads GO (read before §Snapshot.1)

> **Added 2026-09-13 in v4.12 (FOLLOW-1148, absorbing FOLLOW-1129 + FOLLOW-1197), by CEO decision #1
> of `docs/AUDIT-2026-09-13.md` §8: FOLLOW-820 and the localhost-first path belong in the SoT.** The
> stage, the critical path and the four conditions are DEFINED in §P.0. This subsection states their
> STATUS only, per §Y.3. Re-verify it at every sprint close together with §Snapshot.1.

**The stage.** Localhost is the pre-production substrate; there is no staging (ESC-052 option 2,
§V.6.1). No production step is taken until FOLLOW-820 reads GO. "Works on localhost" means the real
control plane (`/api/adapt` via `llm-gateway.ts`), never the `:9100` mock decision harness.

**The gate today: FOLLOW-820 records no dated GO or NO-GO ruling** (its own AC(2) is open). The
2026-09-13 audit graded the checklist NO-GO and condition 1 "not gradeable either way"
(`docs/AUDIT-2026-09-13.md` §5, "Today's reading").

| # | Condition (§P.0) | Status 2026-09-13 | Evidence |
|---|---|---|---|
| 1 | FOLLOW-819 green — technical (ESC-073) | ⛔ **Not gradeable yet** | Bullets below |
| 2 | FOLLOW-815 consent bundle shipped | 🟡 **Code DONE, operator residue open** | FOLLOW-815 DONE 2026-08-07, PR #688 (`backlog/FOLLOW_UPS.md` FOLLOW-1151 body); residue FOLLOW-706 / FOLLOW-868 (audit §5 row 2a). Audit rows 2b–2e (consent record, proof retention, withdrawal, replay) are FAIL: gate items outside the literal condition |
| 3 | FOLLOW-817 in prod Modal + `MODAL_CHAT_NLP_URL` in the prod ingest Worker + traffic proof | 🟡 **Modal deploy half DONE (2026-08-07); Worker variable and traffic proof open** | FOLLOW-820 condition 3 text; §Snapshot.1 row A.1; FOLLOW-892. Audit §5 row 3: no localhost chat arm exists, and whether condition 1 needs one is CEO decision #6 (open) |
| 4 | FOLLOW-450 prod operator leg flipped with a pasted real weight delta | ⛔ **Operator step pending** | §Snapshot.1 row E.1–E.3; audit §5 row 4 (the bandit arm is inert on LLM branches, FOLLOW-1168) |

**Condition 1, stated by recorded `source`, never by tally** (RETRO-325 §4a LG-5):

- **No run has yet been graded by the current AC(1).** #894 (FOLLOW-1186, `9f19cb55`) made AC(1)
  pass only on a response whose `source` is `llm_tweaked` or `llm_full`, with a non-neutral archetype
  above the server gate and at least one non-`reorder` directive on that same response
  (`evaluateAc1()` in `tests/e2e/follow-819/differentiator-e2e.mjs`). Every green recorded before
  that merge was graded by the retired predicate. That predicate passed on a withheld template `cta`
  and on an LLM outage.
- **The run the backlog calls "6 / 6"** (README §5.9, 2026-08-26T10:06:24Z) recorded an `llm_tweaked`
  source. It cannot be re-graded, because `last-run.json` is `.gitignore`d and was overwritten. Cite
  it as "recorded `llm_tweaked`", not as "6/6".
- **The run matching README §5.6** re-grades to **0 of 3** adapted responses. RETRO-325 re-graded
  the only artefact on disk, matched to §5.6 by inference (FOLLOW-1196).
- **AC(7) cannot fail on the fixture tenant yet.** Its adapted side pools directive counts,
  including the `reorder` that the POST handler appends after `runDecisionTree()` whatever the
  `source`, whenever the tenant has a stored site schema and the request carries `listing_ids`
  (`apps/control-plane/src/app/api/adapt/route.ts:2013-2057`). So it passes with a dead LLM path. Clause 2
  is gradeable from AC(7) alone only after FOLLOW-1196. Until then, read it only from a run green on
  both AC(1) and AC(7).
- **AC(2) carries the fixture caveat (ESC-074 / FOLLOW-1140).** The fixture was completed and
  deliberately diverges from the pilot page. AC(2) proves that a served directive is painted, not
  that a tenant page as authored will adapt. The token half of that gap closed with #860 and #862;
  the slot-declaration half stands (README §0).
- **AC(3):** the first `scoring_path = 'cosine'` row was written on localhost on 2026-09-13 for
  `listing-001…012` (#892, FOLLOW-1191; `backlog/QUEUE.md` session-160 banner). The fixture page's
  listing id is not seeded, so a browser-driven run is still `djb2_fallback` (FOLLOW-1192).
- **AC(5)'s `ctaLift` is non-positive by construction** (synthetic control, `holdoutRate` pinned at
  1.0) and is not graded (ESC-073). The business proof is FOLLOW-1130, which gates efficacy claims,
  not GO.
- **Before the next graded run:** FOLLOW-1200 (harness defaults, and `harnessSha` plus a staleness
  check in the artefact) merged as #898 (`4e553adf`). CEO decision #2 requires the lift to be
  tamper-evident before the next harness run (FOLLOW-1201, P0; §E.3.4), and FOLLOW-1185 is that run
  at HEAD. `backlog/QUEUE.md` holds the operative ticket order. This section does not.

### §Snapshot.1 — Per-section verdict (collapsed)

| § | Section | Verdict | Single-line reason |
|---|---|---|---|
| A.1 | Architektura diagram | 🟡 **Partial / Drifted** | Diagram describes intent, not code, but the drift narrowed (2026-07-01 audit): `intent-engine` is now a real Modal chat-NLP service (Haiku 4.5, FOLLOW-087) and the `llm-gateway` description job is real + live in prod (Modal `estalara-description-generator`, ADR-0016). The `archetype-pipeline`/`adaptation-engine` Modal apps in the §A.1 diagram no longer exist (only `intent-engine`/`llm-gateway`/`stream-consumer`/`data-quality` remain); `stream-consumer` chat-NLP is code-complete but NOT deployed in prod (F-03) — **and it never will be in this shape: that is a DECISION, not a gap (recorded 2026-08-07, FOLLOW-817).** ESC-017 established that Redpanda Cloud Serverless exposes no Pandaproxy, so a deployed `stream-consumer` would have nothing to consume; ADR-0016 replaced the hop with the ingest Worker POSTing chat events straight to the intent-engine Modal endpoint. `modal-deploy.yml` deliberately omits it and says so in its header. Do not re-file its absence as an oversight; re-open only if Redpanda gains a Pandaproxy or the bus hop is redesigned. ⚠️ **CORRECTED 2026-08-07 (FOLLOW-891) against a freshly executed `modal app list`, not against a PR body.** This row previously read _"`intent-engine` itself has ALSO never been deployed (ESC-042 item 1, chat dark since at least 2026-07-24) — FOLLOW-817 adds its CI deploy job, blocked on ESC-053."_ That was true at `fe73e8da` and was falsified the same evening at **21:43 CEST** by the operator step PR #691 itself requested. Probe (2026-08-07, `modal app list --json`, workspace `estalara`): **THREE** deployed apps — `estalara-description-generator` (`ap-ZAP1kNyU93r8YeF41F6XK7`, 2026-07-03), **`estalara-intent-engine`** (`ap-MpUyBq9gCwO5sL79w6X46y`, 2026-08-07 21:43 CEST, state `deployed`) and `estalara-schema-validation` (`ap-YHoXtVM7ZnF5uMbqpRlzbd`, same minute). ESC-053 is **RESOLVED** and `modal-deploy.yml` now carries `deploy-intent-engine` + `deploy-data-quality`. ⚠️ **CODE-VS-PROD (Rule AA): this corrects the DEPLOY axis only.** ESC-042's own closure condition is the **traffic** axis — a `chat_intent` shadow key populated end-to-end in prod — and no such population has been observed (FOLLOW-892 reconciles the three records that disagree about it). Core intelligence still runs in the TS edge (`decision-api`/`control-plane`) + async Modal jobs. §Snapshot.2 narrative still cites the old placeholders — not yet refreshed. |
| A.2 | Multi-tenant model | ✅ **Shipped** | tenants table with RLS, JWT-injected tenant_id, slug-unique. |
| A.3 | Multi-region | 🟥 **Design-only** | Region-routing code exists (`mapCountryToRegion`); only EU region actually provisioned. US/UK/UAE not deployed. |
| B.1 | Integrator experience (~~Tier 1/2/3~~ — Tiers RETIRED, single experience) | 🟡 **Partial** | ⚠️ **Terminology drift flagged (not silently renamed per §Y.2):** the "Tier 1/2/3" model was RETIRED by CEO ruling 2026-06-05 (§E.7 changelog v4.0 — "Adaptive Listings nie ma Tiers; wszyscy tenanci dostają jedno doświadczenie"; the `/api/adapt` `tier` param was renamed to analytics-only `page_context`, 2026-06-25). The §B.1 section body still carries the Tier framing — a documentation rename is warranted but out of FOLLOW-470's docs-reconciliation scope (would touch prose, not just status). Capability today: read-only Observer widget substantial; declarative DOM-slot mutation (headline/cta/description) works via the canonical control-plane `/api/adapt`; the old "Tier 3 Native `<EstalaraListing/>`" remains deferred (P.2). |
| B.2 | SDK perf budget | 🟡 **Under budget, thin headroom** | Budget was raised to **42 KB gzip** (ESC-028, decision recorded). Per the 2026-07-01 audit (F-19), `estalara-sdk.iife.js` is **39.86 KB gzip** (~95% of budget) — under budget but near-zero headroom. FOLLOW-469 (Sprint 22b, P3) tracks recovering headroom via code-split/lazy-load. (The stale "93.3 KB / <40 KB over-budget" figure was an uncompressed-vs-gzip conflation from the 2026-05-24 snapshot.) |
| B.3 | Adapters (Intercom/Drift/Crisp/Idealista/Otodom) | 🟥 **Design-only** | No adapter code in the repo. |
| B.4 | Auto-Onboarding UI (Magic Link wizard / Auto-Detect Modal / API Connect) | 🟢 **Mostly Shipped** | Sprint 9.5 merged 2026-05-22: TICKET-033 (PR #121, `POST /api/detect` JWT+SSRF+wizard response), TICKET-030 (PR #124, `/dashboard/onboarding/detect` wizard UI), TICKET-AUTO-006-POLISH (PR #125, Detection Preview + `POST /api/schema/activate` + SDK snippet), FOLLOW-018 (PR #126, real tenant schema lookup + cache invalidation). Operator can paste URL → detect → preview → activate → receive snippet end-to-end. **Sprint 10 partial closure (RETRO-006):** (b) demo-tenant listing-embedding seeding wired on activation via PR #132 (FOLLOW-046, `DEMO_LISTING_MANIFEST` 12 entries auto-seeded when `tenantId === DEMO_TENANT_ID`); non-demo tenants still need manual `POST /api/listings/embed`; (c) e2e integration spec shipped via PR #130 (FOLLOW-055) and **CI job `demo-integration` provisioned in PR #137 (FOLLOW-068)** — soft-skips until DOPPLER_TOKEN_DEV + E2E_BEARER_TOKEN are provisioned (ESC-009 carry-forward). **Remaining open gaps:** (a) Magic-Link email flow still BLOCKED (TICKET-040); (d) ESC-009 + FOLLOW-040 escalation block CI enforcement of FOLLOW-063 / FOLLOW-068 / FOLLOW-039 cron — code is structurally ready, awaits manual secret provisioning (~20 min Piotr action). **Note:** Auto-Detection Engine itself = §B.5 = Mostly Shipped per Sprint 7.5. |
| B.4.4 | Pre-Built Platform Templates Library (15 starters) | ⛔ **Blocked** | `templates: PlatformTemplate[] = []`. TICKET-032 BLOCKED. |
| B.4.5 | WordPress Plugin | 🟥 **Design-only** | Not started. |
| B.5 | Schema Discovery Pipeline (L1–L5) | 🟢 **Mostly Shipped** | L1+L2 = 11 deterministic auto-detect techniques on `main` (corpus CI 100/100 on 24 platforms, 240/240 samples since 2026-05-13). L4 AI Vision wired end-to-end (`packages/sdk/src/auto-detect/techniques/ai-vision.ts` 364 LOC + `apps/control-plane/src/app/api/detect/route.ts:175` dynamic import + `callAnthropic()`). L3 (platform templates) remains no-op but de facto replaced by L1+L2 coverage. `ANTHROPIC_API_KEY` confirmed in Doppler dev/stg/prd (2026-05-25) — AI Vision (L5) fully operational. Open gap: corpus fixture missing for `app.estalara.com` (FOLLOW-103). |
| B.6 | Continuous Schema Validation | 🟡 **`CODE_COMPLETE_OPERATOR_PENDING`** | 526-LOC Modal cron with drift detection + Sentry dedup — real code, and the ✅ **Shipped** verdict this row carried until 2026-08-07 was correct on the CODE axis only. ⚠️ **CODE-VS-PROD (Rule AA), audit 2026-08-04 F-06 / FOLLOW-817:** ~~`estalara-schema-validation` **has never been deployed to any environment** — `modal app list` for the `estalara` workspace returns exactly ONE deployed app (`estalara-description-generator`, ap-ZAP1kNyU93r8YeF41F6XK7)~~ **— CORRECTED 2026-08-07 (FOLLOW-891), against a freshly executed probe.** Both clauses were true at `fe73e8da` and were falsified at 21:43 CEST the same evening. `modal app list --json` now returns **THREE** deployed apps, including `estalara-schema-validation` (`ap-YHoXtVM7ZnF5uMbqpRlzbd`, created 2026-08-07 21:43:37 CEST, state `deployed`), and a registration probe (`modal.Function.from_name(...).hydrate()`) resolves its `validate_schemas` cron function to `fu-bcbPK7oInhtUrUH2NWTBJw`. `modal-deploy.yml` filtered on `apps/llm-gateway/**` alone until FOLLOW-817. The cron has therefore produced **zero** `schema_validation_history` rows and **zero** drift alerts in its entire life; no selector drift on any tenant page has ever been detected by it. FOLLOW-817 ships the `deploy-data-quality` CI job. ~~its **hard pre-deploy gate currently fails**: the `estalara-secrets` Modal secret carries no `DATABASE_URL`~~ **— CORRECTED 2026-08-07 (FOLLOW-891): ESC-053 is RESOLVED, the operator added `DATABASE_URL` to `estalara-secrets`, and the gate PASSED in run `31212639962`.** (The gate itself is real: `crons/schema_validation.py:209-211` reads `DATABASE_URL` with a non-defaulting lookup and raises `RuntimeError` without it.) This row flips to ✅ **Shipped** only when a scheduled run is observed green in the Modal dashboard AND one `schema_validation_history` row exists in prod Postgres — not when the deploy job merges. **First-run verification (added 2026-08-07 by FOLLOW-891, supplied by FOLLOW-893 / PR #696 — the status and the flip condition above are UNCHANGED):** owner **Piotr Nawrocki (CEO)**, verification date **2026-08-08**, after the 05:00 UTC `Cron Heartbeat (FOLLOW-893)` run. Both facts are read by one command — `doppler run --config prd -- bash scripts/check-cron-heartbeat.sh --job validate_schemas --max-age-hours 26` — which prints the heartbeat age and a `schema_validation_history` digest. Runbook `docs/runbooks/SCHEMA_VALIDATION_CRON.md`; **both the script and the runbook arrive with PR #696, not with this change.** ⚠️ **Read the two conditions independently.** A fresh heartbeat with **zero** history rows does **not** flip this row, and does **not** mean the cron is broken: `apps/data-quality/src/crons/schema_validation.py:411-414` returns early — `if not rows: logger.info("No active tenants with site schemas — nothing to validate"); return` — over a `tenants JOIN tenant_site_schemas WHERE t.status = 'active'`, so a perfectly healthy run writes zero rows when no active tenant has a stored site schema. In that case condition (2) is unmet because there is nothing to validate, not because the cron failed. Nothing in this row should be read as "zero rows ⇒ broken cron". Whether prod has any such tenant is **not yet verified by anyone** and is filed separately by the PM. ⛔ **CORRECTED AGAIN 2026-08-08 (FOLLOW-900) — the deployed artefact could not start, and none of the caveats above were the reason.** The first-run verification named above DID happen, automatically, at 05:34 UTC (Actions run `31241996385`) — and it went **RED**: `schema_validation_history` **0 rows**, `cron_heartbeats` **0 rows** (table present, migration `0037` applied). Root cause read at source, not inferred: `modal app logs estalara-schema-validation` repeated `File "/root/schema_validation.py", line 58` → `from crons.observability import flush_sentry, init_sentry` → `ModuleNotFoundError: No module named 'crons'`. Modal 1.4.2 removed automounting of local Python source (gone since 1.0); because `modal deploy .../crons/schema_validation.py` imports the entrypoint BY PATH its `__package__` is empty, so modal takes the `FILE` branch of its implicit entrypoint mount (`modal/_utils/function_utils.py::FunctionInfo`) and ships ONE flattened `/root/schema_validation.py` with no `crons/` package beside it. Every container died at module import — **before** `init_sentry`, so the failure had no channel anywhere — while `modal app list` kept reporting `deployed`. Same class as ESC-053/FOLLOW-891 one floor down: `deployed` ≠ `running`, and `running` ≠ `importable`. Fix: `.add_local_python_source("crons")` on the image + a hard CI gate (`scripts/check-modal-local-imports.py`) that fails any deployed Modal app importing a local module its image does not declare. **Measured 2026-08-08 09:37 UTC** with the fixed code invoked against prod (`PYTHONPATH=apps/data-quality/src modal run …::validate_schemas`, ephemeral app `ap-9bShpWTbrfKiACiV7a5afo`, exit 0, `Created mount PythonPackage:crons`): prod Postgres now holds **1** `schema_validation_history` row (tenant `cbc51cfa…`, `drift_detected=true`, `coverage_score=0.0`) and **1** `cron_heartbeats` row (`validate_schemas`, `run_detail={"tenant_domain_pairs": 1}`), and the FOLLOW-893 detector went GREEN against prod on `workflow_dispatch`. **This row still does NOT flip, and the flip condition is unchanged** — it is deliberately narrower than what was just measured: a **scheduled** run (02:00 UTC, from the redeployed app) observed green by the heartbeat detector, plus a history row. A manual `modal run` mounts local source from a laptop; it proves the code path, not the deployed artefact. Earliest possible flip: the 02:00 UTC firing after FOLLOW-900 merges and `modal-deploy.yml` redeploys. |
| B.7 | Onboarding metrics | 🟡 **Partial** | Some events emitted; no dashboard yet. |
| C | Signal ingestion / event taxonomy | 🟡 **Partial** | Ingest worker substantial. SDK emits **21 of 46** declared event types (2026-07-01 audit — up from the stale 8/37; the signal-enrichment set FOLLOW-207–211 landed: referrer, device, listing-view rate, favorites, filter payload). The `EVENT_TYPES` tuple (`packages/shared/src/schemas/events/index.ts`) has since grown to **52** entries (FOLLOW-461/RETRO-166 added 6 `adapt.description.*` observability types), so producer coverage is ~21/52 today; several chat/photo/mortgage_calc types remain schema-only. |
| D | Intent Engine (12-dim ontology) | 🟡 **Partial** | Corrected (2026-07-01 audit): the 18-archetype set is **consistent across all ~15 code locations** (NOT "3 divergent places" — that stale claim conflated `archetype_embeddings` seed-count with the ontology). SDK Bayesian classifier real (rule-based, ~600 LOC). `apps/intent-engine` is a **real Modal chat-NLP service** (FOLLOW-087) making genuine LLM calls — NOT a 27-line placeholder. ⚠️ **CODE-VS-PROD (Rule AA), added 2026-08-07 by FOLLOW-891 — this row previously carried NO split and claimed a two-tier "Haiku 4.5 real-time + Sonnet batch" engine in the present tense.** **CODE axis:** both §C.3 tiers exist — the real-time Haiku 4.5 tier (`src/main.py` `process_chat_message`) and the Sonnet 4.6 batch tier (`src/jobs/batch_enrich.py` `batch_enrich_conversations`, `modal.Cron("0 */6 * * *")`). **PROD axis:** the deployed `estalara-intent-engine` app registers **exactly two** functions — probe 2026-08-07, `modal.Function.from_name(...).hydrate()`: `chat_nlp_endpoint` → `fu-lvhrvBFkOJhWYUon9GXkvm` and `process_chat_message` → `fu-ztEu85F1cKenPZVRyIuqH1`; `batch_enrich_conversations` → **`NotFoundError`**. `main.py` never imports `jobs.batch_enrich`, so the 6-hourly batch tier is **not in production and its cron has never fired**. (Sonnet is not wholly absent from prod: `nlp.py:508-509` retries a low-confidence multilingual Haiku extraction on Sonnet inside the real-time tier. That is a retry, not the §C.3 batch tier.) `modal-deploy.yml`'s own comment above the deploy step states the batch tier is not deployed and calls it deliberate — **the executed corpus is right and this document was wrong**. Whether the batch tier is WANTED is **not decided here**: it is FOLLOW-874 item 2. Remaining gaps: `packages/intent-ontology` is still a 14-line version stub (0 consumers — FOLLOW-467); ~~the real-time chat→NLP path is code-complete but dead in prod (stream-consumer not deployed, F-03)~~ — **CORRECTED 2026-08-07 (FOLLOW-891):** the real-time path no longer depends on `stream-consumer` (ADR-0016: the ingest Worker POSTs straight to `chat_nlp_endpoint`), and that endpoint is now deployed. The **traffic** axis is still unproven — see row A.1's Rule AA note and FOLLOW-892. |
| D.5 | Continuous Detection Quality | 🟥 **Design-only** | No DQS measurement code beyond the schema_validation cron. |
| D.6 | Archetype Coverage Matrix | 🟢 **UPDATED (2026-06-19, FOLLOW-344)** | All 17 non-neutral archetypes reachable: 9 🟢 Full (behavioral+quiz+chat), 6 🟡 Quiz/chat-only (vacation_rental_investor/downsizer/remote_worker/retiree_relocator/diaspora_buyer/student_parent — no reliable passive behavioral discriminator), 2 ⚪ Quiz/chat-only (golden_visa_buyer/commercial_investor). Plus `neutral` (🟢 Always) = 18/18 total. Counts reconciled to match §D.6 table Status column (FOLLOW-364). |
| E.1–E.3 | Adaptation decision tree + A/B + bandit | 🟡 **Partial** | A/B holdout + Thompson sampling math shipped + tested + **wired into canonical `POST /api/adapt`** (Sprint 9.5 PR #122, FOLLOW-007). Server selects a `variant` per (tenant, archetype) request and includes it in the response body. **Sprint 10 closed both Sprint 9.5 half-wires:** (1) SDK `AdaptResponse.variant?: string` field added in PR #127 (FOLLOW-042); (2) SDK feedback ping consumer at `packages/sdk/src/core/adapt.ts:postFeedbackPing()` POSTs to `/api/adapt/feedback` on outcome events in PR #127 (FOLLOW-041). PR #133 (FOLLOW-051) hardened the feedback endpoint from presence-only Bearer to HMAC-SHA256 tenant-scoped signing — threat model documented in §V.3.2. **Bandit feedback loop is end-to-end wired in CODE.** ⚠️ **CODE-VS-PROD (Rule AA):** the 2026-07-01 audit (F-06) found the prod feedback endpoint 503-gated (`FEEDBACK_ENDPOINT_ENABLED !== 'true'`, ADR-0015 interim), so `ab_bandit_weights` are **frozen at Beta(1,1) → Thompson sampling is uniform-random in prod**. FOLLOW-450 (Sprint 22b, P0) landed the go-live code (PR #426, DONE) but its AC1 is OPERATOR-PENDING — an operator must set `FEEDBACK_ENDPOINT_ENABLED=true` + provision `ADAPT_API_KEY`/`OPS_TENANT_ID` in Doppler prd and prove a real weight delta (`pnpm feedback:canary`) before the loop actually learns. Remaining limitation: the bandit *selection* keys against `ab_bandit_weights` rows (Beta priors) without consulting `archetype_embeddings.embedding` for archetype context — that depends on FOLLOW-063 (LG-1 — automated archetype seed enforcement) to make the cosine path reachable. Decision-api Worker (`apps/decision-api/src/app/api/adapt/route.ts`) still on keyword path — by design per ADR-0004 (canonical = control-plane). |
| E.4 | Investor Quiz Widget | 🟢 **Mostly Shipped** | v2.0 cascading decision tree (3 branches, 17 leaf archetypes, 2–3 questions) ratified 2026-06-05 and **IMPLEMENTED** (2026-07-01 audit): `applyQuizLeaf()` direct-assignment ships in `packages/sdk/src/core/intent.ts` + `index.ts` (verified — 13 SDK files reference it), post-quiz drift detection (DRIFT_HOLD_COUNT=3), `quiz_completions` MOAT table, multilingual (en/pl/es), per-tenant toggle. (Was "impl PENDING" in the 2026-05-24 snapshot; the flat 2-question quiz was rewritten.) Open: `quiz_completions` had 0 DSR readers until FOLLOW-455 (tracked in FOLLOW-467 dead-scaffold sweep). |
| E.6 | Placeholder Resolution Order (7-level) | 🟡 **Partial** | Only Level 1 (DOM attribute) implemented; Levels 2–7 fall through to literal `{token}` on-page (FOLLOW-026 P1). |
| E.7 | Long-form Description Pipeline (v2.0 permanent cache, no Tiers) | 🟢 **Shipped + LIVE in prod** | Tiers/TTL eliminated (CEO 2026-06-05) and the pipeline is **implemented and live in prod** since 2026-07-03 (Modal `estalara-description-generator`, ADR-0016 direct-HTTPS dispatch, no Redpanda). `apps/llm-gateway/src/jobs/generate_description.py` writes both Redis (no TTL) and the `description_cache_persistent` Postgres table (real Drizzle table — `packages/db/src/schema/description_cache_persistent.ts`) via `_write_to_postgres_cache`; invalidation is by `listing.updated` only; `tier` param removed. Anti-hallucination guards real (whitelist + `<adaptation_verdict>` NEUTRAL fit-gate [ADR-0010] + negative-cache [FOLLOW-465] + model-keyed read [FOLLOW-464]). (Was "impl PENDING" in the 2026-05-24 snapshot.) |
| F | Data Network Effect (archetype embedding space) | 🟡 **Partial** | `archetype_embeddings` table seeded with all **18** archetypes (migration `0005_seed_archetype_embeddings.sql`, post-Sprint 8). Sprint 10 FOLLOW-043 (PR #131 + 6 fix commits) ships `pnpm seed:archetypes` script (uses Supabase PostgREST + `service_role` key per fix commit `82b9e2e` — Supabase direct host is IPv6-only, unreachable from GitHub Actions) and a manual `workflow_dispatch` GitHub Action (`.github/workflows/seed-archetypes.yml`). When invoked against a Doppler-configured environment with `SUPABASE_SERVICE_ROLE_KEY` + `OPENAI_API_KEY`, the script populates all 18 vectors with OpenAI `text-embedding-3-small` at 1024 dims; cost <$0.001. **No CI step or on-merge automation runs the seed automatically.** For any fresh DB pull, `archetype_embeddings.embedding` remains NULL until an operator runs the workflow — the cosine path that FOLLOW-019 (Sprint 9.5 PR #123) wired still falls back to djb2 by default. FOLLOW-063 (RETRO-006 LG-1) tracks the auto-seed enforcement + README runbook. The `listing_embeddings` table (migration 0013) is wired and PR #132 (FOLLOW-046) auto-seeds the 12-listing demo manifest on activation; non-demo tenants still need manual `POST /api/listings/embed` (FOLLOW-046 carve-out). **Sprint 11 FOLLOW-063 (PR #135) ships `archetype-embeddings-not-null` CI precheck (push:main, soft-skip until DOPPLER_TOKEN_DEV provisioned) + `.github/workflows/post-migrate-seed.yml` idempotent auto-seed on every push to main. Once ESC-009 / FOLLOW-040 escalation resolves, the cosine path will be enforceable in CI for any fresh DB pull.** |
| G | Behavioral Fingerprinting | 🟡 **Partial** | Session-scoped IDs work; cross-listing per-tenant aggregation works; global DP aggregation = design-only. |
| H | Compliance & Privacy (GDPR/AI Act/CCPA/UK/UAE) | ✅ **Shipped** | DPIA v2.0 + ROPA + LIA template + DSR endpoints (initiate/access/erase/portability with OTP+Resend) + consent gate + tenant_compliance_records + **ClickHouse hard-delete on erase via FOLLOW-039 (§H.1.1)**. EU pilot gate cleared 2026-05-24. Confirmed by 2026-07-01 audit: the platform-wide consent umbrella (§H.8) + per-user opt-out toggle (§H.9) are genuinely wired incl. the real 24h intent-vector TTL, and the always-`legitimate-interest` consent-label bug is fixed. |
| I | Stack Technologiczny | ✅ **Locked** | Decisions stable, in-code. |
| J | Multi-Tenancy Model | ✅ **Shipped** | `tenants` Postgres table with RLS + JWT-scoped tenant_id. Detected site schemas are persisted in the dedicated `tenant_site_schemas` table (one row per `(tenant_id, domain)`), not on `tenants` itself. Master Design §J.3 still describes a `data_schema: TenantSchemaMapping` field inline on TenantConfig — that section is documentation-level only; the actual store is the standalone table. (Sprint 9.5 PR #121 / #125 / #126 hardened the contract around `tenant_site_schemas`.) |
| K | Internal Operations Panel | 🟡 **Partial** | UI exists at `/admin/{registrations,demo-sessions,tenants}` but each page imports a local `mock-data.ts`. Not wired to live DB lists. **K.3.6 Archetype Tracer UI: LIVE as of FOLLOW-269 (PR pending)** — 4 new admin pages: `/admin/tenants/[id]/tracer` (Live Session Monitor + 18-archetype bar chart + SSE stream), `/admin/tenants/[id]/tracer/history` (Session History with filters, replay modal, CSV/JSONL export links), `/admin/tracer/weights` (global Weight Editor for priors/damping/signal_likelihoods, `data_source` provenance badge), `/admin/tenants/[id]/tracer/export` (Export Dashboard for decisions + events). All pages consume the existing K.3.6 D-1 admin APIs (FOLLOW-267/268). Chat display (D-2) stub only — DPIA scope undecided. Simulation (D-3) stub only — FOLLOW-282. |
| L | Pricing Model | 🟥 **Design-only** | Three tiers defined; no checkout flow exists. |
| M | Business Model & GTM | 🟥 **Design-only** | No GTM artifacts in code (expected — non-engineering). |
| N | Costs & Unit Economics | 🟥 **Design-only** | LLM daily cap exists (`isDailyCapExceeded`); no per-tenant unit-economics dashboard. |
| O | Risks & Mitigations | n/a | Strategic only. |
| P.0 | Localhost-first stage + FOLLOW-820 exit gate | 🟡 **In force; no GO/NO-GO ruling recorded** | Added 2026-09-13 (v4.12, FOLLOW-1148). Per-condition status and citations are in §Snapshot.0. Condition 1 is not gradeable yet: no run has been graded by the current AC(1) (#894), AC(7) waits on FOLLOW-1196, and CEO decision #2 puts FOLLOW-1201 before the next harness run. Condition 2 code is DONE with operator residue. Condition 3 is half done (Modal deploy). Condition 4 waits on an operator. `docs/AUDIT-2026-09-13.md` §5 reads NO-GO. |
| P.1 | 12-week MVP roadmap | 🟡 **Partial** | Sprints 0–9 mostly complete. Tygodnie 11–12 "Pilot launch prep" has no sprint folder yet. |
| P.2 | What we don't build (Tier 3, UAE, FL) | ✅ **Honored** | All explicitly deferred items remain deferred. |
| Q | User Stories / Data Flows | n/a | Strategic. |
| R | Innovation Roadmap & Patents | 🟥 **Design-only** | No patent filings in repo; no innovation feature shipped under the R.1–R.6 banner specifically. |
| S | Strategic conclusion | n/a | Strategic. |
| T | Demo Mode v5 | 🟡 **Partial** | Code exists (`app/api/demo/*`, `/admin/demo-sessions`, demo mockup pages); design section heading missing from current TOC (likely silently absorbed in v1.4 renumber). |
| U | Agency Registration + Master Admin | 🟡 **Partial** | Registration flow + Stripe webhook + JWT roles + admin layout: real. Master Admin Fleet View: partial (mock data). |
| U.10 | Investor Quiz back-office | ✅ **Shipped** | Per-tenant toggle + analytics dashboard real. |
| U.11 | Profile Mode (post-MVP) | 🟥 **Design-only** | Forward-compat checklist tracked; not active. |
| V | Security Architecture | 🟡 **Partial** | JWT/RLS/HMAC/Sentry/OTel/Gitleaks/idempotency: shipped. SBOM, MFA enforcement, full CSP, formal threat model: design-only. P0 auth gaps (FIX-013..019) closed in Sprint 8 — but pattern of late-closure is a process risk. Sprint 10 PR #133 (FOLLOW-051) added `§V.3.2` threat model for `POST /api/adapt/feedback` HMAC-SHA256 tenant-scoped signing; `INTERNAL_API_SECRET` (server-to-server shared secret used by PR #132 listing-embedding seeder) is undocumented — FOLLOW-073 tracks the §V.3.3 add. RETRO-006 LG-3 records a 16h regression window (2026-05-22 → 2026-05-23) where the feedback endpoint accepted presence-only Bearer; demo-safe (no real tenants) but pattern is the same shape as the FIX-013..019 late-closure risk. |
| W | Operational Excellence | 🟥 **Design-only** | DR/SLO/error-budget config not in repo. One Grafana dashboard (ingest only) committed. OTel collector configured for `logging` exporter, not Tempo/Prometheus. |
| X | Sprint 1.5 Hardening | ✅ **Closed** | FIX-001..005 merged. |

### §Snapshot.2 — Architectural drift (read this before reading §A.1)

The Master Design §A.1 diagram positions four distinct Modal Python services as the home of the intelligence layer: `intent-engine`, `archetype-pipeline`, `adaptation-engine`, `llm-gateway`. As of HEAD `398dc97`:

- `apps/intent-engine/src/main.py` = 27 lines, returns `{"status": "placeholder"}`, version `0.0.0`
- `apps/archetype-pipeline/src/main.py` = 22 lines, same pattern
- `apps/adaptation-engine/src/main.py` = 22 lines, same pattern
- `apps/auto-detect/src/main.py` = 13 lines, same pattern
- `apps/llm-gateway/src/main.py` = 22 lines, *but* `apps/llm-gateway/src/jobs/generate_description.py` is a real 668-line Sonnet job
- `apps/data-quality/src/main.py` = placeholder, *but* `apps/data-quality/src/crons/schema_validation.py` is a real 526-line cron

The intelligence that does run is split across:
- **In-browser:** `packages/sdk/src/core/intent.ts` (~600 LOC Bayesian classifier, 18 archetypes, 4 signal types)
- **Edge Worker:** `apps/decision-api/src/lib/` (bandit, ab-assignment, consent-gate, reorder, llm-gateway client) + 3-bucket keyword classifier
- **Next.js Edge route:** `apps/control-plane/src/app/api/adapt/route.ts` (18-archetype playbook lookup + LLM tweak/full branches + RAG retrieval + ClickHouse logging)
- **Async Modal jobs:** `generate_description.py` + `schema_validation.py`

This is a **pivot**, not a backlog gap. The team has converged on "TS at the edge + Python only for batch / async" as a more pragmatic stack. The Master Design has not yet been updated to acknowledge this. Two reconciliation paths are open:

1. **Build the Modal apps.** Wire `intent-engine` to consume `chat.message.sent` + `events.session.*` and call Haiku 4.5 for chat NLP; wire `archetype-pipeline` to nightly cron the pgvector cosine matcher; wire `adaptation-engine` for batch playbook generation. Estimated 3–5 sprints.
2. **Update the diagram.** Delete the four placeholder apps; re-label the responsibilities onto `apps/decision-api`, `apps/control-plane`, and the existing real Modal jobs. Estimated 0.5 sprint.

Recommendation: pursue (1) for chat NLP only (real product gap — the SDK schema declares chat events but no SDK producer or server consumer exists), and pursue (2) for everything else.

### §Snapshot.3 — Strategic intent vs current capability for *adaptive listings*

The headline claim of this product is: *a real estate website can embed the SDK, the system detects buyer intent, and the listing content adapts per archetype in real time*. As of today:

- **Can a tenant embed the SDK and see content adapt?** ✅ Yes — given they hand-code `data-estalara-slot="headline|feature|cta"` and `data-estalara-listing-id=…` attributes on their listing template. Tested via Playwright e2e (`packages/sdk/e2e/adapt-dom-mutations.spec.ts`).
- **Does the adaptation use 18 differentiated archetypes?** 🟡 **Conditional.** If the tenant configures the SDK to call the Next.js `apps/control-plane` adapt route, yes (full 18-archetype playbook + LLM tweak). If they call the default Cloudflare Worker `apps/decision-api` route, **no** — 15 of 18 archetypes degrade to neutral. This route divergence is a structural debt item.
- **Does the system detect intent without chat / without quiz?** 🟥 **Weakly.** The 4 captured signal types (page.view, scroll.depth, listing.viewed, cta.clicked) only meaningfully distinguish `yield_hunter`, `portfolio_builder`, and `neutral`. The other 15 archetypes have no behavioral discriminator wired. Without the quiz, the typical visitor stays in `neutral`.
- **Does the bandit pick variants per request?** 🟥 **No.** Variant-index transport (FOLLOW-025/028) is open. Bandit currently picks index 0 always. The 3-variants-per-slot work in TICKET-046 is currently dead data.
- **Does archetype affinity rank listing cards?** 🟥 **No.** `deterministicScore(archetype, listingId)` is a djb2 hash. Same archetype always gets the same order; no actual ranking model.
- **Can an agency review/approve generated copy?** 🟥 **No.** Agency RAG (TICKET-AGENCY-001) lets the agency *seed* the LLM with FAQ data; there is no preview/approve UI before generated copy ships.
- **Can analytics show conversion lift?** ✅ Yes — `/dashboard/analytics` Panel 3 surfaces per-archetype lift vs the 10% holdout with z-test.

Net: an investor demo today shows a credible Tier 1 Observer + Tier 2 mutation flow for 3 archetypes with a working analytics tail. The 18-archetype, multi-variant, chat-driven, vector-matched experience promised in §D / §E is not yet what runs on real traffic.

### §Snapshot.4 — Recommendation priorities (mirrors `AUDIT_REPORT_INVESTOR_READINESS.md` §11)

**Immediate (1–2 weeks):**
1. ~~**Sprint 11 (OPEN 2026-05-23): close 3 pilot-blockers (FOLLOW-063 seed CI, FOLLOW-068 demo CI, FOLLOW-069 HMAC compat) + FOLLOW-039 EU GDPR gate.**~~ ~~**Sprint 11 CLOSED 2026-05-24** — all 5 P1 pilot-blockers DONE.~~ **Sprint 12 OPEN (2026-05-24) — controlled pilot launch on app.estalara.com.** AI Council Checkpoint approved 2026-05-24. Lane A (pilot-critical hardening, P1, gates Lane B): FOLLOW-081 (ClickHouse mutation-poll integration test against system.mutations — EU pilot confidence blocker), ~~FOLLOW-079 (demo-integration fail-loud — CANCELLED 2026-05-25, split into FOLLOW-088/089/090 Sprint 13 P2)~~, FOLLOW-075 (VERCEL_CRON_SECRET enforcement on /api/dsr/mutation-poll — VERCEL_CRON_SECRET provisioned 2026-05-24), FOLLOW-078 (DSR failure alerting — regulator-visible at pilot). Lane B (app.estalara.com onboarding, P1, blocked until Lane A): TICKET-PILOT-001 (SDK install + Magic Link activation + 3-5 days shadow mode), TICKET-PILOT-002 (activation runbook + go/no-go checklist + incident response). Lane C (ROI instrumentation, P1, parallel with Lane B): TICKET-PILOT-003 (CTA lift dashboard with holdout comparison), TICKET-PILOT-004 (inquiry starts tracking + event mapping). P2 carry-over: FOLLOW-073 (INTERNAL_API_SECRET threat model), FOLLOW-074 (README local dev setup). Pilot target: app.estalara.com. Free pilot. EU region. Incident owner: Piotr Nawrocki. Primary metric: CTA lift. Secondary: inquiry starts. **UPDATE 2026-05-25 — Sprint 12 CLOSED, Sprint 13 OPEN.** Lane A + Lane C shipped (PRs #142–#146); pilot did NOT launch — Lane B (TICKET-PILOT-001/002) moved to Sprint 13 because RETRO-008/009 surfaced go-live blockers (dashboards fabricate metrics on ClickHouse error, `inquiry.started` never fires in prod). **Sprint 13 three-track (Track 1 first):** Lane A correctness (FOLLOW-094/098/093/097) → Lane B pilot launch (PILOT-001 + FOLLOW-092 + PILOT-002, blocked until Lane A) → Lane C intent v1.0 = priorities #7–12 below (FOLLOW-099/100/087/101/102/103, parallel with Lane B). Pre-spawn gates: provision DOPPLER_TOKEN_DEV (ESC-010) + E2E_BEARER_TOKEN (ESC-009); AI Council Checkpoint on Track 1 vs Track 2 ordering. Plus **FOLLOW-105** (P0 canonical /api/adapt ADR + enforcement — ADR-0006 follow-on to ADR-0004, added 2026-05-25 per AI Council Ticket 4 + CEO ratification — gates Lane B; Lane A now 5 tickets, sprint ~63.5h). **Phase-0 RATIFIED 2026-05-25; APPROVED_TO_IMPLEMENT=true. Sprint 13a Lane A (6 tickets, +FOLLOW-106 pilot_frozen) ready to spawn.**
2. Wire `applyArchetypeHints()` in SDK init (already implemented + tested, just not called) — cheap win for cold-start.
3. ~~Hard-delete from ClickHouse in DSR-erase (FOLLOW-039)~~ **PROMOTED TO SPRINT 11 P1 as item 1 above.**
4. ~~Doppler CI wired (FOLLOW-040)~~ **PROMOTED TO SPRINT 11 P1 as item 1 above.**
5. Pick one `/api/adapt` endpoint as the canonical one and retire the other; document the choice in an ADR.

**Product proof (2–6 weeks):**
5. ~~Unblock Sprint 2.5 (TICKET-030/032/033/034)~~ **Sprint 9.5 closed 2026-05-22.** TICKET-030 + TICKET-033 + TICKET-AUTO-006-POLISH merged. TICKET-032 + TICKET-034 deferred per Q5 2026-05-21 (auto-detect already covers L1/L2/L4; L3 templates non-blocking). ~~Next priority: FOLLOW-041 + FOLLOW-042 (close the bandit loop) and FOLLOW-043 (seed real archetype embeddings).~~ **Sprint 10 closed 2026-05-24** — FOLLOW-041/042 merged (PR #127), FOLLOW-043 merged (PR #131 + 6 ops fixes), FOLLOW-046 merged for demo tenant (PR #132), FOLLOW-051 HMAC hardening (PR #133), Rule J live (PR #128), sprint-close checklist live (PR #134). **Next priority surfaces from RETRO-006:** FOLLOW-063 (P1 — auto-seed enforcement, fresh DB pulls today still have NULL archetype embeddings until manual workflow); FOLLOW-068 (P1 — CI job that actually runs the E2E spec end-to-end, currently opt-in); FOLLOW-069 (P1 — cross-runtime HMAC compatibility test).
6. Seed all 18 archetypes into `archetype_embeddings` (currently 3).
7. **FOLLOW-099** (Sprint 13, sdk-engineer, ~8h) — SDK behavioral observers: `photo.dwell`, `feature.expanded`, `mortgage_calc.used`, `filter.applied` (facet+value), `inquiry.started`. Payload-aware dispatch. Bundle delta <5KB gzip.
8. **FOLLOW-100** (Sprint 13, sdk-engineer, ~8h, depends on FOLLOW-099) — `SIGNAL_LIKELIHOODS` dla wszystkich 18 archetypów + `CHAT_INTENT_LIKELIHOODS` + `applyChatIntentPrior()`. ≥13/18 archetypów osiąga 🟢 Full coverage.
9. **FOLLOW-101** (Sprint 13, ml-engineer + sdk-engineer, ~4h, depends on FOLLOW-087 + FOLLOW-100) — `chat.intent.detected` → SDK Bayesian prior bridge. Mismatch detection między quiz prior a chat prior.
10. **FOLLOW-102** (Sprint 13, sdk-engineer + backend-engineer, ~3h) — Quiz ON/OFF toggle: `SdkConfig.quiz.enabled`, Supabase `tenants.quiz_enabled` jako primary SoT, dashboard toggle, snippet generator.
11. **FOLLOW-103** (Sprint 13, ml-engineer + sdk-engineer, ~4h) — app.estalara.com DOM adaptation: corpus fixture `000-app-estalara`, AI Vision slot detection (ANTHROPIC_API_KEY już w Doppler), TextDirective coverage test 18×5=90 directives.
12. **FOLLOW-087** (Sprint 13, ml-engineer, ~12h, depends on FOLLOW-040/063) — `apps/intent-engine` chat NLP: Haiku 4.5 real-time + Sonnet 4.6 batch enrichment. Schema `chat.intent.detected` stabilizuje FOLLOW-101.

**Investor confidence (6–12 weeks):**
13. Wire bandit variant selection per request (FOLLOW-007/025/028).
14. Replace `deterministicScore` with a real archetype-listing affinity (FOLLOW-019).
15. End-to-end test of differentiator: synthetic behavioral trace → ingest → consumer → intent → adapt → DOM mutation → measured CTR lift (FOLLOW-022).
16. Backfill RLS on `session_embeddings`, `tenant_site_schemas`, `ab_bandit_weights`, `schema_validation_history`, `archetype_embeddings`.
17. Stand up at least one second region (US or UK) end-to-end on Terraform.
18. Authorize SOC 2 Type I readiness work; SBOM + MFA enforcement + formal threat model.

### §Snapshot.5 — Test posture summary

- 102 TypeScript test files + 14 Python test files = **116 total**.
- All vitest configs enforce 80% (libraries) / 70% (apps) line-branch-function-statement coverage as required by `CLAUDE.md`. Python apps have **no coverage gate** in CI.
  ⚠️ **Caveat 2026-09-13 (v4.12; audit T-2, re-checked):** the thresholds exist in config but are
  enforced nowhere. No `package.json` script, GitHub workflow or `turbo.json` passes `--coverage`,
  and no `vitest.config.*` sets `coverage.enabled: true`. The rest of this subsection's bullets are
  not re-verified (FOLLOW-825).
- 24-platform auto-detection corpus runs every PR at 100/100 precision/recall (real CI gate).
- Playwright SDK e2e suite (4 specs) runs every PR; covers Tier 1 observer + Tier 2 DOM mutation + consent gate.
- Multi-service `tests/e2e/smoke-ingest.test.ts` runs **nightly only** (not on PR).
- ~~Critical gap: **no end-to-end test of intent → archetype → adapt → DOM**.~~ **Corrected
  2026-09-13 (v4.12, FOLLOW-1148; audit D-1).** The test exists:
  `tests/e2e/follow-819/differentiator-e2e.mjs` (FOLLOW-819). It is a MANUAL localhost harness
  against the real control plane, and no CI job runs it (README §0; audit T-4). **What it has shown is
  stated by recorded `source`, not by tally.** The most recent run recorded in its README
  (2026-08-26T10:06:24Z, §5.9) served an `llm_tweaked` response. That run was graded by the AC(1)
  predicate #894 retired, and it cannot be re-graded because its artefact is `.gitignore`d and was
  overwritten. The run matching §5.6 re-grades to 0 of 3 adapted responses. AC(7) cannot fail on the
  fixture tenant until FOLLOW-1196. AC(2) is green on a fixture that deliberately diverges from the
  pilot page (ESC-074 / FOLLOW-1140). **The open gap is a run at HEAD graded by the current
  predicates, not the existence of a test.** That run is FOLLOW-1185, after FOLLOW-1201. Status is in
  §Snapshot.0.

### §Snapshot.6 — Retro learning loop status

- 228+ retros in `backlog/RETROSPECTIVES.md` (RETRO-001..228 as of 2026-08-03; refreshed from the stale "RETRO-001..167").
- 591+ follow-ups generated (FOLLOW-001..591+); many DONE, the open set tracked in `backlog/QUEUE.md` + `backlog/FOLLOW_UPS.md` (refreshed from the stale "FOLLOW-001..535+").
- **42 permanent rules** in `CONVENTIONS_PATCH.md` (A–L, N–P, R–U, W–Z, M, V, Q, AA–AP; refreshed from the stale "27 rules"); several are enforced by hard CI gates — **Rule H** (no schema scaffold without runtime consumer, `scripts/check-rule-h.sh`), **Rule I** (wired-or-dead, `scripts/check-rule-i.sh`), **Rule J** (mirror-file sync), **Rule AP** (gate residual enumeration must be a machine-checked register, not prose), plus the adapt-schema-drift gate. "Enforced by a hard CI gate" is a citation, not an efficacy claim: Rule H's `check-rule-h.sh` was wired to a hard, green-required job the whole time, yet its Pattern 2 (unwired `lib/` export) **could not fail** between 2026-05-14 and 2026-08-06 — a corrupted consumer count made the comparison an arithmetic syntax error and the gate printed `OK:` over genuine orphan exports (FOLLOW-857 / RETRO-253; 24 violations had accumulated by the time it was repaired). Both wired-or-dead gates now carry a self-test job that asserts they still fail on a shared orphan fixture; read that job, not this line, as the evidence any of these gates works. All three counts on this line are DERIVED (re-run the three greps in FOLLOW-772's AC1/AC2), not authored, and drift on every retro/follow-up/rule-promotion — not worth a dedicated automation ticket at this cadence (FOLLOW-772 AC3), but a future §Snapshot refresh should keep re-deriving them rather than copying this line forward.
- (Historical) 2 P0 follow-ups added 2026-05-16: FOLLOW-039 (ClickHouse hard delete for DSR) and FOLLOW-040 (Doppler CI) — both long since DONE.

### §Snapshot.7 — Documented architectural risks (high → low)

1. ✅ **RESOLVED 2026-05-25 (FOLLOW-105 Wave 1, PR #150).** Previously: two parallel `/api/adapt` endpoints with divergent behavior (Worker = 3 buckets, Next.js = 18 + LLM; RETRO-003 §4c). **ADR-0006 ACCEPTED** — control-plane `/api/adapt` is the sole production path, now enforced at runtime: `buildSnippet()` emits the canonical `data-decision-url` (`${CONTROL_PLANE_URL}/api`), the SDK Zod-validates the response against `AdaptationDirectives`, the Worker `/api/adapt` returns **410 Gone** with structured logging, and a CI Rule H gate guards against route re-divergence + response-contract drift. Worker handler removal is tracked by FOLLOW-107 (Sprint 14, after a 7-day zero-traffic window).
2. **Modal placeholder gap.** Four named services are 22-line stubs; intelligence lives in TS edge. Either rebuild or rebrand.
3. **Single-region infrastructure** despite four-region marketing claim.
4. **RLS coverage incomplete** on `session_embeddings`, `tenant_site_schemas`, `ab_bandit_weights`, `schema_validation_history`, `archetype_embeddings`.
5. **Bandit is dead data.** `bandit.ts` not imported by any non-test file; `variant_index` not on the wire.
6. **Sprint 2.5 is the structural bottleneck** — every later sprint completed except onboarding. The MVP entry point is unbuilt.
7. **`packages/compliance` and `packages/intent-ontology` are empty scaffolds** despite being central in the architecture narrative. Real logic is spread across `apps/control-plane` + `packages/sdk`. Future agents reading the package READMEs will be misled.

---

**Changelog v1.7.1 (15 May 2026 — Description pipeline pivot + anti-hallucination guard-rails):**

- 🔄 Sekcja **E.7 "Long-form Description Pipeline"** przepisana w dwóch wymiarach:
  - **Original-first behavior:** Tier 2/3 cache miss → endpoint zwraca `source: 'original'` z `description: null`, SDK NIE rusza DOM (agent's original copy zostaje widoczne dla buyera 1). AI-adapted copy pojawia się dopiero dla buyera N+1 (cache hit po Modal job). Powód: archetypal templates wstawione w miejsce realnego opisu agenta na pierwszej wizycie wyglądają sztucznie i mogą się kłócić faktograficznie z resztą strony.
  - **Anti-hallucination guard-rails:** Templates przepisane jako pure voice/framing patterns (zero konkretnych liczb, zero hardcoded "faktów"). Sonnet system prompt dostaje strict whitelist — pisze TYLKO o faktach z `original_description` lub `listing_context`. Audit trail przez `<verified_facts_used>` parsowany do ClickHouse.
- ✨ **Endpoint contract change**: `GET /api/adapt/description` zostaje dla Tier 1 (sidebar widget, zwraca `copy_template`). Dla Tier 2/3 nowy `POST /api/adapt/description` z body `{ listing_id, archetype, tier, locale, original_description, listing_context }`. POST jest potrzebny, bo `original_description` może być długie (kilkaset–kilka tysięcy znaków).
- ✨ Nowa wartość w `source` enum: `'original'`. Schema: `'template_fallback' | 'ai_cached' | 'original'`.
- ✨ Nowe pole `verified_facts_used: Array(String)` w response (Tier 2/3 ai_cached) i w ClickHouse `description_generations`. Audit trail które fakty Sonnet faktycznie użył.
- 🔄 Templates `copy_template.en/pl/es` w 18 archetypach przepisane jako structured voice patterns (sekcje `VOICE PATTERN:` + `HARD RULES:`). Zero placeholderów liczbowych (`{yield}`, `{occupancy_rate}`, `{adr}`, `{wault}` itp.). CI gate `template-purity.test.ts` blokuje regresje.
- 🔄 Modal job `apps/llm-gateway/src/jobs/generate_description.py`:
  - Przyjmuje `original_description` w event payload, używa jako faktograficzny seed.
  - System prompt zawiera WHITELIST RULES (Appendix B spec'u TICKET-DESC-PIVOT-001).
  - Parsuje `<verified_facts_used>` z output Sonneta i zwraca jako osobne pole.
- 🔄 SDK (TICKET-DESC-001 scope) na Tier 2/3 ekstraktuje oryginalny opis z DOM przez `tenant.data_extractors.description` selektor, wysyła w POST body. Na `source: 'original'` zostawia DOM. Na `source: 'ai_cached'` podmienia.
- ✨ Nowa subsekcja **E.7.5 "Anti-hallucination guard-rails"** — formalne reguły whitelistu i polityka audit trail.
- 📝 Reguła w `CONVENTIONS_PATCH.md`: "AI-adapted display copy never replaces agent's original on first view" + "AI-generated content uses strict fact whitelist + audit trail".
- 🔧 Decyzje Piotra (locked 2026-05-15): templates BEZ liczb / whitelist tylko original+context / generic positive claims OK ("attractive yield" bez liczby) / audit trail w metadata.

**Changelog v1.7 (15 May 2026 — Cold Start Protection for adaptation pipeline):**

- 🔄 **Sekcja E.7 przeprojektowana.** Pierwszy buyer dla każdej pary `(listing, archetype)` widzi **oryginalne copy agenta** (`source: 'original_agent_copy'`), a nie statyczny template. Sonnet job uruchamia się w tle i serwuje adaptowaną wersję od drugiego buyera tego archetypu (`source: 'ai_cached'`). Cache miss z istniejącym oryginałem zwraca oryginał, nigdy template.
- 🔄 **`copy_template` przestaje być renderowany do usera w standardowym flow.** Templates są **seedami promptu** dla Sonneta (SEED 2 w 3-seed prompcie: oryginał agenta + Opus template + listing_context). Wyjątek: edge case gdy `listing.description` jest pusty — wtedy template renderuje się bezpośrednio jako `source: 'template_fallback'`, z placeholderami rozwiązanymi z `listing_context`.
- ✨ **Templates trójjęzyczne (EN + PL + ES).** Każdy z 18 archetypów ma trzy locale-natywne wersje (54 templates łącznie), pisane od zera w kontekście lokalnego rynku (Bezpieczny Kredyt 2% w PL, Non-Lucrative Visa w ES post-Golden-Visa-repeal, VFT/VUT licensing dla STR, etc.). Patrz `docs/specs/cold-start-archetype-templates-v1.md`.
- 🔄 **`source` enum (final):** trzy wartości używane: `'ai_cached'` (cache hit), `'original_agent_copy'` (cache miss, oryginał istnieje), `'template_fallback'` (cache miss, brak oryginału). `'ai_generated'` zarezerwowany formalnie, nieużywany.
- 🔄 **Tier 1 nie używa `/api/adapt/description`.** Tier 1 = Observer = no DOM mutation; endpoint zarezerwowany dla Tier 2/3.
- ✨ **Nowa sekcja E.7.7 "Cold Start Protection"** — pełna specyfikacja flow (z dwiema ścieżkami cache-miss), two-branch three-seed prompt, invariants (factual, voice, length, token), observability.
- ✨ **7 nowych ticketów (TICKET-COLD-001 do TICKET-COLD-007)** zastępują dotychczasowy TICKET-DESC-001. Modal job z PR #112 (commit b55c025) wymaga zmiany kontraktu payload o pole `original_agent_copy` (string, dozwolony pusty).
- 📝 Pełna spec: `docs/specs/cold-start-protection-v1.md` (impl plan) + `docs/specs/cold-start-archetype-templates-v1.md` (54 templates).

**Changelog v1.6 (14 May 2026 — Adaptation Engine extensions after PR #92 / TICKET-046):**
- 🔄 Rozszerzona sekcja **E.2** — dodano blok "Definicje terminów" (slot, wariant, copy_template, ListingContext) oraz "Implementacja 3 wariantów per slot" z przykładem `yield_hunter`. Slot `feature-section` (bug w `yield-hunter.ts` przed PR #92) ustandaryzowany do `feature`.
- 🔄 Rozszerzona sekcja **E.3** — dodano paragraf opisujący selekcję wariantu przez Thompson sampling per `(tenant_id, archetype, variant)` w `ab_bandit_weights`; `winningVariant` indeksuje `slots[i].variants.en[]`; `TextDirective` dostaje `variant_index` (post-Sprint 10, TICKET-BANDIT-VARIANTS).
- ✨ Nowa podsekcja **E.5 (Reserved)** — placeholder utrzymujący numerację stabilną dla przyszłych wstawek.
- ✨ Nowa podsekcja **E.6 "Placeholder Resolution Order"** — 7-poziomowa hierarchia źródeł danych dla `{token}` placeholderów (wklejone z `MASTER_DESIGN_PATCH_v1_5.md`). Foundation dla E.7.
- ✨ Nowa podsekcja **E.7 "Long-form Description Pipeline"** — Tier gating (1 = static fallback, 2 = AI 72h, 3 = AI 48h), endpoint `GET /api/adapt/description`, Redis cache key, Modal job dla Sonnet 4.6, invalidation. Implementacja: TICKET-DESC-001, Sprint 9.

**Changelog v1.4 (5 May 2026 — Security & Operational Excellence hardening + Investor Quiz + Profile Mode forward-compat):**
- ✨ Nowa sekcja **V "Security Architecture & Cybersecurity"** — kompleksowa specyfikacja zabezpieczeń: authentication & session security, API security, OWASP Top 10 coverage, secrets management, supply chain security, database security, frontend SDK security, threat modeling, security testing, compliance certifications roadmap (SOC 2, ISO 27001), bug bounty program
- ✨ Nowa sekcja **W "Operational Excellence — DR, Monitoring, Deployment"** — Disaster Recovery & Business Continuity (RPO/RTO targets), Incident Response Plan (sev levels, on-call, post-mortems, status page), SLO/SLI definitions z error budgets, observability strategy, deployment & rollback playbooks, cost controls & abuse prevention (DoW protection), data governance, multi-tenant isolation testing
- ✨ Nowa podsekcja **E.4 "Investor Quiz Widget"** — opt-in 2-pytaniowy quiz (cel zakupu: personal/investment, horyzont: ≤3mo/>1yr) jako Bayesian prior dla Intent Engine; sticky widget + post-3-listings prompt; decay logic (10-20 min) pozwalająca behavioral signals dominować z czasem; 6 nowych ticketów (TICKET-QUIZ-001 do QUIZ-006)
- ✨ Nowa podsekcja **U.10 "Investor Quiz back-office"** — per-tenant toggle (`/dashboard/quiz`), agency analytics dashboard (`/dashboard/quiz/analytics`) z funnel + answer distribution + conversion lift, Master Admin Fleet View extension; 3 dodatkowe tickety (QUIZ-003, QUIZ-004, QUIZ-007)
- 🔮 Nowa podsekcja **U.11 "Profile Mode (Identified Buyers)"** — POST-MVP feature (Sprint 12+); forward-compatibility checklist dla MVP; Master Admin globalna flaga "Profile Mode beta" + zewnętrzny approval workflow (Notion+DPA, nie w systemie); 4 forward-compat action items w Sprint 2/4/8 (`consent_records` table, `Estalara.identify()` SDK stub, fair-housing linter); pełna spec w osobnym Year-2 strategic doc
- 🔧 Sprint 1.5 hardening tickets — 5 fix-ticketów ukończonych (TICKET-FIX-001 do FIX-005): OTel context propagation, canonical error format, security response headers, Drizzle role separation, PII blacklist
- 📝 Cross-references — wszystkie sekcje (B, D, D.5, E, F, H, J, K, T, U, V) zaktualizowane o referencje do V, W, Quiz, i Profile Mode forward-compat

**Changelog v1.3 (5 May 2026 — Demo Mode v5 + Agency Registration + Master Admin):**
- ✨ Nowa sekcja **T "Demo Mode v5 — Built-In Feature for Sales & Validation"** — kompletna specyfikacja Demo Mode jako integralnej funkcji produktu (2 funkcje: Mock-up Toggle + Side Panel), sprint mapping, 7 ticketów, acceptance criteria dla wszystkich ticketów
- ✨ Nowa sekcja **U "Agency Registration Flow & Master Admin"** — decyzje architektoniczne zatwierdzone przez Piotra: approval-required onboarding, Stripe + invoice billing, RBAC z trzema rolami, osobny `admin.estalara.com`, Master Admin oversight Demo Mode ON/OFF per tenant

**Changelog v1.2 (30 April 2026 — Post Sprint 0 strategic upgrade):**
- ✨ Nowa sekcja **K "Internal Operations Panel (Estalara Staff Only)"** — RBAC, monitoring + intervention dla staff Estalara
- ✨ Nowa sekcja **D.5 "Continuous Detection Quality System"** — system osiągania 90–97% accuracy z self-supervised metrics
- ✨ Nowa sekcja **R "Innovation Roadmap & Patent Strategy"** — 6 obszarów unique IP + patent filing roadmap
- 🔄 Rozszerzona sekcja **E.3** o causal inference framework (CATE) i multi-objective optimization
- 🔄 Rozszerzona sekcja **B.5** o predictive drift detection (B.5.4)
- 🔄 Rozszerzona sekcja **O** (była N) o **O.6** (ML model risks) plus accuracy regression w O.1
- 📐 Renumeracja: stare K–Q stają się L–S (przesunięcie +1 dla nowej sekcji K, plus nowa R między Q i S)

**Changelog v1.1:**
- ✨ Nowa sekcja **B.4 "Auto-Onboarding & Zero-Config Installation"** — automatyzacja całego procesu instalacji i konfiguracji
- ✨ Nowa sekcja **B.5 "Schema Discovery & Auto-Configuration Pipeline"** — jak system automatycznie wykrywa strukturę danych
- ✨ Nowa sekcja **B.6 "Continuous Schema Validation & Self-Healing"** — auto-fix gdy strona klienta się zmieni
- ✨ Nowa sekcja **B.7 "Pre-Built Platform Templates Library"** — gotowe templates dla 50+ platform
- 🔄 Zaktualizowana sekcja **J.3** o `auto_detected_schema` w `TenantConfig`
- 🔄 Zaktualizowana sekcja **P.1** — dodano "Sprint 0" dla auto-onboarding infrastructure
- 🔄 Zaktualizowana sekcja **A.1** — dodano "Auto-Detection Service" w diagramie komponentów

---

## Executive Summary (1 strona)

Estalara Adaptive Listings to **embeddable AI layer + standalone SaaS** dla rynku nieruchomości, który w czasie rzeczywistym personalizuje listingi pod konkretnego, anonimowego kupującego — na bazie sygnałów behawioralnych, treści chatu i podróży cross-listing. Produkt sprzedajemy w trzech tierach (Observer / Augment / Native), z modelem hybrydowym (base fee + usage), w czterech regionach (US/UK/EU/UAE) od dnia 1.

**Najważniejsze rekomendacje strategiczne:**

1. **Architektura "jeden core, dwa entry-pointy".** Jeden monorepo (Turborepo) z trzema artefaktami: (a) `@estalara/sdk` (vanilla TS + Preact + Shadow DOM, <40 KB gzip), (b) `apps/ingest` (Cloudflare Workers, low-latency edge), (c) `apps/control-plane` (Next.js App Router na Vercel — dashboard + standalone product).
2. **Stack zorientowany na latency i koszt.** Ingest na Cloudflare Workers (zero cold start, $0.30/M req), event store ClickHouse Cloud, transakcyjny Postgres (Supabase) z Row Level Security per `tenant_id`, embeddings w pgvector do 5–10M wektorów, później migracja do Qdrant. LLM-y: **Claude Haiku 4.5 ($1/$5 per MTok)** jako workhorse, **Sonnet 4.6 ($3/$15)** dla złożonych decyzji adaptacji, fallback OpenAI dla redundancji ([Anthropic pricing](https://www.anthropic.com/news/claude-haiku-4-5)).
3. **Behavioral fingerprinting jako MVP, ale z legitimate-interest framework + opt-out.** EDPB Guidelines 2/2023 (final 16.10.2024) i ICO (grudzień 2024) jasno traktują fingerprinting jako objęty Art. 5(3) ePrivacy — czyli **wymaga consent w EU/UK** dla celów marketingowych ([EDPB](https://www.edpb.europa.eu/news/news/2023/edpb-provides-clarity-tracking-techniques-covered-eprivacy-directive_en), [ICO](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/12/our-response-to-google-s-policy-change-on-fingerprinting/)). Realne podejście: **session-scoped probabilistic ID** (bez persystencji cross-site bez consent), cross-listing tylko w obrębie jednego tenanta, a globalna agregacja na poziomie *behavioral archetypes* (k-anonymity ≥50, differential privacy ε≤2). To pozwala uruchomić produkt bez consent banneru w 80% scenariuszy, ale **wymaga DPIA, ROPA i jasnej legitimate-interest assessment per tenant**.
4. **Data network effect zbudowany jako embedding space archetypów, nie surowych profili.** Centralized aggregation z DP, nie federated learning (FL jest 1–2 lata przedwczesny dla naszego use case). MOAT: każdy nowy klient zwiększa pokrycie i precyzję ~50–200 archetypów buyera (relocating-family, cross-border-investor, downsizing-retiree, school-district-focus etc.).
5. **Pricing hybrid, anchored przez Mutiny/Dynamic Yield.** Tier 1 Observer: $499/mo + $0.40/1k visits. Tier 2 Augment: $1 999/mo + $1.20/1k adaptations. Tier 3 Native: $7 500/mo + $4/1k rendered listings + LLM passthrough +25%. Enterprise (Idealista/Otodom skala): six-figure annual. Dla porównania Optimizely starts ~$36k/rok, Dynamic Yield ~$35–60k+/rok, Mutiny custom ($10k+/mo na ABM tier) ([Optimizely](https://www.geteppo.com/blog/optimizely-pricing), [Dynamic Yield](https://www.personizely.net/blog/dynamic-yield-pricing)).
6. **AI Act: classify defensively jako *NIE* high-risk, ale przygotuj dokumentację jakby był.** Estalara nie podejmuje automatycznych decyzji o dostępie do mieszkania (decyzję podejmuje agent + buyer); to *recommendation/personalization*, nie *eligibility/credit scoring*. Annex III nie obejmuje real-estate marketingu. Ale ponieważ pełen AI Act zacznie obowiązywać 2 sierpnia 2026 ([European Commission](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)), trzymamy DPIA + risk-management + transparency + human oversight zgodne z high-risk od dnia 1 — to też pozytywny sygnał dla enterprise klientów.
7. **MVP w 12 tygodniach, zespół 5 FTE (Piotr/CEO, Rafał/CTO, Krystian/CPO + 2 senior engineers).** Budżet MVP: ~€180k–€250k (zespół ~€140k przy kontraktorach + €25–40k infra/LLM credits + €15k legal/DPIA). Pilot z 3–5 agencjami w Marbelli, Warszawie i Londynie, public launch Q4 2026.

8. **🆕 Zero-config onboarding jako strategiczny moat (v1.1).** "Copy-paste & go live w 60s" — admin wkleja URL strony, AI (Claude Sonnet 4.6 Vision + Puppeteer + 15 pre-built platform templates) wykrywa strukturę automatycznie, generuje script tag, monitoruje drift i sam się naprawia gdy strona klienta się zmieni. To **redukuje time-to-value z dni do minut** i jest naszym #1 differentiator vs Mutiny/Dynamic Yield (które wymagają tygodni implementacji). Koszt: ~$0.33 per tenant onboarding — negligible vs ACV. WordPress Plugin (~40% rynku SMB) daje 1-click install bez devu. Patrz sekcja B.4–B.7.

**Największe ryzyka:** (1) ICO/CNIL enforcement na fingerprinting bez consent — mitigujemy przez session-only mode w EU oraz "Estalara Consent Helper" jako component; (2) Vendor lock-in na LLM — mitigujemy przez router (LiteLLM) i embeddings na BGE-M3 self-hosted dla taniej skali; (3) Konkurencja Mutiny / Zillow — MOAT to **vertical depth** (real-estate-specific intent ontology) i **embeddable-first DX** (Mutiny jest stand-alone, nie embeddable do cudzych stron).

---

## A. Wysokopoziomowa architektura systemu

### A.1. Diagram komponentów (logical view)

> **v1.9-A reconciliation note.** The intelligence layer is now a **TypeScript Edge Engine** rather than a fleet of Modal Python services. The three Modal stubs that were never built (`apps/archetype-pipeline`, `apps/adaptation-engine`, `apps/auto-detect`) were deleted in commits `1c53137` / `33b4675` / `da9f45f`; their responsibilities migrated to the SDK + Next.js edge + Cloudflare Worker triple (see ADR-0004 for the canonical adapt endpoint, ADR-0005 for the Modal apps disposition). The Auto-Detect Vision API still exists, but lives inside `apps/control-plane/src/app/api/detect/route.ts` rather than as a standalone Modal service.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT WEBSITE (Idealista, agencja w Marbelli, custom Wordpress)   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  @estalara/sdk (vanilla TS + Preact, Shadow DOM, <40 KB)     │   │
│  │  ├─ TIER 1 Observer:  widget overlay (sidebar / floating)    │   │
│  │  ├─ TIER 2 Augment:   DOM mutations via declarative slots    │   │
│  │  └─ TIER 3 Native:    <EstalaraListing/> full component      │   │
│  │  ──────────────────────────────────────────────────────────  │   │
│  │  TypeScript Edge Engine — component 1/3:                     │   │
│  │  SDK intent classifier (in-browser Bayesian)                 │   │
│  │  → packages/sdk/src/core/intent.ts                           │   │
│  └─────────────┬────────────────────────────────────────────────┘   │
└────────────────│────────────────────────────────────────────────────┘
                 │ HTTPS, batched events (every 2s or on flush)
                 │ + WebSocket for live chat / live adaptation
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EDGE INGEST (Cloudflare Workers, 4 regions: iad/lhr/fra/dxb)       │
│  - Tenant auth (HMAC-signed API key + origin allowlist)             │
│  - Schema validation (Zod) + rate limit (Durable Objects)           │
│  - Behavioral fingerprint hashing (session-scoped, k-anon bucket)   │
│  - Push to Redpanda Cloud (Kafka-compatible, multi-region)          │
└────────────────┬────────────────────────────────────────────────────┘
                 │
   ┌─────────────┼──────────────────────────┐
   ▼             ▼                          ▼
┌──────────┐ ┌──────────┐         ┌─────────────────────────────────┐
│ClickHouse│ │ Postgres │         │  TypeScript Edge Engine —       │
│ Cloud    │ │(Supabase │         │  components 2/3 + 3/3           │
│(events)  │ │  per     │         │  ├─ Edge holdout gate           │
│          │ │  region) │         │  │   (Cloudflare Worker,        │
│          │ │          │         │  │   apps/decision-api —        │
│          │ │          │         │  │   ADR-0004, edge-only)       │
└──────────┘ └──────────┘         │  └─ Canonical adapt route       │
                                  │      (Next.js,                  │
                                  │      apps/control-plane —       │
                                  │      ADR-0004)                  │
                                  └────────────────┬────────────────┘
                                                   │ uses
                                                   ▼
                                  ┌─────────────────────────────────┐
                                  │  pgvector (per-tenant embedding │
                                  │  spaces) + global archetype     │
                                  │  embedding space (DP-protected) │
                                  └────────────────┬────────────────┘
                                                   │
                                                   ▼
                                  ┌─────────────────────────────────┐
                                  │ Control Plane (Next.js dashboard│
                                  │ on Vercel, per-tenant analytics,│
                                  │ config, white-label, billing)   │
                                  └─────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  MODAL SERVICES (async jobs, off-the-edge)                          │
│  ├─ apps/llm-gateway     — async Sonnet 4.6 job (description warmer)│
│  ├─ apps/data-quality    — daily schema validation cron (§B.6)      │
│  ├─ apps/intent-engine   — BUILD: cross-tab session persistence +   │
│  │                         chat NLP (see ADR-0005)                  │
│  └─ apps/stream-consumer — Redpanda consumer (ClickHouse fan-out)   │
│                                                                     │
│  Auto-Detect (Vision) now lives inside Next.js at                   │
│    apps/control-plane/src/app/api/detect/route.ts                   │
│    (the apps/auto-detect Modal stub was deleted — see ADR-0005).    │
└─────────────────────────────────────────────────────────────────────┘
```

### A.1.5. TypeScript Edge Engine — runtime intelligence layer

> Added in v1.9-D (2026-05-17). Documents the actual runtime home of adaptive intelligence as of HEAD `a0943a7`, complementing the §A.1 high-level diagram. Findings confirmed by AUDIT-001 (evidence-based code audit).

Three components carry the adaptive intelligence at runtime. The Modal Python services described elsewhere in this document are either future work (intent-engine) or deleted (see ADR-0005). The TypeScript edge stack below is what ships today.

#### Component 1: In-browser Bayesian intent classifier

- **Location:** `packages/sdk/src/core/intent.ts`
- **Size:** ~600 LOC of pure TypeScript, no external ML dependencies
- **What it does:** Maintains a probability distribution over 18 archetypes per visitor session. Updates on every behavioral signal (page.view, scroll.depth, listing.viewed, cta.clicked — 4 of 37 declared signals actively emitted today). Uses Bayesian update with configurable priors (`BASE_PRIOR`) and signal likelihoods (`SIGNAL_LIKELIHOODS`).
- **Confidence gating (corrected 2026-08-07, FOLLOW-881; axis SPLIT 2026-08-08, FOLLOW-913 / ESC-054 ruled):** DOM adaptation is gated by TWO disjunctions, not one bare floor and not one shared disjunction: directive mutations apply when `resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR` (0.5) **OR** `signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT` (2) — the `aboveFloor` check at `packages/sdk/src/index.ts:879-881`. The `/adapt/description` fetch has its OWN, higher disjunction: `resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR` (0.5) **OR** `signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` (5) — `aboveDescriptionFloor` at `index.ts:882-884`. The three constants live in `packages/sdk/src/core/adapt-floor.ts`; when neither branch of a given disjunction holds, `refreshDirectives()` skips that axis's DOM effect (`applyDirectives()` or the description fetch respectively) and no mutation is applied on that axis. Cold start (t=0) renders neutral — but the init-time `device_type` prior (`index.ts:1089-1094`, applied via `applyBehavioralSignal()`) already consumes one signal, so the FIRST real behavioral event reaches `signal_count = 2` and opens the DIRECTIVE axis at any confidence; the DESCRIPTION axis requires four real behavioral events (`signal_count = 5`) per the ESC-054 ruling. The sidebar widget is admin-only (not buyer-facing); there is no SDK constant gating sidebar visibility.
- **Decay:** Confidence drifts toward uniform distribution (1/18 per archetype) at `DEFAULT_DECAY_RATE = 0.02 / minute` without new evidence.
- **Why in-browser:** Zero latency for intent updates, no PII leaves the device for classification, graceful degradation if network is unavailable.
- **Limitation:** Loses state on tab close. Cross-tab persistence is the responsibility of `apps/intent-engine` (Modal — to be built, see ADR-0005).

#### Component 2: Edge holdout gate

- **Location:** `apps/decision-api` (Cloudflare Worker)
- **What it does:** Receives adapt requests from the SDK, assigns holdout group deterministically via `HMAC(tenant_id, session_id)`, enforces consent gate, forwards non-holdout sessions to the canonical adapt route, returns `ReorderDirective` for listing card re-ranking.
- **Latency target:** p95 <100ms (edge-only path, cached decision, no LLM, no RAG — see ADR-0004 for full SLA tiers).
- **What it does NOT do:** Archetype classification. The 3-bucket keyword stub in this Worker is intentionally not used in production paths (see ADR-0004 for the canonical-route decision).

#### Component 3: Canonical adapt route

- **Location:** `apps/control-plane/src/app/api/adapt/route.ts`
- **What it does:** Receives archetype + session context from the SDK, selects the appropriate playbook (18 archetypes defined, 6 production-grade today), optionally enriches via RAG (AGENCY-001 listing context retrieval), optionally rewrites copy via LiteLLM (Haiku 4.5 for speed, Sonnet 4.6 for quality), logs the adaptation decision to ClickHouse, returns `slot_copy` + `ReorderDirective` + `variant_index`.
- **Latency targets (bifurcated — see ADR-0004):** Deterministic path p95 <300ms, RAG-enriched path p95 <800ms, LLM-rewrite path p95 <2000ms.
- **What it does NOT do:** Holdout assignment (that is the edge holdout gate's responsibility — Component 2).

#### Data flow (happy path)

1. Visitor lands on listing page (e.g. app.estalara.com).
2. SDK loads (IIFE, 93.3 KB measured at HEAD `a0943a7` — see §B.2 for remediation plan TICKET-038).
3. In-browser classifier initializes with `BASE_PRIOR` (neutral mass = 0.37, all archetypes seeded).
4. Behavioral signals update classifier in real-time via Bayesian update.
5. On confidence threshold OR page-dwell timer: SDK calls edge holdout gate (Component 2).
6. Edge gate: HMAC holdout assignment, consent check, forwards to canonical adapt route if non-holdout.
7. Canonical adapt route: playbook selection, optional RAG enrichment, optional LLM rewrite, decision logged to ClickHouse, returns directives.
8. SDK applies directives: reorders listing cards (if `ReorderDirective` + `container_selector` detected), updates slot copy (`data-estalara-slot` elements), fires outcome events back to ingest.
9. ClickHouse records: `adaptation_decision`, archetype, `variant_index`, holdout flag, timestamp.
10. Analytics dashboard surfaces: lift vs holdout (north-star: qualified inquiry rate per impression), per-archetype performance, signal coverage.

#### Current limitations (honest, as of v1.9-D)

- **Behavioral signal coverage:** Only 4 of 37 declared SDK behavioral signals are actively emitted today (page.view, scroll.depth, listing.viewed, cta.clicked). Behavioral discrimination is therefore strong for only 3 of 6 production archetypes without quiz assistance. Sprint 7.5 auto-detect work and quiz widget partially compensate.
- **Bandit variant selection:** `thompsonSample()` is implemented but has no non-test callers in production code (FOLLOW-007). `variant_index` is always 0 in production traffic.
- **Cross-tab intent persistence:** Requires `apps/intent-engine` (Modal Python — currently a 28-line placeholder, full implementation deferred per ADR-0005).
- **Chat-driven adaptation:** `chat.message.sent` schema is defined but has zero SDK producers today. Chat integration with Estalara AI (app.estalara.com) is in the post-MVP roadmap; see the integration guide for app.estalara.com integration sequencing.

### A.2. Multi-tenant model — kluczowa decyzja

Trzy poziomy izolacji w jednej architekturze:

| Warstwa | Mechanizm izolacji | Egzekucja |
|---|---|---|
| Edge ingest | Tenant API key → tenant_id w każdym evencie | HMAC + origin check w Workerze |
| Postgres (config, tenants, billing) | Row Level Security per `tenant_id` + per-tenant JWT claims | Supabase RLS ([Supabase docs](https://supabase.com/docs/guides/database/postgres/row-level-security)) |
| ClickHouse (events) | Per-tenant partition key + column-level encryption dla PII fields | ClickHouse RBAC + materialized views |
| pgvector (per-tenant embeddings) | Schema-per-tenant dla top-100 enterprise; row-level (`tenant_id` indexed) dla long-tail | Schema-per-tenant ma 4–8x lepszy query throughput dla 1M+ wektorów |
| Global archetype space (Estalara-owned) | DP-aggregated, nie zawiera tenant identifiers, k-anon ≥50 | Differential Privacy ε≤2 stosowane na poziomie batch updates |

Warto zauważyć, że Cloudflare wybrał TimescaleDB nad ClickHouse dla *operational analytics z małymi batch'ami pisanymi przez wiele klientów* — bo ClickHouse buforuje małe inserty na 400ms timer ([Cloudflare blog](https://blog.cloudflare.com/timescaledb-art/)). Dla naszego use case (high-volume events, append-only, bulk aggregation queries) ClickHouse Cloud jest właściwy — ale **agreguj na edge w 5-sekundowe batche przed wysłaniem do ClickHouse**, nie pisz event-by-event. ClickHouse Cloud charge ~$50/mo for hobby ale realistycznie mid-volume to $500–2000/mo ([G2 comparison](https://www.g2.com/compare/clickhouse-vs-timescale)).

### A.3. Region strategy — EU-first today, multi-region post-seed

> **Honest framing (v1.9-B, 2026-05-17):** EU (Frankfurt, `eu-central-1`) is the only region active today. The architecture is *region-pluggable* — `mapCountryToRegion` is implemented and provider accounts (Supabase, ClickHouse Cloud, Cloudflare POPs) are multi-region-capable — but **US, UK, and UAE deployments are post-seed roadmap**, brought up on customer demand and funded by Series A. The table below describes the *target end-state*, not current production.

| Region | Status | Hosting | Postgres | ClickHouse | LLM endpoint | Compliance |
|---|---|---|---|---|---|---|
| **EU** (Frankfurt) | ✅ **Active today** (`eu-central-1`) | Vercel + Cloudflare fra1 | Supabase EU (Frankfurt) | ClickHouse Cloud EU | Claude przez AWS Bedrock eu-central-1 | GDPR primary |
| **US** (Virginia) | 🗓️ **Post-seed, on-demand** | Vercel iad1 + Cloudflare iad | Supabase US-East | ClickHouse Cloud US-East | Claude/OpenAI native | CCPA/CPRA |
| **UK** (London) | 🗓️ **Post-seed, on-demand** | Vercel lhr1 + Cloudflare lhr | Supabase EU (separate UK project for residency) | Logical separation w EU instance | Claude przez Bedrock eu-west-2 | UK GDPR |
| **UAE** (Dubai) | 🗓️ **Post-seed, on-demand** | Cloudflare dxb (no Vercel POP — fall back na fra1) | Postgres na AWS me-central-1 (Bahrain region najbliższy) | ClickHouse self-hosted on AWS me-central-1 lub EU instance dla MVP | Claude przez Bedrock (najbliższy: eu-central-1) | UAE PDPL Federal Decree-Law 45/2021 + DIFC |

**Current routing (EU-first):** All edge ingest, control plane, event store, and ML workloads run in EU today. Cloudflare Workers serve every POP globally, but writes terminate to the EU origin. Cross-tenant archetype aggregation (DP-protected) runs in the EU archetype store. Latency budget from user-event to ingest ACK: **<50ms p95 globally** (Cloudflare's global POP network) and **<150ms p95** for full adapt-response from non-EU geographies until additional regions are stood up.

**Target routing (post-seed):** Edge ingest writes do najbliższego POP. Nightly batch ETL replikuje *anonimowe archetypy* (DP-protected) do globalnego archetype store. Surowe events i PII **NIGDY nie opuszczają regionu** zgodnie z data residency. This routing model is *designed-in* (region-routing code exists, see Snapshot row §A.3) but only activates once additional regions are provisioned.

---

## B. Embeddable Plug-in / SDK Design

### B.1. Doświadczenie integratora (klient = real estate website owner)

**Najprostsza możliwa integracja (Tier 1 Observer) — 1 script tag:**

```html
<!-- Wkleić raz w <head> -->
<script async src="https://cdn.estalara.io/sdk/v1/estalara.min.js"
        data-tenant="tnt_marbella_realty_xxx"
        data-tier="observer"
        data-region="eu"></script>
```

**Tier 2 Augment — declarative slots w istniejącym HTML:**

```html
<article class="listing">
  <h1 data-estalara-slot="headline">{originalna nazwa}</h1>
  <div data-estalara-slot="hero-gallery">{istniejąca galeria}</div>
  <ul data-estalara-slot="features">{istniejące features}</ul>
  <section data-estalara-slot="chat-anchor"></section>
</article>
```

SDK wykrywa `data-estalara-slot` atrybuty i może je *augmentować* (re-rank, replace text via LLM rewrite, reorder children) **bez ruszania reszty DOM-u**.

**Quiz ON/OFF toggle (SdkConfig.quiz):**

```typescript
// packages/sdk/src/core/types.ts — SdkConfig
interface SdkConfig {
  tenantId: string;
  tier: 'observer' | 'augment' | 'native';
  region: 'eu' | 'us' | 'uk' | 'uae';
  decisionApiUrl?: string;          // control-plane route = full 18-archetype playbook
  quiz?: {
    enabled: boolean;               // default: true
    trigger_after_n_listings?: number; // default: 3
  };
}
```

- `quiz.enabled = true` (default) — quiz widget renderowany po N listing views (N = `trigger_after_n_listings`, default 3)
- `quiz.enabled = false` — quiz widget całkowicie wyłączony; intent detection bazuje wyłącznie na sygnałach behawioralnych + chat NLP
- **Source of truth:** Supabase `tenants.quiz_enabled boolean DEFAULT true` — dashboard toggle i snippet generator czytają z Supabase przez `PATCH /api/tenants/:id`
- **Rationale:** Tenanci z wysoką jakością chat coverage (np. app.estalara.com z full AI chat) — quiz może być zbędny i UX-invasive. Tenanci bez chatu — quiz jest kluczowym źródłem sygnału (patrz §D.6)
- **Implementation:** FOLLOW-102 (Sprint 13, sdk-engineer + backend-engineer)

**Tier 3 Native — React/Vue/vanilla component:**

```jsx
import { EstalaraListing } from '@estalara/react';

<EstalaraListing
  listingId="prop_4587"
  tenantId="tnt_idealista"
  feed={mlsData}
  onInquiry={(buyer) => crm.push(buyer)}
  brandTokens={{ primary: '#C4A882', font: 'Fraunces' }}
/>
```

### B.2. Architektura SDK — performance budget i izolacja

| Wymiar | Decyzja | Uzasadnienie |
|---|---|---|
| Framework | **Preact** (3.5 KB) zamiast React (45 KB) | Preact wygrywa dla embeddable widgets — Viget i CompanyCam udowodnili że Preact + Shadow DOM = optymalne dla embeddable ([CompanyCam case](https://dev.to/companycam/build-an-embeddable-widget-using-preact-and-the-shadow-dom-33lm)) |
| Bundler | **esbuild** + **tsup** | esbuild jest 50–100x szybszy niż Webpack, tsup daje gotowe ESM + CJS + UMD bundle dla CDN |
| Distribution | **CDN (Cloudflare R2 + Workers)** + **npm** (@estalara/sdk, @estalara/react, @estalara/vue) | Long-tail klienci wkleją script tag, dev teams użyją npm |
| Style isolation | **Shadow DOM (open mode)** + **Constructable Stylesheets** | Iframe ma overhead per-frame (separate browsing context, postMessage tax) — Shadow DOM jest natywnym standardem dla embeddable widgets ([dev.to comparison](https://dev.to/alanwest/why-shadowdom-matters-more-than-you-think-3cmm)) |
| Bundle size budget | **Tier 1: 25 KB gzip** (loader + observer), **Tier 2: 40 KB gzip** (+ DOM augmenter), **Tier 3: 80 KB gzip** (+ full renderer) | Lazy-load Tier 2/3 features tylko gdy enabled w config |
| Loading | **async + idle-callback dla non-critical work**, intersection observer dla "is listing visible" | Nie blokujemy LCP klienta |
| CSP | Generujemy nonce per-load, dokumentujemy required `script-src cdn.estalara.io 'self' 'wasm-unsafe-eval'` (dla potencjalnego on-device modelu w przyszłości) | XSS mitigation, plus pomaga klientom z surową CSP |
| API surface | Zdarzeniowy: `Estalara.on('intent-detected', cb)`, `Estalara.adapt(slot, directive)`, `Estalara.identify(hint)` (opt-in dla klientów którzy mają consent) | Inspiracja: Segment analytics.js + Intercom Messenger |

> **v1.9-C update (2026-05-17):** Current build exceeds the original budget. Measured at HEAD
> `398dc97` (post TICKET-ADP-004):
>
> - IIFE bundle (raw): **93.3 KB**
> - Minified: ~72 KB (estimated)
> - Gzipped: ~24 KB (estimated)
> - Brotli: ~21 KB (estimated)
>
> The original <40 KB target was for the gzipped Tier 1 Observer only. The current build includes
> Tier 1 + Tier 2 (DOM mutations + playbooks) in a single bundle.
>
> **Remediation plan:** Split into two entry points:
>
> - `@estalara/sdk/observer` — Tier 1 only, target ≤35 KB gzipped
> - `@estalara/sdk/augment` — Tier 1 + Tier 2, target ≤75 KB gzipped
>
> Tracked as TICKET-038 (sdk-engineer, next up in STATUS.md).

### B.3. Adaptery do popularnych stacks

W roadmapie MVP uwzględniamy 5 high-value adapterów:

1. **Intercom/Drift adapter** — auto-pickup chat transcripts via webhook (Intercom oferuje `conversation.user.replied` webhook; Drift po akwizycji przez Salesloft w lutym 2024 nie publikuje już cen, plan startuje ~$2 500/mo ([SaaS Price Pulse](https://www.saaspricepulse.com/compare/intercom-vs-drift))).
2. **Crisp adapter** (popularny w EU + tańszy)
3. **Idealista API adapter** — Idealista oferuje Search API (B2B z access request); my budujemy gotowy connector dla MLS-style feeds ([Idealista developers](https://developers.idealista.com/access-request))
4. **Otodom + Allegro Lokalnie** — Polska, scraping fallback przez Apify-style ($0.50/1k properties ([Apify](https://apify.com/lukass/idealista-scraper/api)))
5. **Generic JSON Schema feed + REST webhook** — fallback dla każdej innej platformy

---

### B.4. Auto-Onboarding & Zero-Config Installation

**Filozofia:** "Copy-paste & go live w 60 sekund." Onboarding na poziomie Intercoma — admin agencji nie powinien myśleć o CSS selectors, schema mapping, ani field mapping. System wykrywa wszystko sam.

#### B.4.1. Trzy ścieżki onboardingu (dopasowane do typu klienta)

| Ścieżka | Target | Time-to-live | Wymagana wiedza techniczna |
|---|---|---|---|
| **Magic Link** (default dla 80% klientów) | Agencje z known platform (Idealista, WordPress + Houzez, etc.) | <2 min | Zero — admin tylko wkleja URL i kopiuje script tag |
| **AI Auto-Detect** (15% klientów) | Custom sites bez znanego template | <5 min | Zero — Claude Vision + Puppeteer wykrywa strukturę |
| **API Connect** (5% power users) | Agencje z własnym REST API / MLS feed | <10 min | Junior dev (token + endpoint URL) |

#### B.4.2. Magic Link Onboarding — flow szczegółowy

```
┌─ Admin wpisuje URL strony agencji w dashboardzie ─┐
│                                                    │
│ "https://agencja-marbella.com/properties"          │
│                                                    │
│ [Analyze My Site]                                  │
└────────────────┬───────────────────────────────────┘
                 │
                 ▼
┌─ Backend Auto-Detection Pipeline (~90s) ──────────┐
│                                                    │
│ 1. Puppeteer headless: open URL, capture HTML      │
│    + viewport screenshot (above-the-fold + scroll) │
│                                                    │
│ 2. Platform fingerprint check:                     │
│    - hostname match → KNOWN_PLATFORMS lookup       │
│    - meta[generator] check → WordPress detection   │
│    - DOM signatures → theme detection (Houzez,     │
│      Realtyna, Estatik, etc.)                      │
│                                                    │
│ 3. Jeśli platform known:                           │
│    → Use pre-built selectors (confidence: 0.99)    │
│    → Skip do step 6                                │
│                                                    │
│ 4. Jeśli unknown — Schema.org check:               │
│    - script[type="application/ld+json"]            │
│    - microdata: itemtype="...RealEstateListing"    │
│    - confidence jeśli match: 0.95                  │
│                                                    │
│ 5. Jeśli no Schema.org — AI Vision:                │
│    - Claude Sonnet 4.6 Vision API                  │
│    - Input: screenshot + HTML (truncated 50KB)     │
│    - Output: JSON z selectors + confidence         │
│                                                    │
│ 6. Validation pass:                                │
│    - Test każdy selector na 5 sample listingach    │
│    - Verify field types (price = number, etc.)     │
│    - Check coverage (% pól znalezione)             │
│                                                    │
│ 7. Generate tenant config + API key                │
│    - Save schema to Postgres (tenants.data_schema) │
│    - Generate installation snippet                 │
└────────────────┬───────────────────────────────────┘
                 │
                 ▼
┌─ Dashboard pokazuje rezultat ─────────────────────┐
│                                                    │
│ ✓ Site analyzed!                                   │
│                                                    │
│ Detected: WordPress + Houzez theme                 │
│ Properties found: 247                              │
│ Confidence: 96%                                    │
│                                                    │
│ Auto-configured fields:                            │
│ ✓ Title:       h1.property-title                   │
│ ✓ Price:       span.price-value (EUR)              │
│ ✓ Photos:      .gallery img (avg 18/listing)       │
│ ✓ Features:    ul.amenities li                     │
│ ⚠ Location:    needs review (low confidence)       │
│                                                    │
│ Installation:                                      │
│                                                    │
│ ┌────────────────────────────────────────────┐    │
│ │ <script async src="https://cdn.estalara.io │    │
│ │   /sdk/v1/estalara.min.js"                 │    │
│ │   data-tenant="tnt_xK7j2mP9..."            │    │
│ │   data-tier="observer"></script>           │    │
│ └────────────────────────────────────────────┘    │
│                                                    │
│ [Copy Code]  [Email to Developer]                  │
│ [Install via WordPress Plugin] (1-click)           │
│                                                    │
│ Next: Add code → Wait 5min → Go Live               │
└────────────────────────────────────────────────────┘
```

#### B.4.3. AI Vision Auto-Detection — szczegóły implementacji

```typescript
// apps/auto-detect/src/detect.ts (Modal serverless function)
async function detectListingPage(input: {
  url: string;
  html: string;
  screenshot_b64: string;
}): Promise<DetectionResult> {

  // STEP 1: Try Schema.org (40% stron ma)
  const schemaOrgResult = parseSchemaOrg(input.html);
  if (schemaOrgResult.confidence > 0.9) {
    return { source: 'schema.org', ...schemaOrgResult };
  }

  // STEP 2: Platform fingerprint (50+ pre-configured)
  const platform = matchPlatform(input.url, input.html);
  if (platform.confidence > 0.85) {
    return { source: 'platform_template', ...platform };
  }

  // STEP 3: Claude Sonnet 4.6 Vision (fallback dla custom sites)
  const visionAnalysis = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: input.screenshot_b64
          }
        },
        {
          type: "text",
          text: `Analyze this real estate listing webpage.
          Return ONLY valid JSON matching this schema:
          {
            "page_type": "property_listing" | "search_results" | "other",
            "platform_guess": string | null,
            "elements": {
              "title":       { "css_selector": string, "confidence": 0-1 },
              "price":       { "css_selector": string, "confidence": 0-1, "currency": string },
              "photos":      { "css_selector": string, "confidence": 0-1 },
              "features":    { "css_selector": string, "confidence": 0-1 },
              "description": { "css_selector": string, "confidence": 0-1 },
              "location":    { "css_selector": string, "confidence": 0-1 },
              "bedrooms":    { "css_selector": string, "confidence": 0-1 },
              "bathrooms":   { "css_selector": string, "confidence": 0-1 }
            },
            "adaptable_slots_recommendation": [
              "headline", "photos", "features"
            ]
          }
          
          HTML sample (truncated): ${input.html.slice(0, 50000)}`
        }
      ]
    });

  const detection = JSON.parse(visionAnalysis.content[0].text);
  
  // STEP 4: Validation pass — test selectors na 5 sample listingach
  const validated = await validateSelectors(input.url, detection);
  
  return {
    source: 'ai_vision',
    confidence: validated.coverage_score,
    schema: validated.confirmed_selectors,
    needs_review: validated.low_confidence_fields
  };
}
```

**Koszt jednorazowego onboarding (Claude Sonnet 4.6):**
- Input: ~50KB HTML + 1 screenshot (~100k tokens combined) = $0.30
- Output: ~2KB JSON = $0.03
- **Total per agency onboarding: ~$0.33** — negligible vs ACV $24k+/yr

#### B.4.4. Pre-built Platform Templates Library (50+ platforms)

```typescript
// packages/sdk/src/platform-templates.ts
export const KNOWN_PLATFORMS = {
  // Spain
  'idealista.com': {
    title: '.main-info__title-main',
    price: '.info-data-price span',
    photos: '.detail-multimedia-gallery img',
    features: '.details-property_features li',
    bedrooms: '[data-feature="bedrooms"]',
    location: '.main-info__title-minor',
    confidence: 0.99
  },
  'fotocasa.es': { /* ... */ },
  'pisos.com': { /* ... */ },

  // UK
  'rightmove.co.uk': {
    title: 'h1[itemprop="name"]',
    price: '._1gfnqJ3Vtd1z40MlC0MzXu span',
    photos: '.gallery-image',
    features: '.key-features li',
    confidence: 0.99
  },
  'zoopla.co.uk': { /* ... */ },
  'onthemarket.com': { /* ... */ },

  // Poland
  'otodom.pl': {
    title: 'h1[data-cy="adPageAdTitle"]',
    price: 'strong[data-cy="adPageHeaderPrice"]',
    photos: '.swiper-slide img',
    features: '[data-testid="ad.top-information.table"] li',
    confidence: 0.99
  },
  'gratka.pl': { /* ... */ },
  'olx.pl': { /* ... */ },

  // US
  'zillow.com': { /* ... */ },
  'realtor.com': { /* ... */ },
  'redfin.com': { /* ... */ },

  // UAE
  'bayut.com': { /* ... */ },
  'propertyfinder.ae': { /* ... */ },
  'dubizzle.com': { /* ... */ },

  // WordPress themes (auto-detected przez DOM signatures)
  'wordpress-houzez': {
    detect: () => document.querySelector('link[href*="houzez"]') !== null,
    selectors: { /* ... */ },
    confidence: 0.95
  },
  'wordpress-realtyna': { /* ... */ },
  'wordpress-estatik': { /* ... */ },
  'wordpress-wp-residence': { /* ... */ },
  'wordpress-realhomes': { /* ... */ },
  
  // Headless CMS / SPA frameworks
  'next-real-estate': { /* ... */ },
  'gatsby-real-estate': { /* ... */ }
};
```

**Roadmapa expansion templates:**
- MVP: 15 templates (top 3 platform per region)
- M6: 30 templates
- Y2: 80+ templates (community-contributed)

#### B.4.5. WordPress Plugin (zero-touch installation)

Dla ~40% rynku real estate (WordPress dominuje SMB):

```php
// wp-estalara-plugin/estalara.php
<?php
/*
Plugin Name: Estalara Adaptive Listings
Description: AI-powered property personalization. Zero config, install in 1 click.
Version: 1.0
*/

class EstalaraPlugin {
    public function __construct() {
        add_action('admin_menu', [$this, 'add_settings_page']);
        add_action('wp_footer', [$this, 'inject_sdk']);
        register_activation_hook(__FILE__, [$this, 'on_activate']);
    }

    public function on_activate() {
        // Auto-register tenant z Estalara API
        $site_url = get_site_url();
        $admin_email = get_option('admin_email');
        $theme = get_template();
        
        $response = wp_remote_post('https://admin.estalara.com/api/onboarding/wordpress', [
            'body' => json_encode([
                'site_url' => $site_url,
                'admin_email' => $admin_email,
                'theme' => $theme,
                'wp_version' => get_bloginfo('version')
            ]),
            'headers' => ['Content-Type' => 'application/json']
        ]);
        
        $data = json_decode(wp_remote_retrieve_body($response));
        update_option('estalara_api_key', $data->api_key);
        update_option('estalara_tenant_id', $data->tenant_id);
        
        // Backend automatycznie:
        // 1. Tworzy tenant
        // 2. Detektuje theme (Houzez/Realtyna/etc.)
        // 3. Aplikuje pre-built template
        // 4. Wysyła activation email
    }

    public function inject_sdk() {
        $api_key = get_option('estalara_api_key');
        if (!$api_key) return;
        
        $theme = get_template();
        ?>
        <script async 
                src="https://cdn.estalara.io/sdk/v1/estalara.min.js"
                data-tenant="<?php echo esc_attr(get_option('estalara_tenant_id')); ?>"
                data-platform="wordpress"
                data-theme="<?php echo esc_attr($theme); ?>"
                data-tier="observer">
        </script>
        <?php
    }
}

new EstalaraPlugin();
```

**Distribution:**
- WordPress.org plugin directory (organic acquisition)
- Marketplace listings: ThemeForest "Houzez Add-ons", Realtyna marketplace
- Direct partnerships z theme authors (revenue share)

#### B.4.6. Progressive Enhancement — Tier 1 → 2 → 3 auto-suggested

System monitoruje performance i sam proponuje upgrade tier:

```typescript
// Background job: weekly tenant health check
async function suggestTierUpgrade(tenantId: string) {
  const stats = await getTenantStats(tenantId, { period: '7d' });
  
  if (stats.tier === 'observer' && 
      stats.sessions > 1000 && 
      stats.archetypes_detected > 50 &&
      stats.engagement_uplift_potential > 0.15) {
    
    // Auto-generate "before/after" preview
    const preview = await generateAdaptationPreview(tenantId);
    
    // Send dashboard notification + email
    await sendUpgradeOffer(tenantId, {
      target_tier: 'augment',
      projected_uplift: '+18-28% conversions',
      preview_url: preview.url,
      one_click_enable: true,
      // Crucial: schema już skonfigurowany, więc upgrade = 1 click
      schema_already_validated: true
    });
  }
}
```

---

### B.5. Schema Discovery & Auto-Configuration Pipeline

#### B.5.1. Layered detection strategy

System próbuje wykryć strukturę w **5 warstwach**, od najmniej do najbardziej kosztownej:

| Layer | Method | Coverage | Cost | Latency |
|---|---|---|---|---|
| **L1: Schema.org JSON-LD** | Parse `script[type="application/ld+json"]` | ~40% stron | $0 | <50ms |
| **L2: Microdata** | Parse `itemtype="...RealEstateListing"` | ~10% stron | $0 | <50ms |
| **L3: Platform fingerprint** | Hostname + DOM signatures match | ~25% stron | $0 | <100ms |
| **L4: Heuristic detection** | Common patterns (h1, .gallery, .price, etc.) | ~15% stron | $0 | <200ms |
| **L5: AI Vision (Claude)** | Screenshot + HTML → Sonnet 4.6 | 100% fallback | $0.33 | 5-10s |

**Logic:** Layer L1-L4 są sprawdzane najpierw (free, fast). Tylko jeśli żaden nie da `confidence > 0.85`, przechodzi do L5 (AI).

#### B.5.2. Field mapping — od raw payload do Estalara standard schema

```typescript
// Standard schema do którego mapujemy wszystko
type EstalaraListingSchema = {
  // Required fields
  listing_id: string;
  title: string;
  price: { value: number; currency: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED' };
  photos: Array<{ url: string; alt?: string; order: number }>;
  
  // Recommended fields
  description?: string;
  features?: string[];
  location?: { 
    address?: string; 
    city?: string; 
    region?: string; 
    country?: string;
    coordinates?: { lat: number; lng: number };
  };
  
  // Specific fields (extracted via NLP from features if not direct)
  bedrooms?: number;
  bathrooms?: number;
  area_sqm?: number;
  property_type?: 'apartment' | 'villa' | 'house' | 'penthouse' | 'land' | 'commercial';
  
  // Adaptation hints
  amenities?: string[];      // pool, garden, parking, etc. (parsed)
  energy_rating?: string;
  year_built?: number;
};

// Mapping config przechowywana per tenant
type TenantSchemaMapping = {
  detection_source: 'schema.org' | 'microdata' | 'platform_template' | 
                    'heuristic' | 'ai_vision' | 'manual';
  detection_confidence: number;
  selectors: Record<keyof EstalaraListingSchema, SelectorStrategy>;
  parsers: Record<string, ParserConfig>;  // np. parser dla "4 dormitorios" → bedrooms: 4
  last_validated: string;
  validation_health: number;  // 0-1, ile selectors nadal działa
};

type SelectorStrategy = {
  primary: { type: 'css' | 'xpath' | 'json_path'; value: string };
  fallbacks: Array<{ type: 'css' | 'xpath' | 'json_path'; value: string }>;
  validator?: string;  // np. "value.length > 10 && value.length < 200"
  parser?: 'text' | 'number' | 'currency' | 'array' | 'json';
};
```

#### B.5.3. NLP-powered feature extraction

Surowe features często są w formie text list ("4 dormitorios, 3 baños, piscina, jardín"). System parsuje to przez Claude Haiku:

```typescript
async function parseFeatures(rawFeatures: string[], locale: string) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Extract structured data from real estate features list (locale: ${locale}).
      
      Features: ${JSON.stringify(rawFeatures)}
      
      Return ONLY JSON:
      {
        "bedrooms": number | null,
        "bathrooms": number | null,
        "area_sqm": number | null,
        "amenities": string[],  // normalized English: "pool", "garden", "parking", etc.
        "energy_rating": string | null,
        "year_built": number | null
      }`
    }]
  });
  
  return JSON.parse(response.content[0].text);
}
```

**Cost:** ~$0.001 per listing parsing (Haiku 4.5). Cached per listing — parsed raz przy ingest.

#### B.5.4. Predictive drift detection (extends B.6 reactive)

B.6 opisuje reactive drift detection — czeka aż SDK zgłosi błąd, co oznacza że tenant traci dane przez czas detection + recovery (typowo kilka godzin). Dokładamy *predictive layer*, który wykrywa drift **zanim** SDK zacznie zgłaszać błędy.

**Weekly cron job (per tenant, Modal scheduler):**

```
1. Re-crawl primary_url (Puppeteer headless, render JS, snapshot DOM)
2. Serialize DOM tree → canonical string (struktura + class/id signature, bez treści tekstowej)
3. Compute DOM signature embedding (BGE-M3, 1024 dims) → "schema fingerprint"
4. Compare vs ostatni stored fingerprint (cosine similarity)
5. IF cosine < 0.85:
     - Flag tenant jako "potential drift"
     - Schedule full B.4 re-detection (AI Vision + selectors)
     - Notify admin email (transparent: "your site changed, we're re-detecting")
   IF cosine >= 0.85:
     - Continue, log fingerprint do `schema_fingerprints` (history)
```

**Real-time anomaly detection (continuous, ClickHouse query):**

- Track event volume per tenant per hour (rolling 24h baseline ± 2σ)
- Sudden drop > 50% w 1h window z statistical significance (Welch's t-test, p < 0.01) → potential drift signal
- Trigger validation pass na 5 random listings (run B.6.1 health check ad-hoc)
- Auto-fix if health < 0.85 confirmed (per B.6.3)

**DOM signature embedding — szczegóły implementacji:**

```typescript
async function computeDomFingerprint(html: string): Promise<number[]> {
  // 1. Strip text content, keep structure
  const skeleton = serializeStructure(html, {
    keep: ['tag', 'class', 'id', 'data-*'],
    drop: ['textContent', 'inline_styles', 'src', 'href']
  });

  // 2. Embed with BGE-M3 (self-hosted Modal endpoint)
  const embedding = await bgeM3.embed(skeleton);
  return embedding;  // 1024-dim float array
}
```

Storage: `schema_fingerprints (tenant_id, taken_at, fingerprint_vector pgvector(1024), source_url)`. Retention 90 dni. Index na (tenant_id, taken_at DESC).

**Cross-reference:** to jest baza dla Innowacji R.4 (Self-Healing Schema Detection — Predictive). Plus feed do K.3.3 Alerts Center jako alert type "schema_drift_predicted" (severity: warning).

---

#### B.5.7. Detection → Adaptation runtime bridge & no-code integration (ADR-0008, FOLLOW-159/160)

**Zasada nadrzędna (CEO, 2026-06-01): integracja jest no-code.** Kod tenanta — w szczególności
**`app.estalara.com` (żywy produkt)** — NIE jest modyfikowany poza standardowym snippetem loadera
SDK. Adaptacja strony szczegółów jest napędzana **wyłącznie detekcją** (§B.5.1–B.5.6) + runtime
bridge poniżej. (To unieważnia podejście FIX-014, które dokładało `data-estalara-*` do szablonu —
PORZUCONE/superseded.)

**Most detekcja→adaptacja (zaimplementowany — `packages/sdk/src/core/annotate-slots.ts`).** Pipeline
detekcji produkuje `TenantSiteSchema.detail_schema.slot_selectors` (CSS-selektory headline/CTA/
description na **istniejącym** DOM tenanta), ale silnik adaptacji mutuje wyłącznie elementy z
`data-estalara-slot`. `annotateSlots(slot_selectors)` domyka tę lukę: dostaje z `/api/adapt` płaską
mapę `{ klucz_detekcji → selektor CSS }` (projekcja `SelectorStrategy.primary`, robiona serwerowo w
`apps/control-plane/src/lib/tenant-schema.ts`), nigdy nie nadpisuje istniejącego
`data-estalara-slot`, nigdy nie rzuca, i **tłumaczy słownik detekcji na słownik adaptacji**:
`headline→headline`, `cta_primary→cta`, `description→description`; klucze nieujęte w tabeli trafiają
do DOM dosłownie. Tabela tłumaczeń `SLOT_NAME_TRANSLATION` jest **jedynym** punktem przekładu
(11 technik auto-detekcji + kurowany schemat DB zasilają tę jedną funkcję).

**Zakres anotacji — dla slotów TŁUMACZONYCH wyłącznie dopasowanie JEDNOZNACZNE (FOLLOW-801,
2026-08-03; przywraca `ADR-0008` §Decision.1).** Gdy selektor tłumaczonego klucza (dziś: `cta`)
dopasuje **więcej niż jeden** element, nie jest anotowany **żaden** i leci obserwowalne
`adapt.skipped {reason: 'ambiguous_slot_selector', match_count}`. Powód: selektory producenta są
z natury szerokie — `a[href*="contact"]` (`wordpress.ts`, `json-ld.ts`),
`[class*='cta'], [class*='button']` (`css-modules.ts`) — więc na realnej stronie tenanta łapią link
w nawigacji, CTA karty i link w stopce naraz; anotowanie wszystkich oddaje każdy z nich
`applyTextDirective`, który nadpisuje `textContent` i (od FOLLOW-791) uzbraja na każdym
MutationObserver broniący nadpisania w nieskończoność. Wybór pierwszego dopasowania byłby
zgadywaniem po kolejności w dokumencie — lepiej nie adaptować nic i to zaraportować.
Klucze **nietłumaczone** (`headline`, `description`) zachowują zachowanie every-match sprzed
FOLLOW-796 — ich zawężenie to osobna, świadoma decyzja, nie skutek uboczny (zapięte testem
`packages/sdk/src/__tests__/follow-801-slot-scope.test.ts`).

> _Historia (FOLLOW-796, 2026-08-03):_ przepisanie z FOLLOW-340 (`augment.ts` →
> `annotate-slots.ts`) zgubiło mapowanie `cta_primary→cta`, przez co na tenantach bez ręcznego
> markupu każda dyrektywa `cta` kończyła się `adapt.skipped {no_slot_elements}` (RETRO-093 §4a
> LG-1). Przywrócone i objęte testem z parą **nie-pokrywającą się** (klucz `cta_primary` przeciw
> dyrektywie `cta`).

Następnie istniejące ścieżki adaptują BEZ markupu tenanta:

- **headline / cta** → dyrektywy `TextDirective` z playbooka `/api/adapt` (`applyDirectives`).
- **description** → dedykowany pipeline **`GET /api/adapt/description`** (§E.7), konsumowany przez
  `packages/sdk/src/core/adapt-description.ts` i zapisywany jako `textContent` (bezpieczne wobec
  HTML-injection) do anotowanego elementu.

**Parytet producent↔konsument (wymóg):** każdy detail-slot który detekcja *wykrywa* musi być też
*modyfikowany* w DOM (i odwrotnie). Obecny zakres parytetu: `headline`, `cta`, `description`.
`features_list` / `tagline` — poza zakresem v1 (nie wykrywane ani nie adaptowane; AC7 FOLLOW-159).
Konsekwencja dla playbooków: dyrektywa `feature` **nie jest osiągalna** przez self-anotację —
`features_list` nie ma producenta (żadna technika auto-detekcji go nie emituje), a `feature` jest
`TextDirective` nadpisującą `textContent`, więc anotowanie kontenera listy cech skasowałoby całą
listę tenanta. Odblokowanie wymaga najpierw producenta po stronie detekcji (osobny ticket), nie
samego przemianowania (FOLLOW-796 AC-3; zachowanie zapięte testem
`packages/sdk/src/__tests__/follow-796-slot-name-translation.test.ts`).

**Dostarczenie schematu do SDK (B1 — planowane).** Dla bespoke sajtów detekcja client-side zwraca
`null` (poniżej), więc SDK otrzymuje `slot_selectors` **aktywowanego schematu serwerowego** jako
**additive, opcjonalne pole odpowiedzi `/api/adapt`** (endpoint kanoniczny per ADR-0004/0006/0007;
bez extra round-tripu — SDK już woła `/adapt`). Wymaga rozszerzenia `getTenantSchema`
(`apps/control-plane/src/lib/tenant-schema.ts`, dziś zwraca reorder-only `TenantSiteSchemaMin`) o
`detail_schema.slot_selectors`. SDK woła `annotateDetectedSlots` w `refreshDirectives` przed
`applyDirectives`.

**Zweryfikowane ograniczenie detekcji dla bespoke sajtów (2026-06-01).** Tabela §B.5.1 zakłada
**L5: AI Vision = screenshot + HTML**; implementacja (`packages/sdk/src/auto-detect/techniques/
ai-vision.ts`) wysyła obecnie **tylko tekst HTML** (pierwsze 50 KB) — dryf projekt↔implementacja.
Dla `app.estalara.com` (custom SvelteKit + Tailwind, brak semantycznych klas): client-side
deterministyczna detekcja → `confidence 0 / null`; AI Vision → `confidence 0.3` (poniżej progu 0.5)
i spekulatywne selektory, które na realnym DOM dają headline→**cena**, cta/description nierozwiązane.
Wniosek: **AI Vision tekst-HTML jest niewystarczająca dla bespoke/Tailwind**.

- **Pilot first-party (app.estalara.com) — A1 minimalne haki (DECYZJA 2026-06-01, ADR-0008 Update):**
  zweryfikowano, że app.estalara.com ma **zero stabilnych haków** (brak id/data-*, tylko Tailwind +
  Svelte-hash; jedyny `<h1>` to cena, brak elementu tytułu) → kurowane selektory byłyby kruche, a
  headline nie ma targetu. CEO wybrał **A1: dodać kilka kanonicznych haków** do szablonu listingu
  (kanoniczny Tier-2 „declarative slots"; uzasadnione, bo to NASZ first-party sajt). Zaimplementowane
  w repo Estalara-app (`web-master/.../listing/[slug]/+page.svelte`, flaga
  `PUBLIC_ESTALARA_SDK_ENABLED`; handoff prod: `web-master/HANDOFF_ESTALARA_ADAPTIVE.md`). Z hakami
  `data-estalara-slot` SDK używa **ścieżki bezpośredniej** (headline → dyrektywa playbooka `/adapt`;
  description → konsument `/api/adapt/description`) — więc **kurowany schemat i B1 NIE są potrzebne
  dla pilota**.
- **Plan A — kurowany schemat (THIRD-PARTY, gdzie nie możemy dodać haków):** aktywowany rekord
  `tenant_site_schemas` jest **kurowany/ręcznie autorski** — realne, ludzko-zweryfikowane selektory
  na faktyczny DOM. No-code z perspektywy tenanta (selektory w DB Estalary). Applicator + konsument
  opisu działają bez zmian. Ryzyko kruchości łagodzi Continuous Schema Validation (§B.6) + fallbacki
  w `SelectorStrategy` + guard unikalnego dopasowania. Wymaga rozszerzenia `getTenantSchema` + B1
  (pole `slot_selectors` w `/api/adapt`).
- **Plan B (self-serve, follow-up — FOLLOW-160):** realign AI Vision do projektu §B.5.1 —
  **screenshot + HTML → Claude Vision** — dla robust, automatycznej detekcji bespoke sajtów bez
  ręcznego autorstwa. Pilot NIE blokuje się na Planie B.

---

### B.6. Continuous Schema Validation & Self-Healing

**Problem:** Strony klientów się zmieniają (redesign, A/B test, theme update). Selectors mogą się zepsuć. Bez automatyzacji to znaczy: tenant wyłącza Estalara, churn.

**Rozwiązanie:** Auto-detection driftu + auto-fix.

#### B.6.1. Health check pipeline

```
Cron job (daily, per tenant):
  ┌───────────────────────────────────────────────────┐
  │ 1. Sample 10 random listings z ostatnich 24h     │
  │ 2. Re-validate każdy selector:                    │
  │    - Czy selector zwraca element?                 │
  │    - Czy typ danych się zgadza?                   │
  │    - Czy value passes validator?                  │
  │ 3. Compute "schema health score" (0-1)            │
  │ 4. Jeśli health < 0.85:                           │
  │    a. Trigger auto re-detection (B.4 pipeline)    │
  │    b. Compare new schema vs stored                │
  │    c. Auto-update jeśli new confidence > stored   │
  │    d. Notify admin email (transparent)            │
  │ 5. Log do audit trail (ClickHouse)                │
  └───────────────────────────────────────────────────┘
```

#### B.6.2. Real-time drift detection (z SDK telemetry)

SDK na żywo raportuje failures:

```typescript
// W SDK na cudzej stronie:
function captureListingData(selectors: TenantSchemaMapping) {
  const result = {};
  const failures = [];
  
  for (const [field, strategy] of Object.entries(selectors.selectors)) {
    try {
      const element = document.querySelector(strategy.primary.value);
      if (!element) {
        // Try fallbacks
        for (const fallback of strategy.fallbacks) {
          const el = document.querySelector(fallback.value);
          if (el) { result[field] = extractValue(el); break; }
        }
        if (!result[field]) failures.push(field);
      } else {
        result[field] = extractValue(element);
      }
    } catch (e) {
      failures.push(field);
    }
  }
  
  // Telemetry: jeśli >2 failures, fire alert event
  if (failures.length > 2) {
    Estalara.track('schema.drift_detected', {
      failures,
      page_url: window.location.href,
      sample_html_hash: hashHTML(document.body.innerHTML.slice(0, 1000))
    });
  }
  
  return result;
}
```

#### B.6.3. Auto-recovery flow

```
SDK reports drift → Backend:
  1. Aggregate drift events across tenant (>10 in 1h = real issue)
  2. Trigger Puppeteer re-crawl on affected URL
  3. Run B.4 detection pipeline (Schema.org → AI Vision)
  4. Compare new vs stored schema (JSON diff)
  5. Auto-apply if:
     - New confidence > 0.9
     - All required fields detected
     - No regression w other listings
  6. Email notification to admin:
     "We detected your site changed (theme update?) and 
      automatically updated our integration. No action needed.
      [View changes] [Revert if needed]"
```

**Mean time to recovery: <30 minut** od detected drift do auto-fix.

---

### B.7. Onboarding Metrics & Success Criteria

| Metric | Target | Measurement |
|---|---|---|
| **Time to first script tag** | <60s | Z dashboardu signup do code copied |
| **Time to data flowing** | <5min | Od code paste do pierwszego event w ClickHouse |
| **Time to first insight** | <1h | Od pierwszych eventów do dashboard widget z archetype |
| **Admin clicks required** | <3 | Signup → Paste URL → Copy code → Done |
| **Developer involvement** | Optional | WordPress plugin / magic link auto-install |
| **Configuration fields** | 0-2 | Tylko URL site (opcjonalnie API token dla power users) |
| **Onboarding success rate** | >90% | % tenantów którzy reach "data flowing" stan w pierwszych 7 dniach |
| **Schema auto-detect accuracy** | >95% | Manual review na sample 100 onboardings |
| **Schema drift recovery rate** | >90% | % auto-recovered bez admin intervention |

---

## C. Signal Ingestion & Data Sources

### C.1. Pełna taxonomia sygnałów (event schema)

Wszystkie eventy mają wspólny envelope:

```typescript
type EstalaraEvent = {
  event_id: string;          // UUIDv7
  tenant_id: string;
  session_id: string;        // session-scoped fingerprint hash
  archetype_hint?: string;   // populated by intent engine, not SDK
  listing_id?: string;
  ts: number;                // ms since epoch (client clock + server skew)
  region: 'eu' | 'us' | 'uk' | 'uae';
  consent_state: 'none' | 'legitimate-interest' | 'consented';
  type: EventType;
  payload: Record<string, unknown>;
};
```

**Pełne kategorie eventów:**

SDK Producer Status legend: ✅ Active (SDK emituje, SIGNAL_LIKELIHOODS wired) | 🔧 Schema-only (Zod schema istnieje, brak SDK observera) | 📋 Planned (brak schematu, zadeklarowane w architekturze)

| Kategoria | Przykładowe eventy | Throughput / sesja | SDK Producer Status |
|---|---|---|---|
| **Page lifecycle** | `page.view`, `page.exit`, `tab.visible`, `tab.hidden` | 5–15 | ✅ Active |
| **Mouse/scroll behavioral** | `scroll.depth` (10/25/50/75/90%), `mouse.dwell`, `mouse.rage_click`, `mouse.exit_intent` | 50–500 (sampled) | ✅ Active (`scroll.depth`) / 🔧 Schema-only (rest) |
| **Photo interactions** | `photo.opened`, `photo.gallery.next`, `photo.zoomed`, `photo.dwell` (per photo) | 10–100 | 🔧 Schema-only → ✅ Active after FOLLOW-099 |
| **Floorplan engagement** | `floorplan.opened`, `floorplan.zoom`, `floorplan.dwell` | 0–20 | 📋 Planned |
| **Price/feature focus** | `price.hovered`, `price.compared`, `feature.expanded`, `mortgage_calc.used` | 5–30 | 🔧 Schema-only → ✅ Active after FOLLOW-099 |
| **Search/filter behavior** | `search.query`, `filter.applied`, `filter.removed`, `sort.changed` | 5–50 | 🔧 Schema-only → ✅ Active (`filter.applied`) after FOLLOW-099 |
| **Inquiry / conversion** | `inquiry.started`, `inquiry.completed`, `tour.requested` | 0–3 | 🔧 Schema-only → ✅ Active (`inquiry.started`) after FOLLOW-099 |
| **Chat (NLP target)** | `chat.opened`, `chat.message.sent`, `chat.intent.detected` (server-side) | 0–30 | 🔧 Schema-only → ✅ Active after FOLLOW-087 + FOLLOW-101 |
| **Quiz signals** | `quiz.event`, `quiz.mismatch` | 0–2 | ✅ Active |
| **Cross-listing journey** | `listing.viewed`, `listing.next`, `listing.compared`, `listing.bookmarked` | 1–10 | ✅ Active (`listing.viewed`) / 📋 Planned (rest) |
| **Device/context** | One-time per session: device class, viewport, language, IP country/city, time-of-day | 1 | ✅ Active |

**Nowe sygnały (Sprint 15, FOLLOW-207/208/211):**
- `session.referrer` — (session-init, nie event) referrer URL + UTM keyword hints; applies investment/personal prior at session start
- `device.type` — (session-init) `desktop|mobile`; weak investor/own-use prior multiplier  
- `listing.view_rate` — (derived, calculated from listing.viewed count + session elapsed time) views/minute; high rate (≥3/min) → portfolio_builder/flip_investor; low rate (≤0.5/min) → family_buyer/first_time_buyer
- `listing.bookmarked` — (from app.estalara.com CustomEvent `estalara:listing:favorited`) explicit save-to-favorites; strongest deterministic non-quiz intent signal; payload: listingType, priceRange, bedroomCount
- `filter.applied` (enriched) — existing planned signal (FOLLOW-099) now with required payload: `{facet: string, value: string|number}`; facet-conditional likelihoods: `type=commercial` → commercial_investor; `bedrooms_min≥3` → family_buyer/upsizer; `sort=yield` → yield_hunter
- `micro_poll.answered` — (new widget, FOLLOW-209) single yes/no micro-poll answer; applies one QUIZ_LIKELIHOODS axis update; trigger: 90s into session if quiz not completed
- `dwell.time` — (timer, FOLLOW-190 / FOLLOW-227) per-listing dwell boost: leading archetype receives `likelihood = 1 + 0.08 × log₂(elapsed_ms / 30 000)` at 30 s / 90 s / 180 s thresholds; capped at `DWELL_MAX_SESSION_CONTRIBUTION = 3` ticks per tab-session (idempotent across cross-listing rehydration — `IntentState.dwell_ticks_applied` persisted to sessionStorage)

### C.2. Ingestion rate i strategia

- Klient wysyła batches **co 2 sekundy** (lub immediate flush dla `inquiry.*` i `chat.*`)
- Realistic peak: 100k DAU x avg 60 events/session = **6M events/dzień** w Year 1; rozdzielone na ~70k events/sec peak (przy mocnym targowym ruchu) — Cloudflare Workers obsłuży to bez problemu, ClickHouse Cloud na tier $500/mo ingestuje 100M+/dzień
- Real-time path (chat / live adaptation): WebSocket lub Server-Sent Events przez Cloudflare Durable Objects
- Batch path (analytics, model training): Redpanda Cloud → ClickHouse via Kafka connector

### C.3. NLP na chacie

Dla `chat.message.sent`:
- **Real-time intent extraction** — **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`), structured output schema dla 12 wymiarów intentu (patrz D.4). Latency target: **<500ms** od message send do intent vector update. Haiku 4.5 jest właściwym wyborem dla real-time: typowy czas odpowiedzi 100–300ms, koszt $1/$5 per MTok.
- **Batch enrichment co 6h** — **Claude Sonnet 4.6** (`claude-sonnet-4-6`), re-process pełnego kontekstu konwersacji dla lepszych embeddings i kalibracji archetype priors. Bez ograniczenia latency — async Modal job. Sonnet 4.6 daje zauważalnie wyższą accuracy na wieloturowych konwersacjach i mixed-language input (EN/PL/ES). Koszt $3/$15 per MTok.
- **Uzasadnienie dwutierowego podejścia:** real-time path wymaga <500ms — Sonnet 4.6 nie mieści się wygodnie przy złożonych promptach. Batch path nie ma ograniczenia czasowego — tu lepsza jakość (Sonnet) przynosi lepsze archetype priors dla następnego dnia. Oba modele używają identycznego output schema (12-dim intent vector), wybór modelu jest parametrem konfiguracyjnym per-path (`INTENT_REALTIME_MODEL`, `INTENT_BATCH_MODEL` w Doppler).
- **Multilingual edge case:** przy wiadomościach mieszanych językowo (PL+EN w jednej sesji) real-time fallback do Sonnet 4.6 gdy `detect_language_mix(message) = true` i `haiku_confidence < 0.6` (do zaimplementowania w `apps/intent-engine` — patrz FOLLOW-087).

### C.4. Intent Pipeline Event Contracts

Kontrakty eventów kluczowe dla połączenia `apps/intent-engine` (FOLLOW-087) z SDK (FOLLOW-101).

**`chat.intent.detected` — emitowany przez `apps/intent-engine` po NLP:**

```typescript
// TBD pending FOLLOW-087 — schema stabilizuje FOLLOW-101
type ChatIntentDetectedPayload = {
  intent_dimensions: ChatIntentDimensions;  // 12-dim structured vector (§D.1)
  archetype_hint: Archetype;                // top archetype prediction
  confidence: number;                       // 0–1 combined confidence
  model_used: 'haiku-4.5' | 'sonnet-4.6';  // which model produced this
  source: 'realtime' | 'batch';
  // FOLLOW-730 — extraction provenance, diagnostic only (nothing reads these to
  // decide an archetype). Needed because `extract_intent` never raises: a failed
  // model call returns the same all-null neutral payload a no-signal buyer does.
  data_source: 'model' | 'empty_input' | 'empty_model_response' | 'error_fallback';
  extraction_error: string | null;          // "<kind>: <ExceptionClass>", no message text
};

type ChatIntentDimensions = {
  purchase_purpose?: string;
  urgency?: string;
  budget_band?: string;
  family_stage?: string;
  geo_priority?: string;
  feature_priority?: string;
  cross_border?: string;
  finance_complexity?: string;
  decision_role?: string;
  risk_appetite?: string;
  emotional_state?: string;
  tax_aware?: boolean;
};
```

**Behavioral posterior diagnostics (emitowane przez SDK, dla observability):**

```typescript
type PosteriorUpdatedPayload = {
  trigger: 'behavioral' | 'quiz' | 'chat_intent';
  archetype_selected: Archetype;
  confidence: number;
  signal_counts: { behavioral: number; quiz: number; chat: number };
};
```

> **Implementation note:** `chat.intent.detected` schema jest finalizowana w FOLLOW-087. FOLLOW-101 może nie startować przed stabilizacją schematu. Kontrakt powyżej jest propozycją — może ulec zmianie.

---

## D. Intent Engine — rdzeń produktu

### D.1. Real-estate-specific intent ontology

Kluczowy MOAT vs generic personalization (Mutiny, Dynamic Yield) to **wertykalna ontologia**. Proponowane 12 wymiarów intent vector:

```
Intent Vector (per session, updated continuously):
  v_intent ∈ ℝ^256 (learned embedding) + structured dimensions:
  
1.  purchase_purpose:    [primary_residence, second_home, investment, vacation_rental, retirement, relocation]
2.  urgency:             [exploratory, 0-3mo, 3-6mo, 6-12mo, 12mo+]
3.  budget_band:         [stretch, comfortable, well_below] (relative to viewed listings)
4.  family_stage:        [single, couple, young_family, established_family, empty_nester, retiree]
5.  geo_priority:        [school_district, commute, lifestyle, beach, mountain, urban_center]
6.  feature_priority:    learned tag distribution (garden, pool, parking, modern, historic, view, ...)
7.  cross_border:        [domestic, eu_intra, foreign_buyer, expat_returning]
8.  finance_complexity:  [cash, standard_mortgage, foreign_mortgage, investment_vehicle, mortgage_uncertain]
9.  decision_role:       [decider, influencer, researcher_for_others]
10. risk_appetite:       [conservative, balanced, aggressive] (signaled by reading legal/title content)
11. emotional_state:     [excited, frustrated, comparison_shopping, validating_choice]
12. tax_aware:           boolean + jurisdiction hints
```

Każdy wymiar ma **confidence score** (0–1). Adaptation engine zachowuje się tylko gdy *combined confidence > threshold* (default 0.6).

#### D.1.1. Mapowanie 12-dim intent vector → archetype posterior update

Gdy `chat.intent.detected` event dotrze do SDK, wywoływana jest `applyChatIntentPrior(state, intentDimensions)` — parallel do `applyQuizPrior()`. Chat intent jest traktowany jak silny prior (NIE behaviorally damped, weight = `QUIZ_CONFIDENCE_BONUS`).

**`CHAT_INTENT_LIKELIHOODS` — mapping reguł (do zaimplementowania w `packages/sdk/src/core/intent.ts`, FOLLOW-100):**

```
purchase_purpose=investment        → yield_hunter:0.7, vacation_rental_investor:0.6, flip_investor:0.6, portfolio_builder:0.7, golden_visa_buyer:0.5, commercial_investor:0.5
purchase_purpose=second_home       → second_home_buyer:0.85, lifestyle_expat:0.4
purchase_purpose=vacation_rental   → vacation_rental_investor:0.9
purchase_purpose=retirement        → retiree_relocator:0.85, downsizer:0.5
purchase_purpose=relocation        → lifestyle_expat:0.7, remote_worker:0.6, retiree_relocator:0.4
cross_border=foreign_buyer         → golden_visa_buyer:0.7, lifestyle_expat:0.6, diaspora_buyer:0.4
cross_border=expat_returning       → diaspora_buyer:0.85
family_stage=young_family          → family_buyer:0.8, student_parent:0.4
family_stage=established_family    → family_buyer:0.7, upsizer:0.5
family_stage=empty_nester          → downsizer:0.75, retiree_relocator:0.3
family_stage=retiree               → retiree_relocator:0.85, downsizer:0.6
finance_complexity=investment_vehicle → yield_hunter:0.6, golden_visa_buyer:0.6, commercial_investor:0.5
finance_complexity=standard_mortgage  → first_time_buyer:0.7, family_buyer:0.4
urgency=0-3mo + purchase_purpose=investment → flip_investor:0.8
urgency=12mo+ + purchase_purpose=investment → portfolio_builder:0.7
geo_priority=school_district       → family_buyer:0.7, student_parent:0.6
feature_priority=workspace         → remote_worker:0.85
budget_band=comfortable + purchase_purpose=primary → luxury_buyer:0.6
tax_aware=true                     → yield_hunter:0.4, golden_visa_buyer:0.5, vacation_rental_investor:0.4
```

**Mismatch detection:** jeśli `quiz.event` już odpowiedziano i `chat_archetype ≠ quiz_archetype` z confidence > 0.5 obydwóch — SDK emituje `quiz.mismatch` event i wybiera źródło z wyższym combined confidence.

> **Schema:** TBD pending FOLLOW-087. `CHAT_INTENT_LIKELIHOODS` powyżej to propozycja do weryfikacji przy implementacji FOLLOW-100.

**Shadow-key write-admission rule (ADR-0020, implemented by FOLLOW-736 2026-07-30).**

The Redis key `shadow:{tenant_id}:{session_id}:chat_intent` is written by three call sites in
`apps/intent-engine` (`main.py`, `local_dev.py`, `jobs/batch_enrich.py`) and read on every
`/api/adapt` call by `readShadowChatIntent`. **Before:** every write was an unconditional
`SET … EX 86400`, so an extraction carrying no dimensions — whether the Anthropic call failed
(`data_source ∈ DEGRADED_DATA_SOURCES`) or the buyer simply said "hi" — destroyed whatever prior
the session had accumulated. **After (ADR-0020):**

1. **Ruling.** An extraction carrying no usable dimension never neutralises a stored prior. The
   key keeps serving the last good read until a new good read replaces it or the 24h TTL expires
   it. A failed call is a fact about our infrastructure, not about the buyer; staleness is already
   bounded by the TTL; and because the SDK folds the chat prior **once per session** (Rule R
   `chatPriorApplied`, FOLLOW-252), a prior destroyed before that read is lost for the whole
   session.
2. **Keyed on content, not provenance.** The admission predicate `has_intent_signal(dims)` takes
   `ChatIntentDimensions`, not the payload, so it cannot read `data_source` — DIAGNOSTIC ONLY
   (§C.4) is enforced by the parameter type. It is a line-for-line mirror of
   `flattenIntentDimensions` (`chat-intent-cache.ts:176-191`): `null` → no signal, `bool` → signal
   only when `true`, `str` → signal only when non-empty, any other type → no signal. Pinned on both
   runtimes by `tests/fixtures/chat-intent-signal-parity.json`.
3. **Atomicity.** Non-empty → `SET key value EX 86400` (unchanged). Empty → `SET key value EX 86400
   **NX**`. One command, no GET, no Lua, no read-then-write window across concurrent per-message
   Modal containers. Invariant: *the only command that can remove a good record is a `SET` carrying
   non-empty dimensions.*
4. **TTL invariant.** A write may only shorten or leave unchanged the residual lifetime of
   previously-stored personal data, never extend it — `SET … NX` against an existing key performs
   no mutation, so the preserved record's retention clock is not refreshed. Effective lifetime
   becomes "24 h from the last chat message that yielded at least one dimension" (≤ the 24 h
   asserted in C-07 Q3.1 / ROPA / DPIA).
5. **Validation + visibility.** No read-back, so `json.dumps(payload.model_dump())` remains the
   only serialization path into the key (the fact the compliance evidence cites). There is no
   merged record and no sibling field: a preserved record is untouched, so its
   `data_source`/`extraction_error` always describe the dimensions beside them. Visibility of a
   *suppressed* degraded write is a **named, dated blind window** (ADR-0020 §D6, amended by
   FOLLOW-741): of the three channels, only the key itself on a cold session is real today. The
   Sentry capture stays inert for as long as `SENTRY_DSN` is absent from the Modal
   `estalara-secrets` secret (verify by listing that secret — do not infer it from a ticket
   status); the payload returned by `process_chat_message` is never read at all, because `main.py`
   dispatches it with fire-and-forget `.spawn()` and returns 202. Closing those two channels is
   FOLLOW-740. Do not read the absence of alerts as "it never happens".

`profiling_opt_out` (§H.9) remains the first statement in the writer and gates both branches. No
SDK and no control-plane change is in scope.

### D.2. Architektura model serving

| Warstwa | Model | Latency budget | Koszt na 1k inferencji |
|---|---|---|---|
| **On-device (SDK)** | Małe heurystyki + lookup table (top-100 najczęstszych patternów) | <10ms | $0 |
| **Edge inference** (Cloudflare Workers AI) | Embedding model: BGE-M3 (open weights, MIT) self-hosted lub Workers AI built-in | 50–80ms | ~$0.02 |
| **Server-side fast** (Modal serverless GPU) | Custom fine-tuned Llama 3.1 8B na real-estate intent classification (planowane Y2; Y1 używamy Haiku 4.5) | 150–300ms | ~$0.50 (Haiku 4.5) |
| **Chat NLP real-time** (`apps/intent-engine`) | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — structured intent extraction per wiadomość | <500ms | ~$0.002–0.005 / wiadomość |
| **Chat NLP batch enrichment** (`apps/intent-engine`, 6h cron) | Claude Sonnet 4.6 (`claude-sonnet-4-6`) — re-process pełnego kontekstu konwersacji | async (bez limitu) | ~$0.01–0.03 / konwersacja |
| **Server-side deep** (Modal + Claude Sonnet 4.6) | Złożone decyzje adaptacji, content rewrite, multi-step reasoning | 800–2000ms | ~$8–12 (Sonnet 4.6) |

**Decyzja kluczowa: w MVP NIE fine-tunujemy własnego LLM-a.** Używamy Claude Haiku 4.5 dla 90% przypadków ($1/$5 per MTok) ([Anthropic](https://www.anthropic.com/news/claude-haiku-4-5)) i Sonnet 4.6 dla skomplikowanych sytuacji ($3/$15 per MTok). Per-token economics zaczynają faworyzować self-hosted dopiero powyżej ~15M embeddingów/miesiąc ([zUdyog analysis](https://www.zudyog.com/blog/embedding-models-comparison-guide)).

### D.3. Wybór embeddings — szczegółowo

| Model | MTEB score | Cena | Decyzja |
|---|---|---|---|
| OpenAI text-embedding-3-small | 62.3% | $0.02/MTok | **Default w MVP** — najtańszy z dobrej jakości, dimensions configurable (Matryoshka) |
| Cohere embed-v4 | ~65% | $0.10/MTok | Lepszy multilingual (ważne EU/UAE) — opcja dla enterprise tier |
| BGE-M3 (self-hosted) | 63.0% | ~$5–20/M tokens infrastructure | **Year 2 migration target** gdy volume > 15M embed/mo, savings $1k+/mo per ([Reintech](https://reintech.io/blog/embedding-models-comparison-2026-openai-cohere-voyage-bge)) |
| Voyage-3 / 4 | 67–71% | $0.10/MTok | Best quality, ale małe ekosystem; rozważyć dla enterprise jeśli accuracy gain > cost |

W MVP: **OpenAI text-embedding-3-small @ 1024 dims** (Matryoshka). Jeden model = jeden vector store, prostsza migracja.

### D.4. Pipeline aktualizacji intent vector

```
Per event:
  1. Ingest (Cloudflare Worker): hash + tenant tag + push to Redpanda
  2. Stream consumer (Modal serverless function): 
     - Update structured dimensions (rule-based + small classifier)
     - If chat event: call Claude Haiku 4.5 for intent extraction
     - Recompute intent embedding (weighted moving avg over recent N events)
     - Store in Redis (Upstash, multi-region) keyed by session_id
     - Async: persist to ClickHouse + pgvector
  3. On listing render request: Decision API reads Redis (p95 <5ms), 
     calls Adaptation Engine with intent vector + listing metadata
```

### D.5. Continuous Detection Quality System

**Cel:** Osiągnąć **90% accuracy archetypu w detekcji od drugiego eventu w sesji**, dążąc do 97% accuracy po 10+ eventach. Mierzyć ciągle, poprawiać automatycznie. To jest serce produktu — bez tego adaptacja jest losowa, a A/B uplift (E.3) statystycznie nieznaczący.

#### D.5.1. Wyzwanie: ground truth bez identyfikacji

Klasyczny ML problem: jak mierzymy "accuracy" jeśli buyerzy są anonimowi (Mode A — patrz G.2) i nigdy nie deklarują swojego archetype explicit? W przeciwieństwie do supervised learning gdzie mamy `(x, y)` pary, my mamy tylko strumień zdarzeń `x_1, x_2, ..., x_n` bez label.

**Rozwiązanie: convergence-based proxy ground truth.** Zamiast jednego ground truth label per session, używamy **multi-signal consistency** jako miary correctness:

1. **Predicted archetype A z eventów 1–3** vs **Predicted archetype B z eventów 4–10** → jeśli zgodne (cosine similarity intent vectors > 0.85), prediction prawdopodobnie correct (self-consistency)
2. **Behavioral predicted archetype** vs **Chat NLP archetype** (jeśli buyer otworzył chat) → high agreement = high confidence (cross-modal agreement)
3. **Adaptation confirmation signal:** jeśli predykcja "luxury investor" prowadzi do braku zaangażowania z mortgage info ale wysokiej dwell time na exterior shots → confirmed; jeśli buyer kliknie mortgage calc → disconfirmed (causal feedback)

#### D.5.2. Bayesian update mechanism

Każdy event jest **dual-purpose**: input do current prediction AND evaluation poprzedniej prediction.

```typescript
type SessionPredictionState = {
  current_archetype: ArchetypeId;
  confidence: number;              // 0-1, posterior P(archetype | events)
  trust_score: number;             // 0-1, separate from confidence
  prediction_history: PredictionSnapshot[];
  consistency_score: number;       // % similar predictions in last N events
  signal_density: number;          // events per minute, normalized
};

async function updatePrediction(
  state: SessionPredictionState,
  newEvent: EstalaraEvent
): Promise<SessionPredictionState> {
  // 1. Compute prediction from full event history (not just delta)
  const newPrediction = await classifyArchetype(state.events.concat(newEvent));

  // 2. Bayesian update: P(archetype | events_so_far)
  const prior = state.confidence;
  const likelihood = computeLikelihood(newEvent, state.current_archetype);
  const posterior = (likelihood * prior) /
    (likelihood * prior + (1 - likelihood) * (1 - prior));

  // 3. Detect prediction stability (convergence)
  const isStable = checkStability(state.prediction_history.slice(-5));

  // 4. Trust score combines confidence × stability × signal density
  const trustScore = posterior
    * (isStable ? 1.0 : 0.7)
    * Math.min(state.signal_density / 10, 1);

  return {
    current_archetype: newPrediction.archetype,
    confidence: posterior,
    trust_score: trustScore,
    consistency_score: computeConsistency(state.prediction_history),
    prediction_history: [...state.prediction_history, snapshot(newPrediction)],
    signal_density: updateSignalDensity(state, newEvent.timestamp)
  };
}
```

Trust score jest tym co E.1 (Decision tree) konsumuje jako gating signal — adaptacja odpala tylko gdy `trust_score > tier_threshold` (Observer 0.4, Augment 0.6, Native 0.85).

#### D.5.3. Quality metrics (real-time, per tenant)

Cztery główne metryki, mierzone ciągle, surface'owane w dashboardzie K.3.4:

| Metric | Definicja | Target MVP | Target Y2 |
|---|---|---|---|
| `prediction_stability_score` | % sesji gdzie prediction nie zmieniała się przez ostatnie 5 eventów | >70% | >85% |
| `confirmation_rate` | % adaptations które wywołały expected behavior (signal post-adaptation matches archetype-predicted patterns) | >65% | >80% |
| `convergence_time_p50` | Median # eventów do stable prediction | <8 | <5 |
| `disagreement_rate` | % sesji z conflict between behavioral signals i chat NLP | <15% | <8% |

**Composite "Detection Quality Score" (DQS):**

```
DQS = 0.4 * prediction_stability_score
    + 0.3 * confirmation_rate
    + 0.2 * (1 / convergence_time_p50)   // znormalizowane do [0,1]
    + 0.1 * (1 - disagreement_rate)
```

Target: **DQS > 0.75 = "production grade"**. Poniżej 0.6 → auto-pause adaptacji dla sesji w danym archetypie (degrade do control), alert do `#estalara-ml`.

#### D.5.4. Continuous learning loop

**PER SESSION:**
- Event 1 → Initial prediction (baseline_archetype, low confidence)
- Event 2 → Bayesian update + consistency check vs Event 1
- Event 3 → Update + check
- Event N → Convergence to stable prediction OR detection of low-quality signal
- IF stable: log as confirmed sample → training queue
- IF unstable: log as "hard sample" → active learning queue (D.5.5)

**WEEKLY (Modal cron job, niedziela 02:00 UTC):**
1. Aggregate all "confirmed" sessions cross-tenant (k-anon ≥50 per archetype)
2. Apply DP noise (ε ≤ 2, per F.3)
3. Retrain archetype embeddings (gradient update, *not* full retrain — cost ~$50/tydz)
4. Canary deploy new model do 1% traffic via LiteLLM router
5. Compare DQS old vs new przez 24h (rolling window, bootstrap CI)
6. If DQS improvement > 2pp z p < 0.05: promote to 100%
7. If regression > 2pp: rollback, alert ML team via K.3.3

**QUARTERLY (Krystian + Rafał review):**
- Identify archetypes z persistent <60% confirmation rate → manual review
- Add new archetypes when >50 sessions don't fit any (clustering on hard samples, HDBSCAN nad intent embeddings)
- Retire archetypes z <100 sessions/quarter (fold into nearest neighbor)

#### D.5.5. Active learning queue

System sam identyfikuje "trudne" sesje wymagające human review:

- **Wysokie confidence ale low confirmation:** model jest pewny, ale empirycznie błędny → bias w training data
- **Disagreement** between behavioral i chat predictions (cross-modal conflict)
- **Outliers:** new patterns nie pasujące do existing archetypes (Mahalanobis distance > 3σ od najbliższego centroidu)

Krystian (CPO) co tydzień reviewuje top 20 hard samples (~30 min via internal Ops UI K.4.2). Output: decision o nowym archetypie LUB poprawka existing archetype's seed examples LUB tag jako adversarial/bot (excluded z global learning).

#### D.5.6. Strategia poprawy 90% → 97%

Roadmap accuracy z konkretnymi milestone'ami:

- **Sprint 4–6 (MVP):** baseline 70–75% DQS — 50 manualnie przygotowanych archetypów (Krystian's PhD value), rule-based + Haiku 4.5 classifier
- **Sprint 7–9 (Y1 H2):** 80–85% DQS — pierwsze cross-tenant retrains z prawdziwymi danymi pilotów (3–5 tenants × ~10k sesji/mc)
- **Sprint 10–12 (Y2 H1):** 85–90% DQS — fine-tuned classifier (Llama 3.1 8B, LoRA) zastępuje rule-based, hosted on Modal
- **Y2 H2–Y3:** 90–97% DQS — federated learning (Innowacja R.3) dla enterprise + reinforcement learning z conversion feedback (RLHF-style ale z implicit signals)

#### D.5.7. Sprint mapping dla detection quality

| Sprint | Co osiąga |
|---|---|
| Sprint 4 (Intent ontology) | Baseline classifier z confidence scoring |
| Sprint 5 (LLM gateway) | Bayesian update mechanizm |
| Sprint 6 (Embeddings + matching) | Stable prediction tracking, convergence metrics |
| Sprint 7 (Adaptation engine) | Confirmation rate measurement |
| Sprint 8 (A/B framework) | Causal uplift estimation per archetype (cross-ref E.3 — extended) |
| Sprint 9 (Compliance) | Audit trail predictions, replay capability |
| Sprint 10 (Multi-region) | Cross-region accuracy benchmarks |
| Continuous (Y1+) | Active learning queue, weekly retrains, quarterly archetype refresh |

---

### D.6. Archetype Coverage Matrix — Adaptive Listings v1.0 (reachable archetypes on app.estalara.com)

Trzy źródła sygnałów: **Behavioral** (SDK observers) / **Quiz** (2-question opt-in widget) / **Chat NLP** (12-dim intent vector, FOLLOW-087+092). Status: 🟢 Full (≥2 discriminating sources) / 🟡 Partial (1 source) / 🔴 None (no behavioral source for this tenant) / ⚪ Chat-only (chat NLP only, no behavioral signal on residential app.estalara.com).

**FOLLOW-344 (2026-06-19) — Passive discriminator column added.** CEO decision Q#2: 8 archetypes have no reliable passive behavioral discriminator in `SIGNAL_LIKELIHOODS` (`intent.ts:291-393`) and are documented as **quiz/chat-only**. Do NOT invent passive discriminators — manufacturing near-zero likelihoods produces noisy near-ties and worsens argmax instability. These archetypes are reliably reached via quiz v2.0 or chat NLP only. The `SWITCH_MARGIN` hysteresis (FOLLOW-344) mitigates near-tie flipping for the remaining behavioral archetypes.

| Archetype | Behavioral signals (SIGNAL_LIKELIHOODS) | Passive discriminator in `intent.ts` | Quiz discrimination | Chat NLP discrimination | Status (post FOLLOW-099/100) |
|---|---|---|---|---|---|
| `yield_hunter` | `listing.viewed` + `cta.clicked` (✅ active) | ✅ Strong (SIGNAL_LIKELIHOODS entries with direct boosts) | investment purpose | `purchase_purpose=investment`, `tax_aware=true` | 🟢 Full |
| `vacation_rental_investor` | `filter.applied(type=holiday)` + `feature.expanded(yield/STR)` | ⚠️ Quiz/chat-only — payload-conditional boost only (`feature.expanded` intercept); no direct SIGNAL_LIKELIHOODS entry | investment + short horizon | `purchase_purpose=vacation_rental` | 🟡 Quiz/chat-only (FOLLOW-344) |
| `flip_investor` | `price.compared` + `filter.applied(facet=renovation)` | ✅ Strong (`price.compared` SIGNAL_LIKELIHOODS entry) | investment + short horizon | `purchase_purpose=investment` + `urgency=0-3mo` | 🟢 Full |
| `portfolio_builder` | `listing.viewed(many)` + `cta.clicked` | ✅ Strong (`listing.viewed`, `cta.clicked` SIGNAL_LIKELIHOODS entries) | investment + long horizon | `purchase_purpose=investment` + `urgency=12mo+` | 🟢 Full |
| `golden_visa_buyer` | `feature.expanded(legal/visa)` | ⚠️ Quiz/chat-only — payload-conditional boost only; no direct SIGNAL_LIKELIHOODS entry; previously ⚪ Chat-only | investment purpose | `cross_border=foreign_buyer` + `finance_complexity=investment_vehicle` | ⚪ Quiz/chat-only (FOLLOW-344) |
| `commercial_investor` | `filter.applied(type=commercial)` | ⚠️ Quiz/chat-only — payload-conditional boost only; no direct SIGNAL_LIKELIHOODS entry; previously ⚪ Chat-only | investment + long horizon | `purchase_purpose=investment` + `feature_priority=commercial` | ⚪ Quiz/chat-only (FOLLOW-344) |
| `family_buyer` | `filter.applied(facet=bedrooms_min≥3)` + `mortgage_calc.used` | ✅ Strong (`mortgage_calc.used` SIGNAL_LIKELIHOODS entry) | personal + long horizon | `purchase_purpose=primary` + `family_stage=young/established` | 🟢 Full |
| `first_time_buyer` | `mortgage_calc.used` + `filter.applied(facet=price_max=low)` | ✅ Strong (`mortgage_calc.used` SIGNAL_LIKELIHOODS entry) | personal + short/medium | `purchase_purpose=primary` + `finance_complexity=standard_mortgage` | 🟢 Full |
| `upsizer` | `filter.applied(facet=bedrooms_min=large)` | ✅ Moderate (`filter.applied` payload boost via `applyFilterBoosts`) | personal + medium | `purchase_purpose=primary` + `family_stage=established_family` | 🟢 Full |
| `downsizer` | `filter.applied(facet=bedrooms_max=small)` + `feature.expanded(accessibility)` | ⚠️ Quiz/chat-only — payload-conditional boosts only; no direct SIGNAL_LIKELIHOODS entry (FOLLOW-344) | personal + long | `purchase_purpose=primary` + `family_stage=empty_nester` | 🟡 Quiz/chat-only (FOLLOW-344) |
| `luxury_buyer` | `cta.clicked(high-price)` + `photo.dwell` | ✅ Strong (`photo.dwell`, `cta.clicked` SIGNAL_LIKELIHOODS entries) | personal + any | `budget_band=comfortable` + `feature_priority=luxury` | 🟢 Full |
| `remote_worker` | `feature.expanded(home_office/internet)` | ⚠️ Quiz/chat-only — payload-conditional boost only (`feature.expanded` intercept); no direct SIGNAL_LIKELIHOODS entry (FOLLOW-344) | personal + short | `feature_priority=workspace` | 🟡 Quiz/chat-only (FOLLOW-344) |
| `lifestyle_expat` | `feature.expanded(expat/international)` | ✅ Moderate (payload-conditional boost + `photo.dwell` indirect via second_home_buyer proximity) | personal + long | `cross_border=expat` + `geo_priority=lifestyle` | 🟢 Full |
| `retiree_relocator` | `feature.expanded(accessibility/climate)` | ⚠️ Quiz/chat-only — payload-conditional boost only (`feature.expanded` intercept); no direct SIGNAL_LIKELIHOODS entry (FOLLOW-344) | personal + long | `family_stage=retiree` | 🟡 Quiz/chat-only (FOLLOW-344) |
| `diaspora_buyer` | *(cross-tenant, future)* | ⚠️ Quiz/chat-only — no SIGNAL_LIKELIHOODS entry; payload-conditional boost via `feature.expanded(expat)` only (FOLLOW-344) | any | `cross_border=expat_returning` | 🟡 Quiz/chat-only (FOLLOW-344) |
| `second_home_buyer` | `listing.viewed(tourist_area)` + `photo.dwell` | ✅ Strong (`photo.dwell` SIGNAL_LIKELIHOODS entry) | personal + medium | `purchase_purpose=second_home` | 🟢 Full |
| `student_parent` | `filter.applied(near_university)` | ⚠️ Quiz/chat-only — payload-conditional boost only (`applyFilterBoosts` intercept); no direct SIGNAL_LIKELIHOODS entry (FOLLOW-344) | any | `geo_priority=school_district` + `family_stage=young_family` | 🟡 Quiz/chat-only (FOLLOW-344) |
| `neutral` | fallback (low combined confidence) | ✅ Always (default) | — | low confidence | 🟢 Always |

**Coverage summary post FOLLOW-344:** 9/18 🟢 Full (strong or moderate passive behavioral discriminator in `SIGNAL_LIKELIHOODS`, incl. `lifestyle_expat`/`upsizer` at moderate strength), 6/18 🟡 Quiz/chat-only (weak/absent passive discriminator — reliable path is quiz v2.0 or chat NLP), 2/18 ⚪ Quiz/chat-only (previously ⚪ Chat-only, now also quiz-reachable: `golden_visa_buyer`, `commercial_investor`), 1/18 🟢 Always (`neutral` — default fallback, no passive discriminator needed). Together the 🟡 and ⚪ buckets are the 8 quiz/chat-only archetypes: `commercial_investor`, `golden_visa_buyer`, `vacation_rental_investor`, `remote_worker`, `downsizer`, `retiree_relocator`, `diaspora_buyer`, `student_parent`. Do NOT add passive discriminators for these — see FOLLOW-344 rationale above.

**Note:** Quiz/chat-only archetypes will serve `neutral` playbook if quiz is OFF and chat NLP is unavailable. ⚪ Chat-only archetypes will serve `neutral` playbook if chat NLP is unavailable or quiz is OFF.

**Unit of every count derived from this matrix in the measured pilot (CEO decision #5, 2026-09-13;
added v4.12).** A per-archetype sample is a **tab session**, not a person. The SDK mints the session
id once per tab (`packages/sdk/src/core/session.ts:89`), so a visitor with two tabs is two samples,
and per-archetype samples may be diluted across tabs. The cross-session `__estalara_xid__` keeps
being minted but is transmitted nowhere today (FOLLOW-146). FOLLOW-1204 measures the dilution once
and records the number in the FOLLOW-820 evidence. Arm assignment on the same unit is §E.3.4 item 4.

Quiz v2.0 (drzewo decyzyjne, 2026-06-05): wszystkie 17 archetypów non-neutral są teraz bezpośrednio osiągalne przez quiz. Poprzednie "🔴 None" archetypy wymagały tylko chatu — teraz mają dedykowane ścieżki w drzewie decyzyjnym (patrz §E.4.2).

---

### D.7. Confidence & Fallback Policy

> **Thresholds TBD:** Concrete values are pending FOLLOW-100 calibration on synthetic session fixtures. The policy structure is locked; numbers are placeholders.

| Signal source | Weight | Notes |
|---|---|---|
| Behavioral (SIGNAL_LIKELIHOODS) | `BEHAVIORAL_DAMPING = 0.3` × likelihood | Soft signal — gradual accumulation |
| Quiz (`applyQuizPrior`) | `QUIZ_CONFIDENCE_BONUS = 1.2` | Strong prior — explicit self-declaration |
| Chat NLP (`applyChatIntentPrior`) | `QUIZ_CONFIDENCE_BONUS = 1.2` (when `chat_confidence > 0.7`) | Strong prior — treated same weight as quiz |

**Fallback rules:**
1. If `combined_confidence <= 0.6` → serve `neutral` playbook, no DOM mutation. (Boundary is inclusive, matching code: `route.ts:275` is `if (confidence <= CONFIDENCE_THRESHOLD)`, so adaptation requires strictly `> 0.6` and exactly 0.6 serves `neutral` — corrected from `< 0.6` 2026-08-07, FOLLOW-887; the `> 0.6` phrasings at the §D.1 dimension note and §E.1 step 1 were already correct.)
2. If `quiz.enabled = false` AND no chat events → rely on behavioral only; `neutral` archetype likely until ≥5 behavioral signals
3. If `quiz_archetype ≠ chat_archetype` (mismatch, both confidence > 0.5) → use source with higher combined confidence; emit `quiz.mismatch`
4. If `chat.intent.detected` not available (FOLLOW-087 not yet shipped) → behavioral + quiz only; chat-only archetypes serve `neutral`
5. ReorderDirective (photos, listings-grid): deferred → FOLLOW-104; fallback = TextDirective only

**Source-labeling:** Adaptation decisions sourced from chat-only (⚪) archetypes should be tagged `source: 'chat_only'` in `PosteriorUpdatedPayload` for observability.

**BEHAVIORAL_DAMPING calibration (Sprint 15+):**
`BEHAVIORAL_DAMPING = 0.3` is the current unvalidated constant. Once pilot accumulates ≥500 sessions with quiz completions (ground truth labels), run logistic regression fit on `(signal_vector → quiz_archetype)` to calibrate both `SIGNAL_LIKELIHOODS` values and `BEHAVIORAL_DAMPING`. Do NOT increase damping before calibrated likelihoods cover all 17 archetypes — premature increase risks false positive archetype assignment. New ticket: FOLLOW-212 (P3, data-engineer + ml-engineer).

---

### D.8. Privacy & Consent for Behavioral and Chat Signals

Per `DECISIONS_2026-05-18 §D3` (Privacy-by-design: Adaptive Listings collects ZERO PII):

| Signal type | PII? | Basis | Notes |
|---|---|---|---|
| `photo.dwell`, `feature.expanded`, `mortgage_calc.used`, `filter.applied`, `inquiry.started` | No | Legitimate interest (behavioral telemetry, non-reversible session ID) | Anonymized — session_id = HMAC(tenant_id, anon_seed) |
| `chat.intent.detected` (12-dim vector) | No | Legitimate interest | Dimensions only (purpose, urgency, etc.) — raw chat text stays in core-master, never flows to Adaptive Listings |
| Quiz answers | No | Legitimate interest | Aggregated per session, no link to email/identity |
| Cross-tenant behavioral aggregation (future) | No | Anonymized aggregate only — DP-protected per §F |  |

**Cross-system DSR:** core-master handles email/chat deletion. Adaptive Listings has no PII to delete. For session behavioral data deletion: `tenant_id + session_id` hard-delete in ClickHouse per FOLLOW-039 flow.

> Full GDPR/CCPA/UAE PDPL compliance spec: §H.

---

### D.9. Observability Requirements for Intent Pipeline

Every intent decision MUST be traceable end-to-end for debugging and conversion attribution.

| Stage | Event / log | Owner |
|---|---|---|
| Signal received | `signal_received` log entry (signal type, payload summary, session_id) | SDK |
| Posterior updated | `posterior_updated` event (trigger source, archetype_selected, confidence, signal_counts) | SDK |
| Archetype selected | `archetype_selected` log (archetype, confidence, source: behavioral/quiz/chat/mixed) | SDK |
| Directive selected | `directive_selected` log (slot, directive_type, variant_index) | SDK |
| Slot matched | `slot_matched` log (slot name, element selector, match method: auto-detect L1–L5) | SDK |
| Directive applied | `directive_applied` event (slot, old_text_hash, new_text_hash) | SDK |
| Directive skipped | `directive_skipped` log (slot, reason: low_confidence/slot_not_found/reorder_deferred) | SDK |

These events are consumed by TICKET-PILOT-003 (CTA lift dashboard) and feed the conversion attribution pipeline.

---

## E. Adaptation Engine

### E.1. Decision tree (logiczny, nie ML)

```
1. Is intent confidence > 0.6?
   NO → return default listing (no adaptation, log impression)
   YES → proceed
   
2. Match buyer to nearest archetype (cosine similarity in archetype space)
   - If similarity > 0.85: use archetype's pre-computed adaptation playbook
   - If 0.6 < similarity <= 0.85: use playbook + LLM tweak
   - If similarity <= 0.6: full LLM-driven decision (more expensive)
   (boundary operators match route.ts:323,328: playbook requires strictly > 0.85;
    exactly 0.6 goes llm_full — corrected 2026-08-07, FOLLOW-887 sweep)

3. For each adaptable element (headline, photo order, features, chat reply):
   a. Apply tier-allowed mutations
   b. Validate against tenant brand guidelines (linter)
   c. Validate against fair-housing rules (no discriminatory framing)
   d. Sign with HMAC + log to ClickHouse for audit

4. Return JSON adaptation directive to SDK (single round-trip, batched)
```

### E.2. Content generation — gdzie LLM, gdzie templates

| Element | Strategia | Uzasadnienie |
|---|---|---|
| **Headline rewrite** | Template + slot filling (95% przypadków), LLM rewrite tylko dla edge cases | Predictable, brand-safe, taniej. Templates: 18 archetypów × 3 warianty per slot per language (E.2.1) |
| **Feature highlight order** | Pure ranking model (gradient boosted on intent×feature interaction) | Deterministyczne, A/B testable, brak halucynacji |
| **Photo re-ranking** | CLIP-style scoring photos vs intent vector + tenant hard rules ("first photo must show exterior") | Computer vision na zdjęciach raz przy ingest property, intent-photo dot product przy serve |
| **Chat suggested replies** | Claude Haiku 4.5 + RAG (tenant's FAQ + listing data + intent context) | Conversational quality wymaga LLM; Haiku 4.5 wystarczająco dobre |
| **Long-form copy (description)** | Claude Sonnet 4.6 + `copy_template.en` fallback — async, permanent Redis+Postgres cache (no TTL, no Tiers) | Sonnet 4.6 jakość warte ceny dla flagship feature; permanent cache (invalidation by listing.updated only). Pełna spec: E.7 |

#### E.2.1. Definicje terminów stosowanych w tej sekcji

- **slot** — pozycja DOM identyfikowana przez `data-estalara-slot="<name>"`. Trzy kanoniczne wartości: `headline`, `cta`, `feature`.
  > **Nota historyczna:** wartość `feature-section` używana wcześniej w `yield-hunter.ts` była błędem naming-conventionowym (SDK query selector nie pasował do dokumentacji deweloperskiej, slot `feature` nigdy nie aktywował się dla tego archetypu). Ustandaryzowano do `feature` w PR #92 / TICKET-046 (PLAYBOOK-001).
- **wariant** — alternatywna kopia dla tego samego slotu, służąca A/B testowaniu przez bandit (E.3). NIE mylić z locale. Min 3 warianty per slot `headline` per archetype. Zaimplementowane w polu `SlotDirective.variants.{en|pl|es}[]` (`packages/sdk/src/core/playbooks/types.ts`).
- **copy_template** — statyczny ~130–150-słowowy opis nieruchomości per archetype; jednocześnie (a) fallback gdy nie ma wygenerowanego AI description w cache oraz (b) seed promptu Sonneta (voice pattern + hard rules, per E.7). Pole `PlaybookEntry.copy_template.{en|pl?|es?}`.
- **ListingContext** — dane listingu (cena, yield%, sypialnie, m², miasto, …) dostarczone przez AGENCY-001 (Level 2) lub enrichment APIs (Level 5), używane przez SDK `interpolatePlaceholders()` oraz wstrzykiwane do promptu LLM gateway jako kontekst.

#### E.2.2. Implementacja 3 wariantów per slot

Każdy `SlotDirective.variants.en[]` zawiera ≥3 alternatywy. `variants.en[0]` jest aliasem `slots[i].en` (default copy). Przykład dla `yield_hunter` (headline):

```typescript
// packages/sdk/src/core/playbooks/archetypes/yield-hunter.ts — copy as of ESC-075 (2026-08-27)
{
  slot: 'headline',
  en: 'Rental Investment — Attractive Yield Profile',
  variants: {
    en: [
      'Rental Investment — Attractive Yield Profile',              // variant_0 (default)
      'Investment Property — Income Asset with Tenant Demand',      // variant_1
      'Passive Income Potential — Cash-Flow Focused Asset',         // variant_2
    ],
  },
}
```

> **Updated 2026-08-27 [FOLLOW-1161].** This sample previously pasted the pre-ESC-075 copy
> (`'Rental Yield: {yield}% | Gross Income: {income}/yr'` and siblings) verbatim, which §E.7 of this
> same document had already declared removed — a reader looking up how variants work landed on the
> ruled-out copy in the document CLAUDE.md calls the single source of truth. The three-variant
> CONTRACT is unchanged; only the illustration moved to copy that still exists.

Selekcja wariantu przez Thompson sampling bandit (E.3) — seed `Beta(1,1)` per `(tenant_id, archetype, variant_index)` w tabeli `ab_bandit_weights` (PR #80). Reward signal (`inquiry.completed`, `time_on_listing`) propaguje się wstecz przez session events i aktualizuje rozkład Beta per wariant.

#### E.2.3. app.estalara.com Slot Mapping (Adaptive Listings v1.0)

Docelowe DOM sloty dla adaptacji na `app.estalara.com` (SvelteKit frontend). **Nie wymagają ręcznych `data-estalara-slot` markerów** — AI Vision (L5, `ai-vision.ts` 364 LOC, ANTHROPIC_API_KEY w Doppler od 2026-05-25) wykrywa strukturę automatycznie podczas onboardingu przez `POST /api/detect`.

| Slot name | Element type | Playbook field | Directive type | Status |
|---|---|---|---|---|
| `headline` | `<h1>`/`<h2>` listing title | `slots.headline.en` | TextDirective | v1.0 |
| `description` | property description text | `copy_template.en` (AI-warmed, E.7) | TextDirective | v1.0 |
| `features` | features list (`<ul>`) | `slots.features.en` | TextDirective | v1.0 |
| `cta-primary` | primary CTA button | `slots.cta.en` | TextDirective | v1.0 |
| `cta-live` | LIVE session join button | `slots.cta_live.en` | TextDirective | v1.0 (DECISIONS D4 metric #5) |
| `listings-grid` | listing cards container | — | ReorderDirective | ⏳ FOLLOW-104 (deferred) |
| `photos` | photo gallery | — | ReorderDirective | ⏳ FOLLOW-104 (deferred) |

**Implementation notes:**
- `app.estalara.com` frontend code: zero zmian wymaganych (poza SDK snippet embed w TICKET-PILOT-001)
- Corpus fixture: `packages/sdk/src/auto-detect/__tests__/corpus/000-app-estalara/` — CI regression dla 5 TextDirective slotów
- SDK config: `decisionApiUrl` musi wskazywać na control-plane route (pełny 18-archetype playbook), NIE Worker route (3 hard-coded buckets)
- TextDirective coverage test: `POST /api/adapt` dla 18 archetypów × 5 slotów = 90 non-empty directives
- Implementation: FOLLOW-103 (Sprint 13, ml-engineer + sdk-engineer, ~4h)

### E.3. A/B testing & learning loop

- **Hold-out group** (default 10%) — losowo wybrana, dostaje *unadapted* listing. Mierzymy lift na: time-on-listing, photo opens, inquiry rate.
- **Multi-armed bandit** (Thompson sampling) dla wyboru wariantu adaptacji per archetype — automatycznie alokuje ruch do najlepiej konwertujących adaptacji.
- **Conversion feedback loop**: gdy `inquiry.completed` event przychodzi, propagujemy reward signal wstecz przez session events i aktualizujemy archetype embeddings (offline, daily batch).
- **Detekcja regresji**: jeśli archetype X ma stat-significant drop w conversion przez 7 dni — auto-pause adaptacji dla tego archetype, alert do Estalara team.

> **For the measured pilot, §E.3.4 overrides the bullets above** (CEO rulings of 2026-09-13): the
> conversion is a server-confirmed `inquiry.completed` or `live.signup`, the unit is the tab session,
> the lift must be tamper-evident, and `reorder` fails closed on missing embeddings.

#### E.3.0. Variant selection mechanics (z playbooków)

Bandit nie generuje wariantów — konsumuje już istniejące w `PlaybookEntry.slots[i].variants.{en|pl|es}` (E.2.2). Per request do Decision API:

1. Decision API ustala `(tenant_id, archetype_id)` i wybiera ścieżkę `source = 'playbook'` (sim > 0.85, confidence > threshold).
2. Per każdy slot z `variants` ≥ 2 — pobiera rozkład Beta z `ab_bandit_weights WHERE tenant_id = ? AND archetype = ? AND variant_index IN (0..N-1)`.
3. Thompson sample: dla każdego variantu losuje `θ_i ~ Beta(α_i, β_i)`, wybiera `argmax θ`.
4. `winningVariant` indeksuje `slots[i].variants.en[winningVariant]`; result wraca jako `TextDirective` z polem `variant_index: number` dla downstream attribution.
5. Po zarejestrowaniu `inquiry.completed` (lub innego conversion eventu z `adaptation_decisions` ClickHouse) — async batch job aktualizuje `α` (success) lub `β` (no-conversion) per wybrany wariant.

**HOLDOUT BYPASS RULE (FOLLOW-360 / RETRO-095 / ESC-026):** Bandit sampling MUST be skipped entirely for sessions where `holdout_group = true`. Both the GET and POST handlers in `POST /api/adapt` enforce this: when `holdout_group=true`, `variant='control'` is used unconditionally without calling `getBanditArms` or `thompsonSample`. This preserves the counterfactual baseline — holdout rows in `adaptation_decisions` must always carry `(holdout_group=1, variant='control')`. Any sampling of v1/v2 for a holdout session contaminates the baseline and invalidates causal lift estimates. This rule applies to ALL code paths that write to `adaptation_decisions`.

Implementacja w dwóch fazach:
- **Faza 1 (Sprint 8, TICKET-AB-001):** bandit infrastructure + holdout assignment + `variant_index` column w `adaptation_decisions`. Zawsze wybiera `variant_index = 0` (default), bo playbook variants nie były jeszcze wyeksponowane do decision API.
- **Faza 2 (post-Sprint 10, TICKET-BANDIT-VARIANTS):** podłączenie Thompson sampling do realnych wariantów z playbooków (PR #92). Wymaga: (a) seedowania `ab_bandit_weights` rowsami per variant per archetype przy first-use, (b) eksposure `variants` w response shape Decision API, (c) feedback loop dopisany do `adaptation_decisions`.

Cross-reference: E.2.2 (gdzie warianty są zdefiniowane), E.3.1 (CATE per wariant, nie tylko per archetype), E.3.2 (variant score wchodzi do multi-objective optimization).

#### E.3.1. Causal inference framework (extends standard A/B)

Pure CTR uplift jest niewystarczający dla decyzji o pause/scale. Holdout group też może mieć wysoki CTR (bo to po prostu dobrzy buyerzy), więc obserwowana różnica nie izoluje *przyczynowości*. Implementujemy **Conditional Average Treatment Effect (CATE)** estimation:

- **T-Learner / X-Learner** (Künzel et al. 2019): trenują dwa osobne modele (treatment / control) i estymują individual treatment effect dla każdej sesji counterfactually. Dla każdego buyera odpowiadają na: "co by się stało gdyby ten konkretny user dostał holdout vs treatment?"
- **Causal forests** (Wager & Athey 2018): identyfikują heterogeneous treatment effects per archetype — które segmenty MAJĄ uplift, a które są obojętne lub regresyjne
- **Sequential hypothesis testing** (Wald SPRT): Bayesian decision boundaries zamiast fixed-N A/B testing — pozwala kończyć testy wcześniej gdy CI są wąskie, oszczędzając LLM cost

**Użycie w produkcji:** jeśli archetype X ma `CATE_CTR > +12%` ALE archetype Y ma `CATE_CTR ≈ 0%` przez 1000+ sesji → auto-pause adaptacji dla Y (degrade do control), save ~20–30% LLM cost. Zamiast szerokiej adaptacji we wszystkich segmentach, alokujemy compute tam gdzie jest causal lift.

**Tech stack:** EconML (Microsoft) + DoWhy + causal forests (Athey et al.). Bayesian uplift models (PyMC) dla long-tail archetypów z małą liczbą obserwacji.

#### E.3.2. Multi-objective optimization

A/B nie jest tylko o CTR. Optymalizujemy weighted objective:

```
score = 0.4 * conv_rate_uplift
      + 0.2 * inquiry_quality_uplift   // gated chat starts, photo deep-dives
      + 0.2 * (1 - LLM_cost_per_session_normalized)
      + 0.1 * brand_safety_score        // fair-housing linter pass rate
      + 0.1 * latency_within_budget     // p95 < 100ms gate
```

Wagi konfigurowalne per tenant (np. Idealista enterprise stawia większą wagę na latency, mała agencja na brand safety). Konfiguracja w `tenant.objective_weights` JSON, default per Tier.

#### E.3.3. Cross-reference D.5 + R.2

Mechanizmy CATE estimation feed do D.5 confirmation rate (post-adaptation behavior validation) i są fundamentem Innowacji R.2 (Causal A/B Framework — patent angle). Implementacja w Sprint 8.

#### E.3.4. Measured-pilot design — CEO rulings of 2026-09-13 (audit §8 decisions #2–#5)

> **Added 2026-09-13 in v4.12 (FOLLOW-1148).** These are ratified decisions, and **none is fully
> built at HEAD.** Each item gives the ruling, the requirements of the ticket that implements it,
> the behaviour at HEAD with a citation, and the owning stub (all four filed 2026-09-13 in
> `backlog/FOLLOW_UPS.md`). For the pilot, this subsection wins where it disagrees with the §E.3
> bullets above. Status belongs to §Snapshot.0.

1. **Decision #2: the lift must be tamper-evident before the next FOLLOW-819 harness run.**
   Nobody holding the page-visible key may be able to manufacture a lift. **Required (FOLLOW-1201
   AC):**
   - ingest rejects a server-to-server caller without a valid signature, and the signature covers a
     timestamp and a nonce, with bounded skew and replay rejection;
   - holdout assignment is keyed on a server-side per-tenant secret, never on a value present in
     the page;
   - `holdout_pct` is read from tenant configuration, not from the request body;
   - lift readers bucket on server time (`ingest_received_at`).

   **At HEAD:** ingest checks an HMAC only `if (signatureHeader)` (`apps/ingest/src/auth.ts:89`).
   The holdout HMAC is keyed on `tenant_id` (`packages/shared/src/ab-holdout.ts:115-124`).
   `holdout_pct` is an optional body field (`apps/control-plane/src/app/api/adapt/route.ts:233`), read
   as `body.holdout_pct ?? DEFAULT_HOLDOUT_PCT` at `:1790`, `:1852` and `:2172`. **Owner:** FOLLOW-1201 (P0; blocks FOLLOW-1185). ESC-079 reviews the public
   ingest-contract change before merge.
2. **Decision #3: `reorder` fails closed on missing embeddings, and text directives stay fail-open.**
   A pseudo-random order must not read as a fitted ranking. **Required (FOLLOW-1202 AC):**
   - a batch in which any listing scored through the hash fallback emits no `reorder` directive;
   - a batch is never mixed: it is all cosine, or it gets no reorder;
   - the withholding is recorded with a countable reason code.

   **At HEAD:** a failed embedding lookup falls back to djb2, and the directive is still appended
   (`route.ts:2014`, `:2031-2036`, `:2055-2057`). `scoring_path` then reads `djb2_fallback`
   (`route.ts:949`). **Owner:** FOLLOW-1202 (P1). Once it lands, FOLLOW-1196's AC(7) predicate must
   not rely on `reorder` being present.
3. **Decision #4: the pilot's conversion is a server-confirmed `inquiry.completed` or `live.signup`,
   and `cta.clicked` is a funnel stage only.** This supersedes the conversion wording of CEO
   Decision D-4 (2026-05-30, `backlog/PLAN-V3-2026-05-30.md` §0, echoed at
   `packages/sdk/src/core/adapt.ts:691`), which named `live.signup` (OR `chat.contact_initiated`) as
   primary, for the lift. It also supersedes the §E.3 bullet above that names `inquiry.completed`
   alone. **Required (FOLLOW-1203 AC):**
   - a browser-emitted instance of either event is excluded from the lift;
   - attribution requires the conversion to follow the session's first decision;
   - ingest rejects conversion events for sessions `/api/adapt` never saw.

   **At HEAD:** the lift join reads `events WHERE type = 'cta.clicked'`
   (`apps/control-plane/src/app/api/admin/analytics/rollup/data.ts:209`). The bandit's reward events
   (`adapt.ts:694`) are a separate axis, and this ruling does not touch them. **Owner:** FOLLOW-1203
   (P1, depends on FOLLOW-1201). Per `backlog/QUEUE.md` (session-160b NEXT, item 5), a harness lift
   is evidence for FOLLOW-820 only after FOLLOW-1203 lands.
4. **Decision #5: the unit of assignment for the pilot is the tab session (Option B), and
   `__estalara_xid__` keeps being minted.** Arm assignment, and every per-arm or per-archetype
   denominator, is per session, not per person. Two tabs from one visitor are two independent draws,
   so dilution is measured rather than assumed away. **At HEAD:**
   - the SDK mints the session id once per tab and holds it in `sessionStorage`
     (`packages/sdk/src/core/session.ts:6`, `:89`);
   - holdout is HMAC(`tenant_id`, `session_id`) (`ab-holdout.ts:85`);
   - the 90-day cross-session id comes from `getOrCreateCrossSessionId()` (`session.ts:252`) and is
     transmitted nowhere (FOLLOW-146).

   **Owner:** FOLLOW-1204 (P2) records the xid's purpose and retention in the ROPA/DPIA and measures
   the dilution once. See §D.6.

---

### E.4. Investor Quiz Widget — cascading decision tree (v2.0, ratified 2026-06-05)

#### E.4.1. Filozofia — cel quizu

Quiz służy jako najsilniejszy sygnał cold-start: identyfikuje archetype inwestora zanim system
zdąży zebrać wystarczające sygnały behawioralne. Pytania są **generyczne** — niezależne od
konkretnego listingu wyświetlanego w danym momencie. Investor może trafić na listing, który go
nie interesuje; quiz musi działać poprawnie niezależnie od kontekstu.

Quiz pojawia się na **liście listingów ORAZ stronie szczegółowej** — wszędzie tam, gdzie SDK
jest załadowane. Trigger: **30 sekund** spędzonych na stronie (nie 3 odsłony listingu jak
w poprzednim projekcie). Cooldown: 24h w localStorage po odrzuceniu. Kontrolowany flagą
`QuizConfig.enabled` (default: `false`) per tenant w tabeli `tenants.quiz_config`.

#### E.4.2. Drzewo decyzyjne — 3 gałęzie, 2–3 pytania, 17 liści

Poprzedni flat 2-pytaniowy quiz produkował 4 komórki dla 18 archetypów, z nakładającymi się
prawdopodobieństwami w popularnych komórkach. Nowy quiz używa **drzewa decyzyjnego z bramą Q1**,
która rozdziela inwestorów na wzajemnie wykluczające się gałęzie. Każda ścieżka kończy się
bezpośrednio jednym archetypem (liściem) — bez nakładania się.

```
Q1 — BRAMA (zawsze)
"Czego szukasz?"
  A. Nieruchomości, która będzie na siebie zarabiać  → gałąź INWESTOR
  B. Miejsca do mieszkania dla mnie lub rodziny      → gałąź WŁASNY UŻYTEK
  C. Nowego miejsca w innym kraju / nowy etap życia  → gałąź CROSS-BORDER
  D. Jeszcze nie wiem — pokaż mi oferty              → neutral (quiz kończy się)
```

**Gałąź INWESTOR:**
```
Q2: "Jak ta nieruchomość ma zarabiać?"
  A. Stały dochód z najmu długoterminowego  → Q3
  B. Najem krótkoterminowy / wakacyjny      → vacation_rental_investor [KONIEC]
  C. Kupno, remont i sprzedaż z zyskiem     → flip_investor [KONIEC]
  D. Nieruchomość komercyjna                → commercial_investor [KONIEC]

Q3 (tylko po A):
"Co jest Twoim celem długoterminowym?"
  A. Maksymalny zwrot z tej jednej inwestycji      → yield_hunter [KONIEC]
  B. Zbudowanie portfela wielu nieruchomości        → portfolio_builder [KONIEC]
  C. Dochód i jednocześnie prawo pobytu w tym kraju → golden_visa_buyer [KONIEC]
```

**Gałąź WŁASNY UŻYTEK:**
```
Q2: "Co najlepiej opisuje ten zakup?"
  A. To mój pierwszy własny dom/mieszkanie          → baza: first_time_buyer
  B. Rodzina z dziećmi — przestrzeń i szkoły        → baza: family_buyer
  C. Przeprowadzam się do czegoś większego           → baza: upsizer
  D. Przeprowadzam się do mniejszego                 → baza: downsizer

Q3 (zawsze):
"Co najbardziej zaważy na Twojej decyzji?"
  A. Lokalizacja i okolica       → potwierdza bazę Q2 [KONIEC]
  B. Najwyższy standard/prestiż  → override → luxury_buyer [KONIEC]
  C. Warunki do pracy zdalnej    → override → remote_worker [KONIEC]
  D. Cena i koszty utrzymania    → potwierdza bazę Q2 [KONIEC]
```
Reguła override: odpowiedź B lub C w Q3 zastępuje bazę z Q2.

**Gałąź CROSS-BORDER:**
```
Q2: "Jak będziesz korzystać z tego miejsca?"
  A. To będzie mój główny dom — przeprowadzam się na stałe → Q3
  B. Dom na część roku (wakacje, weekendy)                  → second_home_buyer [KONIEC]
  C. Dla mojego dziecka, które studiuje                     → student_parent [KONIEC]

Q3 (tylko po A):
"Co najlepiej Cię opisuje?"
  A. Emerytura — spokój i klimat              → retiree_relocator [KONIEC]
  B. Wracam do swojego kraju                  → diaspora_buyer [KONIEC]
  C. Nowy rozdział za granicą — praca i życie → lifestyle_expat [KONIEC]
```

#### E.4.3. Pokrycie archetypów po redesignie

Wszystkie 17 archetypów non-neutral jest teraz bezpośrednio osiągalnych przez quiz (włącznie z
poprzednimi "🔴 None": `student_parent`, `retiree_relocator`, `diaspora_buyer`).

| Archetype | Ścieżka | Pytania |
|---|---|---|
| yield_hunter | INWESTOR→A→A | 3 |
| portfolio_builder | INWESTOR→A→B | 3 |
| golden_visa_buyer | INWESTOR→A→C | 3 |
| vacation_rental_investor | INWESTOR→B | 2 |
| flip_investor | INWESTOR→C | 2 |
| commercial_investor | INWESTOR→D | 2 |
| first_time_buyer | WŁASNY→A→A/D | 3 |
| family_buyer | WŁASNY→B→A/D | 3 |
| upsizer | WŁASNY→C→A/D | 3 |
| downsizer | WŁASNY→D→A/D | 3 |
| luxury_buyer | WŁASNY→any→B | 3 |
| remote_worker | WŁASNY→any→C | 3 |
| second_home_buyer | CROSS-BORDER→B | 2 |
| student_parent | CROSS-BORDER→C | 2 |
| retiree_relocator | CROSS-BORDER→A→A | 3 |
| diaspora_buyer | CROSS-BORDER→A→B | 3 |
| lifestyle_expat | CROSS-BORDER→A→C | 3 |
| neutral | Q1→D (skip) | 1 |

#### E.4.4. Zmiany w silniku intencji — direct assignment

Poprzednia `applyQuizPrior(state, purpose, horizon)` mnożyła wagi przez prior Bayesowski.
Z drzewem decyzyjnym, które produkuje jednoznaczny liść, właściwe podejście to **bezpośrednie
przypisanie** archetypu z wysoką pewnością:

```typescript
// Nowa funkcja w packages/sdk/src/core/intent.ts
export function applyQuizLeaf(state: IntentState, archetype: Archetype): IntentState {
  const probabilities = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k,
      k === archetype ? 0.85 : 0.15 / (ARCHETYPE_NAMES.length - 1)
    ])
  ) as ArchetypeProbabilities;
  return {
    archetype,
    confidence: Math.min(0.85 * QUIZ_CONFIDENCE_BONUS, 1.0), // ~0.95
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: true,
  };
}
```

`applyQuizPrior()` pozostaje jako legacy fallback. `applyQuizLeaf()` jest wywoływana gdy
ścieżka drzewa kończy się na liściu.

#### E.4.5. Post-quiz drift detection i session override

Quiz wyznacza archetype z confidence ~0.95. Ale sygnały behawioralne i chat mogą go korygować
w obrębie sesji. Mechanizm w `packages/sdk/src/index.ts`:

```
Quiz leaf → currentIntentState.archetype = QUIZ_ARCHETYPE
description_cache_persistent[listing × QUIZ_ARCHETYPE] ← permanentny rekord (nigdy nie zmieniony)

Sygnały po quizie:
  WZMACNIAJĄ: zgadzają się z QUIZ_ARCHETYPE → confidence rośnie, adaptacja zostaje
  KORYGUJĄ: detectMismatch() wykrywa rozbieżność
    → DRIFT_HOLD_COUNT = 3 kolejne cykle refreshDirectives() muszą potwierdzić
    → po 3 potwierdzeniach: currentIntentState.archetype ← DRIFT_ARCHETYPE (session override)
    → refreshDirectives() pobiera nowe dyrektywy dla nowego archetypu
    → description_cache_persistent[listing × QUIZ_ARCHETYPE] NIE jest modyfikowany
```

Anti-thrash guard: `DRIFT_HOLD_COUNT = 3` zapobiega migotaniu archetypu przy jednym
sprzecznym sygnale. Nowe stałe w `index.ts`: `driftCandidateArchetype: Archetype | null`,
`driftCandidateCount: number`. Istniejąca `detectMismatch()` w `intent.ts:491` musi
być AKTYWNA (przełączać archetype), a nie tylko logować event.

Chat override: kiedy `apps/intent-engine` (FOLLOW-087) emituje `chat.intent.detected`,
trafia do `applyBehavioralSignal()` z wyższymi wagami → naturalnie buduje się w kierunku
progu mismatchu szybciej niż sygnały scroll/click.

#### E.4.6. Gdy quiz jest wyłączony (admin toggle OFF)

```
currentIntentState.archetype = 'neutral'
  ↓
Sygnały behawioralne + chat akumulują się
  ↓
refreshDirectives() co 5 sygnałów → POST /api/adapt:
  serwer: if confidence <= CONFIDENCE_THRESHOLD (0.6): source: 'default', directives: []
          (route.ts:86,275 — wymagane strictly > 0.6; dokładnie 0.6 zwraca [])
  SDK:    DOM mutuje tylko gdy aboveFloor =
          confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5)
          || signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT (2)
          (dysjunkcja, index.ts:879-881 — gałąź signal_count działa też przy quiz OFF)
```
(Skorygowane 2026-08-07, FOLLOW-882: poprzedni pseudokod miał `<`/`≥` — permissive na granicy,
której kod nie ma — i nie pokazywał gałęzi `signal_count`.) `CONFIDENCE_THRESHOLD` jest twardą
stałą modułu (`route.ts:86` — `const CONFIDENCE_THRESHOLD = 0.6;`), **NIE** per-tenant tunable —
żaden mechanizm per-tenant nie istnieje w HEAD; wcześniejsze zdanie "tunable per-tenant (pilot:
może być 0.4)" wywodziło się z AUDIT-2026-06-04 (`:1132` zakładał wpis w `.env.example`, nigdy
nie zaimplementowany) i jest WYCOFANE jako opis stanu. Sama intencja per-tenant progu nie jest
usuwana po cichu: jeśli pilot ma dostać niższy próg (np. 0.4), to decyzja produktowa — stub
zgłoszony do PM (kandydat FOLLOW-889), bez asercji intencji tutaj (ESC-054 pozostaje OPEN). Bez
chatu (FOLLOW-087): identyfikacja zajmuje 5–10 minut aktywnego przeglądania. Z chatem: 1–2
wiadomości.

#### E.4.7. Wielojęzyczność quizu

Widget wspiera `en` (domyślny), `pl`, `es`. Priorytet rozpoznawania języka:
1. `quizConfig.language` — ustawienie admin per-tenant (z DB via `/api/quiz/config`)
2. `data-language` attr na `<script>` tagu (embed-time)
3. `navigator.language` — język przeglądarki inwestora (np. `pl-PL` → `pl`)
4. `'en'` — hardcoded fallback

Zmiana w `config.ts:89–91`: jeśli `data-language` absent/unrecognized → try
`navigator.language.slice(0,2)` → map to supported language → fallback `'en'`.
Bug do naprawienia: `QuizConfig.language` schema w `quiz/config/route.ts:25` ma tylko
`'en' | 'pl'` — musi być rozszerzony do `'en' | 'pl' | 'es'`.

#### E.4.8. MOAT: quiz_completions table

Każde ukończenie quizu to dane treningowe. Nowa tabela Postgres:

```sql
CREATE TABLE quiz_completions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         text NOT NULL,
  tenant_id          text NOT NULL,
  listing_id         text,               -- nullable: quiz może być na listing list
  branch             text NOT NULL,      -- 'investor'|'own_use'|'cross_border'|'skip'
  q1_answer          text NOT NULL,
  q2_answer          text,
  q3_answer          text,
  resolved_archetype text NOT NULL,
  override_applied   boolean DEFAULT false,
  completed_at       timestamptz NOT NULL DEFAULT now()
);
-- RLS: tenant_id isolation
```

Łączy: (session → quiz path → resolved archetype → adaptation → conversion) — pełny łańcuch MOAT.

#### E.4.9. Admin ON/OFF toggle

`QuizConfig.enabled: boolean` (default `false`) istnieje w `apps/control-plane/src/app/api/quiz/config/route.ts`.
Admin UI: `admin.estalara.com/dashboard/quiz`. Wpływ wyłączenia: identyfikacja archetypu opóźnia
się do czasu zgromadzenia sygnałów behawioralnych/chat. Do tego czasu DOM jest neutral/default.

---

### E.5. (Reserved)

Numerację zarezerwowano dla przyszłej podsekcji. Nie usuwać — krzyżowe referencje z innych dokumentów (TICKET-ARCH-002 spec, plan v1.6) zakładają stabilność numeracji E.6 / E.7.

---

### E.6. Placeholder Resolution Order (Locked Architecture)

Gdy SDK musi wypełnić placeholder np. `{price}` lub `{school_rating}` w adaptowanym tekście, sprawdza źródła danych w ustalonej hierarchii. Każdy level degraduje do następnego.

| Level | Źródło                                     | Przykład                       | Pewność |
| ----- | ------------------------------------------ | ------------------------------ | ------- |
| **1** | `data-estalara-*` atrybuty (manual)        | `data-estalara-price="488168"` | 1.0     |
| **2** | Agency-provided answers per listing        | Agent odpowiada: "yield: 6.2%" | 0.95    |
| **3** | Auto-extracted z DOM via `data_extractors` | CSS selector → "€488,168"      | 0.85    |
| **4** | Computed metrics                           | price/area_sqm → price_per_sqm | 0.80    |
| **5** | Cached enrichments z external APIs         | school_rating, walkability     | 0.75    |
| **6** | LLM generation (Haiku 4.5 / Sonnet 4.6)    | Generates missing copy         | 0.60    |
| **7** | Skip directive                             | Placeholder usunięty z tekstu  | —       |

**Zasada:** każdy level jest próbowany tylko jeśli poprzedni zwrócił `null`. Level 6 (LLM) kosztuje ~$0.001 per placeholder — cache agresywnie per listing per archetype.

**Cross-reference:** Level 6 dla long-form description NIE idzie przez raw LiteLLM call — przechodzi przez pipeline opisany w E.7 (permanent cache lookup + Modal async job). Inne placeholdery (np. krótki copy w slotach `headline`/`cta`/`feature`) używają LiteLLM bezpośrednio przez gateway `apps/control-plane/src/lib/llm-gateway.ts` (Haiku 4.5 / Sonnet 4.6 routing).

---

### E.7. Long-form Description Pipeline (v2.0 — original-first + permanent cache, no Tiers)

> **Decyzja CEO (2026-06-05):** Adaptive Listings nie ma Tiers — wszyscy tenanci dostają jedno doświadczenie. Model TTL-per-Tier jest wyeliminowany. Opisy są przechowywane trwale (bez TTL w Redis, z `description_cache_persistent` w Postgres) i invalidowane wyłącznie przez event `listing.updated`. Parametr `tier` usunięty z API.

> **FOLLOW-357 (2026-06-25 — CEO ruling):** `POST /api/adapt` exposes a `page_context` field (values: 1 or 2) derived from the `page_type` parameter. This is a **page-type analytics signal** — NOT an integration Tier. `page_context: 2` means the request is for a listing-detail page (full per-listing directive set: headline + cta + feature); `page_context: 1` means a list/search/home page (lighter directive set: cta + feature + reorder, no headline). The no-Tiers decision stands: all tenants receive the same experience. The `page_context` field is stored in `adaptation_decisions.page_context` (ClickHouse column renamed from `tier` in migration 0018). The SDK `AdaptResponse.tier: 1|2|3` declaration has been removed — `page_context` is analytics-only, no SDK consumer. `AdaptationDirectives` interface and SDK `adaptResponseSchema` both use `page_context` as of FOLLOW-356/357.

> **FOLLOW-1140 / ESC-074 (b) (2026-08-26 — CEO ruling (b) + (c)):** playbook slot copy carries
> `{token}` placeholders (e.g. `'Rental Yield: {yield}% | Gross Income: {income}/yr'`). Since
> FOLLOW-1018 an unresolved token **discards the whole directive** rather than painting raw braces
> at a buyer, and nothing enforced that a token had any source — 15 of the 17 shipped tokens had no
> emitter anywhere in the estate, so 16 of 18 archetypes silently LOST their headline on a real
> tenant page. `POST /api/adapt` therefore now resolves what it can **server-side**, on the two
> branches that serve playbook copy verbatim (`source: 'playbook'` and the
> `playbook_fallback_llm_unavailable` fallback), from the listing's own facts fetched via
> `lib/listing-details.ts`. The `llm_*` branches are unchanged: the generation prompt already
> instructs substitution and FOLLOW-457's fact check governs the result.
>
> **Contract consequences.**
>
> - The server-resolvable token set is `SERVER_RESOLVED_PLACEHOLDER_TOKENS` in `@estalara/shared`
>   — `{bedrooms}`, `{sqm}`, `{neighborhood}`, `{location_highlight}`, `{key_feature}` — each
>   mapped 1:1 onto a field of the listing backend's `ListingResponseTO`. The control-plane
>   resolver table is keyed by that union, so a token added there without a resolver is a type
>   error, and `packages/sdk/src/__tests__/placeholder-token-producers.test.ts` re-derives the
>   residual from the same list on every CI run.
> - **The facts-unavailable rule is NOT partial render.** ESC-074 reaffirms FOLLOW-1018: an
>   unresolvable token still discards its directive, whether the fault is a missing `listing_id`,
>   an unreadable listing, a blank fact, or a token outside the resolvable set. Nothing is
>   defaulted, estimated or fabricated.
> - `AdaptationDirectives.fallback_reason` gains **`unresolved_placeholder_tokens`**, and this is
>   the one value that also appears on a `source: 'playbook'` response — branch 2 is where the
>   field was previously always absent, so the signal reaches the wire there without displacing
>   the LLM diagnosis the FOLLOW-1022 canary reads on the fallback branches. The SDK schema types
>   the field as `z.string().optional()` under `.passthrough()`, so deployed bundles are unaffected.
> - Every drop is reported to Sentry as the named signal `adapt unresolved placeholder token`
>   (registered in `docs/runbooks/observability.md`) — the SERVER end of the SDK's
>   `adapt.skipped { reason: 'unresolved_token_<name>' }`, not a parallel channel.
> - Client-side `interpolatePlaceholders()` is unchanged and remains the second line of defence; a
>   token the server filled simply arrives with nothing left to substitute. Publishing the
>   `data-estalara-<token>` attribute contract as an onboarding requirement is part **(c)** and is
>   a separate delivery.
> - **Residual, recorded not hidden:** twelve of the seventeen shipped tokens were outside any data
>   the route holds (ESC-075) — rent/renovation/mortgage inputs, third-party datasets, one legal
>   constant, and one editorial classification. That residual is now ZERO, by the ruling below: the
>   copy changed rather than the fact source.

> **ESC-075 (2026-08-27 — CEO ruling, option 1: narrow the copy):** ESC-074's remedy (b) reached
> **five** of the seventeen shipped tokens, so it restored a headline for four archetypes, not
> eighteen. The other twelve are not a plumbing gap — `{yield}` `{income}` `{nightly_rate}` need a
> RENT figure `ListingResponseTO` does not carry (it has `price`, `priceEur`, `pricePerSquareMeter`
> and `monthlyFee`, an owner charge); `{arv}` a renovation valuation nobody in the estate produces;
> `{monthly_payment}` rate/term/LTV assumptions, which is also a regulated financial statement;
> `{school_rating}` `{university}` `{minutes}` `{climate}` `{internet_speed}` third-party datasets;
> `{threshold}` a jurisdiction's golden-visa minimum, a legal constant that changes by decree; and
> `{key_luxury_feature}` an editorial ruling on which amenities read as luxury. **The ruling is that
> the copy stops demanding them.** All twelve were written out of `slots[].en` and every bandit
> variant across the twelve affected archetypes and replaced by qualitative phrasing each
> archetype's own `copy_template` HARD RULES already permit — so the slot templates now agree with
> the anti-hallucination contract they used to contradict. Nothing was given an invented source;
> option (3), widening the fact source, stays available and is unaffected by this.
>
> **Contract consequence:** every token the playbooks ship is now server-resolvable, so on the
> playbook path a directive can no longer be discarded because no source EXISTS. The two counters
> in `packages/sdk/src/__tests__/placeholder-token-producers.test.ts` are pinned at **0** so that
> cannot move back silently.
>
> **What this does NOT license anyone to say (FOLLOW-1155, RETRO-315 LG-1).** The first version of
> this paragraph called `fallback_reason: 'unresolved_placeholder_tokens'` a rare REGRESSION signal.
> That is one step too far. Three routine, non-regression causes still fire it, and none has been
> measured:
>
> 1. **No `listing_id` on the request.** `facts` is `null` whenever `listingId` is falsy, and a null
>    facts map drops EVERY token-bearing directive. The SDK sends `listing_id` only when the page
>    carries `data-estalara-listing-id`, so this is a property of the tenant's markup.
> 2. **A non-OK listing-details response.** `fetchListingJson` returns `null` on `!res.ok`. That is
>    **FOLLOW-1120 — open, P1, and recorded FLAPPING on this substrate**, so the signal is currently
>    indistinguishable from a known intermittent upstream outage.
> 3. **An absent OPTIONAL fact,** for two of the five survivors. `key_feature` reads
>    `highlights?.[0]`, optional on the upstream contract; and `bedrooms` resolves only for `> 0`,
>    so **every studio listing** drops the headline for `downsizer`, `family_buyer`,
>    `portfolio_builder` and `upsizer`. The behaviour is correct — a fabricated "0BR" headline is
>    the outcome the whole ruling exists to prevent — but a signal that fires on every studio is not
>    rare by construction.
>
> Until FOLLOW-1155's catalogue measurement is executed, the honest claim is the narrow one: **no
> shipped token lacks a source.** How often the signal fires is unmeasured. Part **(c)** — publishing the `data-estalara-<token>` attribute contract as
> an onboarding requirement — is unchanged and still a separate delivery; it is no longer what the
> twelve archetypes are waiting on.

> ### E.7.0 — GROUNDING RULE FOR THE DIRECTIVE AXIS (CEO ruling, 2026-08-27, ESC-076)
>
> **Adaptive Listings adapts the seller's copy. It does not author claims about the property, and it
> does not verify them either.** Both halves are the ruling and neither is negotiable:
>
> 1. **Every directive shown to a buyer must derive from that listing's own content.** If the
>    agency's description says "top-rated schools", the headline may say "top-rated schools". If it
>    does not, no template, threshold or archetype may put those words on the page.
> 2. **Verifying the claim is the seller's job, not ours.** AL never fact-checks the agency against
>    the world. The `copy_template` HARD RULES are instructions to a model writing FROM the
>    listing — not a banned-vocabulary list. A word forbidden there is forbidden because it would
>    be INVENTED, never because it is regulated.
>
> **What this makes wrong, stated so nobody has to rediscover it:**
>
> - **Branch 2 (`similarity > HIGH_SIMILARITY_THRESHOLD` → `source: 'playbook'`) gates on the wrong
>   axis.** `similarity` is confidence about the BUYER's archetype. It says nothing about the
>   PROPERTY, so no threshold on it can make a canned claim about this listing true. The branch also
>   deliberately does not fetch listing text (`listing-facts-context.ts`), so the headline that
>   replaces the agent's `<h1>` never read the listing at all. Same for the
>   `playbook_fallback_llm_unavailable` fallback, which serves the same static copy.
> - **The fact check treats the template as ground truth.** `buildDirectiveGroundingText` builds its
>   allow-list from `slots[].en`, every bandit variant and `copy_template.en` **in addition to** the
>   listing context, so a template claim authorises itself: "Triple Net Lease" passes because the
>   template contains it, not because the listing does. Added deliberately by FOLLOW-1034 under the
>   older model in which shipped copy was legitimate ground; under this ruling it is inverted and
>   the corpus narrows to the listing.
>
> **The three consequences, which are one design and not a menu:**
>
> - **Ground it.** A directive is generated FROM the listing's own text, or it is not generated.
>   Playbooks stop being shipped copy and become what `copy_template` already is: the archetype's
>   voice and framing brief for the model. `slots[]` becomes the brief, not the string on the wire.
> - **When we cannot ground, we do not adapt.** No listing fetched (FOLLOW-1120), no model
>   available: the agent's own copy stands, untouched. This extends the description axis's standing
>   rule — _AI-adapted copy never displaces the agent's original_ — to the directive axis, which
>   never had it. A canned substitute is precisely what the ruling excludes, so there is no third
>   behaviour to fall back to.
> - **The grounding corpus is the listing.** Template text is removed from the fact-checker's
>   allow-list. RETRO-315's FOLLOW-1156 reads this as a regression (the corpus SHRANK when ESC-075
>   removed copy); under this ruling the shrink is correct and that ticket is inverted, not
>   actioned as filed.
>
> **Accepted costs, stated up front so they are not later read as regressions.** Branch 2 was the
> only sub-second directive path; every directive request now carries a model call. LLM
> unavailability degrades to NO adaptation rather than canned adaptation, so the measured adaptation
> rate FOLLOW-819 / FOLLOW-820 report will FALL — that is the rule working, not a defect. FOLLOW-1120
> becomes load-bearing rather than silently absorbed.
>
> **The one number still missing:** how much traffic actually takes branch 2 and the fallback. The
> only production measurement on record is [MP-010] (2026-08-17), which found the ungrounded path
> serving **100%** of traffic — but that predates FOLLOW-1022 and nobody has re-measured. The
> `source` distribution in `adaptation_decisions` answers it and is folded into FOLLOW-1155's
> localhost session.

**Fundamentalna zasada:** AI-adapted copy NIGDY nie wypiera agentowego oryginału na pierwszej wizycie buyera. Dopiero gdy Sonnet skończy generację (w tle, dla konkretnej kombinacji listing × archetype × locale), kolejny buyer w tej samej kombinacji dostaje wersję zoptymalizowaną. Dodatkowo: Sonnet NIGDY nie zmyśla faktów (liczb, nazw, ratings) których nie ma w `original_description` ani `listing_context`.

> **FOLLOW-354 — Confidence gating ladder (corrected 2026-08-07 by FOLLOW-881; axis SPLIT
> 2026-08-08 by FOLLOW-913 per the ESC-054 ruling; sources FOLLOW-875/877, RETRO-259):**
> `/adapt/description` has **no server-side confidence parameter** (grep `confidence` in
> `apps/control-plane/src/app/api/adapt/description/route.ts` → 0 hits). Its SDK-side gate is NOT
> a bare 0.5 floor and, as of FOLLOW-913, is NOT the same disjunction the directive axis uses: the
> shipped gate is `resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5) || currentIntentState.signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT (5)` (`packages/sdk/src/index.ts:882-884`) — a
> higher bar than the directive axis's `DOM_ADAPT_MIN_SIGNAL_COUNT (2)`. `applyDirectives()` and
> the fire-and-forget `applyDescriptionAdaptation()` now sit inside TWO SEPARATE `if` blocks
> (`index.ts:886`/`index.ts:900`, both gated within `refreshDirectives()`), not one shared block.
>
> Gating ladder summary:
> - SDK directive gate: the `aboveFloor` disjunction — `confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5) || signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT (2)` (`index.ts:879-881`).
> - SDK description gate: the `aboveDescriptionFloor` disjunction — `confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5) || signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT (5)` (`index.ts:882-884`). `packages/sdk/src/core/adapt-floor.ts` holds all three constants; it is a constants-only module with no code path of its own.
> - Server gate (directive axis only): `CONFIDENCE_THRESHOLD = 0.6` (`apps/control-plane/src/app/api/adapt/route.ts:86`). The comparison is `if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [], ... }` (`route.ts:275`) — the bar is **strictly greater than 0.6**; exactly 0.6 returns `[]` (boundary locked by `route.test.ts:267`). It is evaluated over the client-sent `body.confidence ?? 0.5` (`route.ts:1224,1278`), i.e. over the SDK's own intent state. On the directive axis the SDK disjunction can therefore only further suppress — anything the server lets through already exceeded 0.6.
> - Description axis (no server gate) — full client-side guard set, in order: (1) the `aboveDescriptionFloor` disjunction; (2) `archetype !== 'neutral'` (`packages/sdk/src/core/adapt-description.ts:390`); (3) a `[data-estalara-slot="description"]` element AND a `[data-estalara-listing-id]` attribute present in the DOM (`adapt-description.ts:403-411`); (4) response `source === 'ai_cached'` with a non-empty `description` (`adapt-description.ts:356`).
> - No further SDK confidence gate exists. The buyer-facing sidebar widget is admin-only (`index.ts:1135-1137` — `sidebar` stays `null`, `show()` calls are no-ops) and there is no `SIDEBAR_SHOW_THRESHOLD` constant in the SDK.
>
> Practical implication: at confidence 0.5–0.59 the server returns `[]` directives but the SDK
> **will still fetch** `/adapt/description` and apply an AI-adapted description if
> `source === "ai_cached"` — and the same permissiveness holds at ANY confidence once
> `signal_count >= 5` (the init-time `device_type` prior consumes one signal, so FOUR further real
> behavioral events are required — not one, as it was before this ruling). **CEO ruling (ESC-054,
> 2026-08-08, FOLLOW-913): keep the disjunction shape, but the description axis's signal-count arm
> is its own constant at 5, not the directive axis's 2.** Before this ruling, a single
> scroll-depth milestone (`signal_count` reaching 2) was enough to open the description axis at any
> confidence — see FOLLOW-877 / ESC-054 for the original finding. This note now describes shipped,
> ruled behavior, not an open question.

#### E.7.1. Endpoint contract

`tier` parameter removed — single-tier endpoint.

| Method | Path                     | Body / Query                                                                   | Purpose                                                            |
| ------ | ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| POST   | `/api/adapt/description` | `{listing_id, archetype, locale, original_description, listing_context}`       | Cache lookup; hit → `ai_cached`; miss → `original` + enqueue Modal |

#### E.7.2. Response schema

```json
{
  "description": "string | null",
  "source": "ai_cached" | "original",
  "locale": "en" | "pl" | "es",
  "generated_at": "ISO 8601 | null",
  "verified_facts_used": ["bedrooms: 3", "location: Madrid"]
}
```

- `ai_cached` — cache hit (Redis lub `description_cache_persistent`). `description = <Sonnet text>`. `generated_at = <stored timestamp>`. `verified_facts_used = <parsed from Sonnet audit block>`.
- `original` — cache miss. `description = null`. `generated_at = null`. SDK NIE rusza DOM. `verified_facts_used` omitted. Modal job enqueued w tle.

#### E.7.3. Permanent description cache (no TTL)

Permanent description cache (no TTL):

- **Redis key:** `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`
  - Kept for fast serving (sub-millisecond hot path)
  - No EX/TTL set — entries persist until invalidated
- **Postgres table:** `description_cache_persistent`
  - Durable, permanent record — survives Redis eviction
  - Invalidated only on `listing.updated` event (not by time)
  - Lookup order: `description_cache_persistent` → Redis → template_fallback + Modal enqueue
- **Invalidation trigger:** `listing.updated` webhook → SET `invalidated_at = NOW()`
  (both Redis SCAN+DEL and `description_cache_persistent` update)
- **Modal job:** generates description+headline → writes to BOTH Redis AND `description_cache_persistent`
  - No priority tiers — single queue
  - No TTL parameter passed to Redis SET

#### E.7.4. Modal job payload (v2.0)

```json
{
  "tenant_id": "string",
  "listing_id": "string",
  "archetype": "string",
  "locale": "en|pl|es",
  "cache_key": "desc:...",
  "copy_template": "string (voice pattern + hard rules, NOT marketing copy)",
  "original_description": "string (factual seed from agent — REQUIRED in v1.7+)",
  "listing_context": { "bedrooms": 3, "location": { "city": "Madrid" } }
}
```

Sonnet system prompt: WHITELIST RULES (patrz E.7.5). NIE zmyślaj faktów, których nie ma w `original_description` ani `listing_context`.

#### E.7.5. Anti-hallucination guard-rails

**Cel:** AI-generated copy nigdy nie wprowadza faktów nieistniejących w whitelist. Halucynacje w opisach nieruchomości to ryzyko reputacyjne i prawne (UK/EU misrepresentation laws).

**WHITELIST RULES (w Sonnet system prompt):**

1. Sonnet pisze TYLKO o faktach z dwóch źródeł:
   - (a) `original_description` — tekst agenta
   - (b) `listing_context` — structured property data w payloadzie
2. Sonnet NIE WOLNO wymieniać liczb, ratings, distances, percentages, prices, dates, names of schools/hospitals/companies, ani innych specyficznych quantitative lub named facts, chyba że są w (a) lub (b).
3. Generic positive descriptors BEZ liczb są dozwolone:
   - **ALLOWED:** "attractive yield", "strong rental demand", "spacious garden", "well-connected", "established neighbourhood"
   - **FORBIDDEN:** "yield of 6.2%", "above 95% occupancy", "300m from Tube", "Ofsted Outstanding", "Knight Frank managed"
4. Voice pattern może mówić "lead with cashflow" — jeśli brak yield/income w whitelist, Sonnet używa generic positive cashflow language ("attractive rental yield"). NIE wymyśla "6.2%".
5. Sonnet zwraca audit block `<verified_facts_used>[...]</verified_facts_used>` na końcu odpowiedzi — lista faktów które faktycznie użył. Block jest stripowany z description text i zapisywany osobno do ClickHouse.

**Template format (zmiana z v1.6):**

Templates `copy_template[locale]` w 18 archetype playbooks NIE są już marketing copy. Każdy template to structured string z dwiema sekcjami:

```
VOICE PATTERN:
<jak archetype'owe copy ma brzmieć — tone, lead-with priority, frame,
closer, lexicon preferred / lexicon avoid; ~80-120 słów>

HARD RULES:
<czego NIGDY nie wolno pisać dla tego archetypu, w kontekście anti-hallucination;
~30-50 słów>
```

Modal job parsuje obie sekcje przed przekazaniem Sonnetowi (jako `voice_pattern` i `hard_rules` parametry user prompta).

**CI gate:** `template-purity.test.ts` blokuje merge jeśli którykolwiek `copy_template[locale]` zawiera placeholder z listy zakazanych (yield, occupancy_rate, adr, wault, ltv, schools_rating, broadband_speed, distance_*, etc. — pełna lista w teście).

**Audit trail w ClickHouse:** Tabela `description_generations` dostaje kolumnę `verified_facts_used: Array(String)`. Każda generacja loguje listę faktów. Master Admin oraz audytorzy mogą później sprawdzić "co Sonnet faktycznie użył dla listing X archetype Y locale Z".

#### E.7.6. Flow diagrams

**Cache miss (buyer 1):**

```
SDK extracts original from DOM via tenant.data_extractors.description
  → POST /api/adapt/description { original_description: "...", listing_context, ... }
  → Endpoint: description_cache_persistent lookup miss → Redis GET miss
    → Enqueue Modal job (with original_description + copy_template voice pattern)
    → Return { description: null, source: "original" }
  → SDK: leaves DOM untouched (agent's original copy stays visible)
  → [async] Modal job:
      Sonnet(voice_pattern + hard_rules + original + context)
      → parse <verified_facts_used>
      → Redis SET { text, generated_at, verified_facts_used }  (no TTL — permanent)
      → Postgres INSERT description_cache_persistent { text, generated_at, verified_facts_used }
      → ClickHouse INSERT description_generations
```

**Cache hit (buyer N+1):**

```
Same POST as buyer 1
  → Endpoint: description_cache_persistent hit (or Redis hit)
  → Return { description: "<AI>", source: "ai_cached", generated_at: "...",
            verified_facts_used: [...] }
  → SDK: replaces DOM [data-estalara-slot="description"] with AI text
```

**Different archetype (separate cache key):**

```
Cache is per-(listing, archetype, locale), not per-listing.
Buyer 1 of yield_hunter → cache miss → original
Buyer 1 of family_buyer (same listing) → separate cache miss → original
Each Modal job generates copy independently.
```

**Listing updated (cache invalidation):**

```
listing.updated webhook fires
  → Redis SCAN+DEL desc:{tenant_id}:{listing_id}:*
  → Postgres UPDATE description_cache_persistent SET invalidated_at = NOW()
     WHERE tenant_id = ? AND listing_id = ?
  → Next buyer sees cache miss → original → Modal enqueued (fresh generation)
```

#### E.7.7. Pre-warming (post-MVP, follow-up TICKET-PREWARM-001)

Aby zniwelować "buyer 1 zawsze widzi oryginał" przy listingu który jest hit dla wielu archetypów, można na `listing.created` enqueue'ować Modal job dla TOP-5 archetypów najczęstszych dla regionu tenanta.

- **Cost:** $0.05–$0.15 per listing (5 generations × $0.01–$0.03)
- **Decision:** out of Sprint 9 scope, ewentualnie Sprint 11+ jako tuning
- **Trigger:** gdy mamy >100 listingów per tenant per region z dystrybucją archetypów

#### E.7.8. Cost model

- Sonnet 4.6: ~$0.01–$0.03 per generation
- Modal: ~$0.001 per cold start, ~$0.0003 per warm
- Redis: marginal (set/get)
- ClickHouse: marginal (audit insert)

**Per listing × archetype × locale (unique cache key):** ~$0.02 average per first buyer trigger. Cache hit = $0. Heavy listings (50+ archetypes hit) ≈ $1/listing maximum, w praktyce 3-5 archetypes/listing.

#### E.7.9. Cross-references

- **E.6 (Placeholder Resolution Order):** v1.7.1 nie używa E.6 dla long-form copy. Templates nie zawierają placeholderów. Placeholdery pozostają w użyciu dla short slotów (tagline, headline, CTA) per E.2.
- **B.4 (TenantConfig):** `data_extractors.description` jest źródłem CSS selector dla SDK do ekstrakcji `original_description` z DOM.
- **D.5 (Detection Quality):** `/adapt/description` has no server-side confidence parameter; its SDK-side gate is the `aboveDescriptionFloor` **disjunction** — `confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5)` OR `signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT (5)` (`packages/sdk/src/index.ts:882-884`) — NOT a sole 0.5 floor, and NOT the same signal-count bar the directive axis uses (`DOM_ADAPT_MIN_SIGNAL_COUNT = 2`, `index.ts:879-881`). The `/api/adapt` directive endpoint has an additional server-side gate that is **strictly greater than** `CONFIDENCE_THRESHOLD = 0.6` (`route.ts:86`; `route.ts:275` is `confidence <= 0.6 → []`, so exactly 0.6 returns `[]`). See the FOLLOW-354 gating ladder note above (before E.7.1) — the `signal_count` branch DOES hold on the description axis, at its own higher bar, per the ESC-054 ruling (CEO, 2026-08-08, FOLLOW-913).
- **K.3 (Internal Ops):** `description_generations` tabela ClickHouse dostępna w Internal Ops dla auditu halucynacji per tenant.
- **V.4 (Threat Modeling):** halucynacja w copy = misrepresentation risk (V.4.3 reputational threats). Whitelist rules są mitigation control.

---

## F. Data Network Effect / MOAT

### F.1. Centralized vs federated — decyzja

**Decyzja: centralized aggregation z differential privacy, NIE federated learning.**

Uzasadnienie:
- FL ma sens gdy raw data nie może opuścić urządzenia/tenanta (bankowość, healthcare). U nas tenant *sam* zgodził się na to przez Master Service Agreement, więc transfer agregatów jest legalny przy proper DPA.
- FL infrastructure (Flower, TensorFlow Federated) dodaje 6–12 miesięcy do roadmapy i wymaga ML eng z FL expertise. Nasz zespół 5-osobowy nie ma na to capacity.
- Google i Meta używają FL+DP w produkcji ([Meta Engineering](https://engineering.fb.com/2022/06/14/production-engineering/federated-learning-differential-privacy/), [Google Research](https://research.google/blog/federated-learning-with-formal-differential-privacy-guarantees/)) ale dla skali miliardów devices i z ML staffem 100+. Nasz pragmatyczny wybór: **centralized aggregation + DP + k-anonymity**.

### F.2. Architektura archetypes

```
Tenant A events ──┐
Tenant B events ──┼──► Anonymization Pipeline ──► Archetype Update Job
Tenant C events ──┘    (k-anon ≥ 50 per bucket,  (Modal, daily, with DP-SGD,
                        DP noise added,           ε ≤ 2 per epoch,
                        no tenant_id retained)    epoch_budget tracked)
                                                      │
                                                      ▼
                                              ┌────────────────────┐
                                              │ Global Archetype   │
                                              │ Embedding Space    │
                                              │ (~50–500 archetypes│
                                              │  in pgvector,      │
                                              │  per region)       │
                                              └────────────────────┘
                                                      │
                                                      ▼
                                              All tenants benefit:
                                              - Faster cold-start intent detection
                                              - Better archetype matching
                                              - Cross-market patterns (e.g.
                                                "British retirees → Costa del Sol"
                                                shows up in tenant B's data even
                                                if tenant B never had British
                                                buyer before)
```

### F.3. Privacy-preserving techniques — co realnie robimy

| Technika | Zastosowanie u nas | Notes |
|---|---|---|
| **k-anonymity (k≥50)** | Archetype tylko publikowany jeśli ≥50 unique sessions z >3 różnych tenantów spadło w bucket | Standard NIST-recommended threshold; eliminuje re-identification risk |
| **Differential Privacy (ε≤2)** | Gaussian noise na embedding updates per epoch | DP-SGD jak w Google Gboard ([Google Research](https://research.google/blog/federated-learning-with-formal-differential-privacy-guarantees/)) |
| **Behavioral hashing** | Session_id = HMAC(tenant_secret, fingerprint, day_bucket) — rotuje się co 24h dla EU bez consent | Limit cross-session re-identification |
| **No raw PII w global store** | Tylko vector + categorical archetype labels; chat transcripts rzadko transferred globally i tylko po LLM-based redaction PII | Zero PII leakage cross-tenant |
| **Consent-aware aggregation** | Sessions z `consent_state = consented` → wkład pełny; `legitimate-interest` → tylko aggregated metrics; `none` → wyłączone z global learning | Compliance with GDPR Art. 6/9 |

### F.4. MOAT mathematics dla inwestorów

```
Tenant utility(t) = α * own_data(t) + β * network_data(N) + γ * model_quality(t,N)

Gdzie:
- own_data(t) rośnie liniowo z czasem dla danego tenanta
- network_data(N) rośnie z N (liczba tenantów) zgodnie z Metcalfe-like (~ N * log N
  bo overlap między tenantami zmniejsza marginal benefit każdego nowego)
- model_quality też rośnie z N — więcej archetypów, lepsze coverage corner cases

Konsekwencja:
- Tenant 100. dostaje zarówno bogatsze archetypes (większe N) jak i lepsze
  modele (γ effect), więc jego time-to-value jest 5-10x szybsze niż tenanta 1.
- Konkurent zaczynający w roku Y3 musiałby zebrać 3 lata danych żeby dotrzeć do
  naszej network_data — ale my w międzyczasie urośniemy x10.
- Switching cost dla tenantów rośnie z czasem (ich własne archetype embeddings
  + intent vectors są de facto trained on Estalara-specific data structure).
```

---

## G. Behavioral Fingerprinting — szczegółowo i pragmatycznie

### G.1. Stan prawny w 2025–2026 (MUSIMY to rozumieć dokładnie)

**EU/EEA — sytuacja jednoznaczna i niekorzystna dla "no consent" approach:**

- ePrivacy Directive Art. 5(3) wymaga prior consent dla *jakiegokolwiek* dostępu do informacji w terminal equipment, niezależnie czy to cookies czy fingerprinting ([EDPB Guidelines 2/2023, finalne październik 2024](https://www.edpb.europa.eu/news/news/2023/edpb-provides-clarity-tracking-techniques-covered-eprivacy-directive_en)).
- EDPB Guidelines 2/2023 wprost obejmują **fingerprinting, pixel tracking, IP-only tracking, URL tracking**.
- **Legitimate interest pod GDPR Art. 6 NIE substytuuje consent pod ePrivacy Art. 5(3)** — to dwa odrębne reżimy ([Consenteo analysis](https://www.consenteo.com/knowledge-hub/GDPR/gdpr_cookie_consent_2026)).
- ePrivacy Regulation została **wycofana w lutym 2025** — czyli przez najbliższe lata utrzyma się obecny ePrivacy Directive 2002/58/EC, transponowany różnie w państwach członkowskich (divergence będzie rosła).
- CNIL we wrześniu 2025 wystawiła €325M Google + €150M Shein za naruszenia cookie/tracking — **enforcement się intensyfikuje**.

**UK:**
- ICO w grudniu 2024 jasno odpowiedział na zmianę polityki Google (luty 2025 dopuszczająca fingerprinting w reklamie): "fingerprinting is not a fair means of tracking users... compliance with UK data protection law is a high bar to meet" ([ICO statement](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/12/our-response-to-google-s-policy-change-on-fingerprinting/)).
- ICO wymaga consent + transparency dla fingerprinting, identyczne podejście jak EDPB.

**US (CCPA/CPRA):**
- Browser fingerprints klasyfikowane jako "unique personal identifiers" → opt-out right.
- W praktyce: musimy honor GPC (Global Privacy Control) signal i ofiarować "Do Not Sell/Share" mechanizm.

**UAE (PDPL Federal Decree-Law 45/2021):**
- Personal data definition obejmuje "online identifier" → fingerprint = personal data.
- Consent or other lawful basis required (Art. 5).
- Executive Regulations (Cabinet Decision 111/2023) wymagają DPO dla large-scale profiling, DPIA dla high-risk processing.
- DIFC i ADGM mają oddzielne reżimy (Data Protection Law No. 5 of 2020) — bardzo zbliżone do GDPR.

**Polska (UODO):**
- UODO stosuje GDPR + krajową Ustawę o ochronie danych osobowych z 2018 + Prawo telekomunikacyjne dla ePrivacy. Generalnie podąża za EDPB.

### G.2. Pragmatyczna strategia compliance dla Estalara

**Mode A — "Session Mode" (default, no consent banner needed):**
- Fingerprint *tylko per session*, hash rotuje się przy `tab close + 30 min idle`
- **Dla EU/UK/UAE**: opieramy na *strictly necessary* exemption pod ePrivacy 5(3)(b) — service explicitly requested by user (interactive listing experience). ICO Draft Guidance (December 2024) potwierdza że "recording information or selections made on an online service" może spełniać ten exemption.
- Cross-listing journey *w obrębie jednego tenanta* (tej samej witryny) — to jest first-party tracking, generally OK.
- **NIGDY** cross-tenant w Session Mode.

**Mode B — "Consented Mode" (gdy klient zbierze consent przez Estalara Consent Helper lub własny CMP):**
- Pełen behavioral fingerprint, persistence 90 dni, cross-listing/cross-tenant journey w obrębie jednej grupy partnerskiej.
- Wszystkie sygnały zasilają global archetype space.

**Mode C — "Legitimate Interest Mode" (dla narrow use cases jak fraud prevention):**
- Tylko dla konkretnych celów typu detection of duplicate listings spam — nie dla marketingu/personalization (CNIL i EDPB jasno wykluczyły).

W konfiguracji per tenant pozwalamy klientowi wybrać który mode chce uruchomić, z domyślnym Mode A. **Mode A jest naszym differentiatorem vs Mutiny/Drift** — bo daje value od dnia 1 bez consent banner.

> **Update v4.1 (2026-06-21) — app.estalara.com pilot runs in Mode B (mandatory consent at registration):** CEO decision: for the app.estalara.com pilot, consent is mandatory at registration — investors cannot register or use chat without granting it. This enables Mode B (full behavioral fingerprint, persistence, chat-intent signal). The Adaptive-Listings consent layer covers all six processing purposes (a)–(f) detailed in §H.8. Rafał (CTO) implements app-side data retention/deletion windows; AL owns the legal umbrella. Per-user DOM adaptation opt-out (FOLLOW-372 / §H.9) remains separate from and subordinate to the registration consent: opting out suspends DOM adaptation only, not the registration-gated buying-intent/lead-ranking/chat-summary processing.

### G.3. Techniki fingerprinting i ich realna skuteczność

Niezależne badania Kochava (2024) i innych pokazują że **fingerprinting accuracy spada poniżej 50% po 24h** ze względu na Safari ITP, Firefox ETP, Brave farbling, mobile networks ([Seresa research](https://seresa.io/blog/data-loss/browser-fingerprinting-in-2025-why-ip-device-screen-hashing-is-not-the-cookie-alternative-you-think)). To znaczy że nawet ZE consent fingerprint cross-session jest niesamowicie zawodny.

**Nasza techniczna stack dla Mode A:**
- Canvas fingerprint hash (lightweight, no PII)
- AudioContext fingerprint
- Screen + viewport + timezone + language
- WebGL renderer
- Combined entropy: ~18–22 bits → unique ID dla ~99% browser/device combos w obrębie sesji
- **HMAC z `tenant_secret + day_bucket`** — uniemożliwia cross-tenant correlation nawet wewnętrznie
- Sesja resetuje się po idle 30min lub close tab

Dla Mode B dokładamy:
- LocalStorage persistent ID (z explicit consent)
- Optional CNAME-based first-party endpoint (omija Safari ITP 7-day cap)

---

## H. Compliance & Privacy — Multi-Jurisdiction

> **Note (v1.9-B):** This section describes regulatory readiness across jurisdictions our customers and prospects operate in (EU, US, UK, UAE, PL), not current multi-region deployment. EU (`eu-central-1`) is the only active region today; see §A.3 for region status. Compliance templates, DPIA, ROPA, and DPO appointments are pre-built for all jurisdictions so non-EU customer onboarding does not block on legal work.

### H.1. GDPR (EU) — pragmatyczny checklist

| Obowiązek | Jak realizujemy |
|---|---|
| Lawful basis (Art. 6) | Per-tenant: **Legitimate Interest (Art. 6.1.f)** dla intent detection + adaptation, z udokumentowanym Legitimate Interest Assessment (LIA). CNIL w czerwcu 2025 explicitly potwierdziła że commercial interest może być legitimate dla AI development ([CNIL recommendations](https://www.cnil.fr/en/relying-legal-basis-legitimate-interests-develop-ai-system)) |
| ePrivacy consent | Mode A: strictly necessary exemption. Mode B: wymaga consent collected by tenant (Estalara dostarcza Consent Helper jako optional component) |
| DPIA | Estalara robi DPIA dla całego produktu (template + worked example) → tenant adoptuje + customizes per swoje use case. Required dla "systematic monitoring of behavior" wg GDPR Art. 35.3.c |
| ROPA (Art. 30) | Auto-generated from configuration: per-tenant ROPA entry available do downloadu z dashboardu |
| Data Subject Rights | Tenant admin initiates DSR via `POST /api/dsr/initiate` (JWT-scoped). Data subject receives one-time-passcode via Resend, then submits to `POST /api/dsr/access` / `POST /api/dsr/erase` / `GET /api/dsr/portability`. Erase performs synchronous Postgres delete + async ClickHouse `ALTER TABLE ... DELETE WHERE session_id IN (...)` mutation across `events`, `adaptation_decisions`, `llm_calls`, `session_quality` (FOLLOW-039). Mutation status tracked in Postgres `dsr_clickhouse_mutations` + polled by Vercel Cron `/api/dsr/mutation-poll` every 5 min; the DSR audit log row is finalised only when every per-table mutation acknowledges `is_done = 1`. 30-day SLA met comfortably under typical ClickHouse Cloud mutation completion (minutes). |
| Transfers | EU data stays w EU; US-based tenants → SCC + supplementary measures (Schrems II); transfer impact assessment template |
| DPO | Estalara appointuje DPO w EU (preferowany Polska — najtańszy, native do założycieli) |
| Breach notification | 72h SLA — Sentry + custom incident playbook, pre-templated notification do supervisory authorities |

#### H.1.1. Realistic erasure semantics (Art. 17, FOLLOW-039)

ClickHouse does NOT support transactional row-level DELETE. The realistic erasure flow is:

1. **Synchronous Postgres delete** — `POST /api/dsr/erase` deletes
   `session_embeddings` + `consent_records` rows for the verified `session_id`
   inside a transaction.
2. **Asynchronous ClickHouse mutations** — for each PII-bearing,
   session-scoped ClickHouse table the endpoint issues an
   `ALTER TABLE ... DELETE WHERE session_id IN (...)` statement. The canonical
   inventory (`apps/control-plane/src/lib/clickhouse-dsr.ts`
   `DSR_CLICKHOUSE_TABLES`) covers:

   | Table                  | Why erased                                  |
   | ---------------------- | ------------------------------------------- |
   | `events`               | full behavioral event payloads + chat       |
   | `adaptation_decisions` | archetype + confidence per session          |
   | `llm_calls`            | LLM cost rows linked to the session         |
   | `session_quality`      | per-session DQS / convergence metrics       |

   Intentionally not erased:

   | Table                          | Why retained                                                     |
   | ------------------------------ | ---------------------------------------------------------------- |
   | `dsr_audit_log`                | GDPR Art. 17(3)(b) — legal claims retention (documented in P.P.) |
   | `description_generations`      | listing-scoped, no `session_id` column                           |

   Materialized views (`events_5min_rollup`, `session_summary`) reference data
   already removed by the underlying table mutations and re-converge on the
   next ClickHouse merge cycle.

3. **Mutation tracking** — every issued ALTER TABLE writes one row to the
   Postgres `dsr_clickhouse_mutations` operational table (one row per
   (DSR verification, ClickHouse table) tuple) with status `pending` and
   the resolved `mutation_id` (read back from `system.mutations`).
4. **Polling** — the Vercel Cron `GET /api/dsr/mutation-poll` runs every 5
   minutes, queries `system.mutations` for each non-terminal row, and
   advances state: `pending → in_progress → done` (when `is_done = 1` and
   `latest_failed_reason` empty), or `pending → failed` (when
   `latest_failed_reason` non-empty).
5. **Retry-on-failure** — failed rows are reissued up to 3 times with
   exponential backoff (1 min → 5 min → 30 min). After the 3rd consecutive
   failure the row stays terminal `failed`, the parent `dsr_audit_log`
   ClickHouse row is updated to `clickhouse_mutation_status = 'failed'`,
   and Sentry captures an error tagged
   `dsr_erase_clickhouse_mutation_failed: true`.
6. **Audit log finalisation** — only when every row for a given
   `dsr_verification_id` reaches a terminal state does the poller update
   the corresponding `dsr_audit_log` ClickHouse row's
   `clickhouse_mutation_id` (CSV of per-table mutation_ids),
   `clickhouse_mutation_status` (aggregate), and
   `clickhouse_mutation_completed_at`.
7. **Idempotency** — re-running `POST /api/dsr/erase` for an already-erased
   session inspects existing `dsr_clickhouse_mutations` rows; if any
   non-terminal row exists, the endpoint returns the current status
   without reissuing. If all rows are `done`, the response reports
   `status: 'done'` with mutations marked `reused`.

Practical timing: ClickHouse Cloud completes typical mutations on session
row volumes (≤ thousands) within seconds; the GDPR 30-day window provides
more than 99.999% headroom. Per Master Design §H.1, the endpoint returns
HTTP 200 with `clickhouse_deletion: { status, mutations[] }` immediately
after mutations are ISSUED, not after they complete — `system.mutations`
is the source of truth for completion.

### H.2. AI Act (EU) — defensive classification

Pełny tekst AI Act stosuje się od **2 sierpnia 2026** (z wyjątkami dla GPAI od sierpnia 2025) ([European Commission timeline](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)). Annex III wymienia "high-risk" systemy obejmujące m.in.:
- AI determining access to essential services (housing/credit)
- AI evaluating creditworthiness
- AI for emotion recognition

**Nasza klasyfikacja: NIE high-risk**, ale przygotowujemy się jakby był (defensive posture):
- Estalara nie podejmuje decyzji o sprzedaży/wynajmie nieruchomości — to robi human agent + buyer
- Personalizacja prezentacji ≠ access decision (Recital 53 explicitly differentiates)
- Brak emotion recognition w sensie biometrycznym (psychologiczny stan inferowany z chatu nie kwalifikuje się — to nie biometric data)

Niezależnie utrzymujemy: **Risk Management System, Data Governance, Technical Documentation, Human Oversight (tenant zawsze może wyłączyć adaptację per buyer), Post-Market Monitoring, Logging (full audit trail w ClickHouse 13 miesięcy retention)**.

Komisja w Digital Omnibus (listopad 2025) zaproponowała powiązanie aplikacji high-risk rules z dostępnością harmonizowanych standardów — co potencjalnie odsunie deadline dla high-risk systems poza 2 sierpnia 2026, ale nie liczymy na to ([European Commission FAQ](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act)).

### H.3. CCPA/CPRA (California)

- Notice at collection (link w SDK widget i w listing footer)
- Honor GPC signal automatically (US tenants opt-in)
- Opt-out of sale/sharing (przy Mode B)
- No sensitive personal info collection by default

### H.4. UK GDPR + ICO

- Lokalna PECR (Privacy and Electronic Communications Regulations) dla ePrivacy
- ICO online tracking strategy 2025 → final guidance po Data (Use and Access) Act 2025 ([Inside Privacy](https://www.insideprivacy.com/data-privacy/ico-announces-its-online-tracking-strategy-for-2025/))
- Data Protection Officer registered with ICO

### H.5. UAE PDPL + DIFC

- DPO required (Art. 10) dla large-scale profiling
- DPIA przed launch (Art. 9)
- Cross-border transfers — UAE Data Office maintains adequacy list; SCC alternative
- DIFC tenants (np. agencja w Dubai International Financial Centre) → DIFC Data Protection Law No. 5 of 2020, separate compliance — bardzo zbliżone do GDPR
- Encryption required: AES-256 at rest, TLS 1.2+ in transit ([ITSEC PDPL guide](https://itsecnow.com/regulators/pdpl-cybersecurity))

### H.6. Polska — UODO + bonus

UODO stosuje GDPR + Ustawę 2018, zwłaszcza ostry na profiling i automatyczne decyzje. Rejestracja DPO w UODO. Cookies/ePrivacy via Prawo telekomunikacyjne — wymaga consent identycznie jak EDPB.

### H.7. NIS2

NIS2 dotyczy "essential" i "important entities" — Estalara prawdopodobnie nie kwalifikuje się jako essential (real estate marketing nie jest critical infrastructure), ale **klienci enterprise (np. Idealista) mogą być** → my musimy spełnić wymagania w SLA: incident reporting w 24h, supply chain security, MFA dla admin access. Zaimplementujemy od dnia 1.

### H.8. Platform-wide consent umbrella — Adaptive-Listings as legal owner (CEO decision 2026-06-21)

> **Binding decision (Piotr Nawrocki, CEO, 2026-06-21):** Adaptive-Listings owns the full consent layer for the entire Estalara platform. This provides the legal umbrella for all platform-wide processing. Implementation tracked by FOLLOW-373.

**Scope of mandatory consent (captured at app.estalara.com registration):**

Consent is captured at registration and is mandatory — chat is only available to registered/logged-in investors, and without granting consent the investor cannot register or use the platform. The AL consent and disclosure layer must lawfully cover all of:

> **Precondition added 2026-07-28 (FOLLOW-659 → FOLLOW-685):** for a **non-first-party (white-label) brand**, registration is *blocked* until that tenant's `brand_config.brand_name` is provisioned — `GET /api/v1/consent/platform-registration` returns `409 brand_identity_not_provisioned` rather than serve consent text naming "Estalara" / "Time2Show, Inc." as that brand's controller. The canonical registration flow is GET-then-echo (fetch the text, display those exact bytes, echo the returned `consent_text_hash` on the POST), specified in `backlog/HANDOFFS.md` → FOLLOW-374 Step 1; operator steps in `docs/runbooks/BRAND_PROVISIONING.md` §Step 3a.

| Purpose | Description | Lawful basis |
|---|---|---|
| (a) Behavioral tracking | Scroll depth, dwell time, click patterns, listing-view rate, quiz answers | Consent (ePrivacy) + GDPR Art. 6.1(a) |
| (b) Reading investor chat | Chat messages read to extract buying intent signals | Consent — explicit disclosure required |
| (c) Transfer to agency/agent | Derived behavioral insights (archetype, confidence) shared with the listing agency | Consent — explicit disclosure required |
| (d) Buying-intent identification | 12-dimensional intent vector (24h TTL, no free text) derived from behavioral signals + chat | Consent + LIA |
| (e) Lead ranking | Investors ranked by buying-intent strength for agent prioritization | Consent + LIA |
| (f) Agent-facing chat summaries | Summaries of questions asked in LIVE chat and Estalara AI chat surfaced to agency staff | Consent — explicit disclosure required |

**Withdrawal-channel invariant (binding — added 2026-08-07, FOLLOW-710 AC-7 / FOLLOW-815, ruled in FOLLOW-814 item 2):** §H.8 mandates consent at registration and, until this date, said nothing about getting out. It does now. **The consent text must at all times name a concrete, reachable channel through which the data subject can withdraw, without needing an account, a form, or the tenant's cooperation** — GDPR Art. 7(3) requires withdrawal to be as easy as granting, and granting is one checkbox click. The channel of record is the monitored mailbox **`compliance@estalara.com`**, named in `renderPlatformConsentText()` and therefore inside the bytes the subject actually reads, from `platform-v1.4-2026-08-07` onward. Two consequences that must survive future edits: (1) removing or weakening that named channel is a DISCLOSED-MEANING change and costs a `PLATFORM_REGISTRATION_TOS_VERSION` bump like any other; (2) the mailbox is an **operator commitment** — it must be monitored, because the disclosure asserts a behaviour no code path can enforce (Rule N). The SDK consent-banner withdrawal affordance for anonymous embed visitors (FOLLOW-145) is the same right on a different surface and is DEFERRED by the same ruling; it can ship later without spending another bump, because the mailbox is the named channel of record.

**C-07 boundary (binding — must never be violated):**

> **⚠️ FLAGGED AS FALSE AS WRITTEN — 2026-08-07 (FOLLOW-866 / ESC-049 addendum, surfaced during FOLLOW-815).** The paragraph below says Adaptive-Listings stores "no free text, no message content". It does. `chat.message.sent.payload.message` (≤4000 chars) is written verbatim into the ClickHouse `events` table and retained **13 months** (`infra/clickhouse/migrations/0001_create_events.sql` TTL) — **by this same §H.8's own deliberate design**, which `packages/shared/src/schemas/events/chat.ts` states in its own words ("§H.8 invariant: the chat event STILL flows to ingest (ClickHouse) regardless of this flag"). The scrubber masks email addresses and phone numbers ONLY. So §H.8 contradicts itself: the invariant a few lines up mandates the ingest write that the C-07 paragraph below denies. **This note is deliberately a FLAG, not a rewrite** — the C-07 boundary is a binding CEO-level design statement and re-drafting it is an architect/CEO call, not a backend worker's (§Y.2). Data subjects are no longer mis-told: §6.1 purpose 2 of `PRIVACY_NOTICE_TEMPLATE.md` now discloses the storage, the SDK banner copy is corrected, and the lawful basis was ruled **legitimate interest with full transparency, no new checkbox** (CEO+DPO, `ESCALATIONS.md` → ESC-049 addendum). Authoritative facts: `docs/compliance/C-07-chat-retention-scope.md` v1.3 (merged 2026-08-07, PR #687), whose §Q3 records that this disclosure "HAS BEEN ISSUED" — this PR is what makes that sentence true. **Someone must reconcile the paragraph below with the invariant above.**

Raw chat text is stored **APP-SIDE only** (app.estalara.com). Adaptive-Listings stores only the 12-dimensional intent vector with a 24-hour TTL — no free text, no message content. This boundary is asserted in code and must be re-confirmed in every compliance document update.

**Rafał (CTO) HANDOFF — app-side retention/deletion windows:**

The following app-side retention and deletion windows are documented by AL for Rafał to implement on the app.estalara.com side:

- Chat message text: retention period to be defined by Rafał; AL recommends ≤90 days or session-end, whichever is shorter, to align with GDPR data minimisation.
- LIVE chat and Estalara AI chat logs: same retention window; deletion must be triggered on DSR erase request forwarded from AL.
- The formal HANDOFF specification lives in `backlog/HANDOFFS.md` (FOLLOW-373 → Rafał Palak, CTO).

**Compliance documents to update (FOLLOW-373 ACs):**

- `docs/compliance/dpia.md` — add purposes (a)–(f) with lawful basis and retention periods
- `docs/compliance/ropa.md` — add processing activity entries for (b)–(f)
- `docs/compliance/lia-template.md` — fill LIA for purposes (d) and (e)
- Privacy Notice template — expand consent disclosure copy for mandatory-at-registration consent
- `packages/sdk/src/ui/consent-banner.ts` — SDK banner copy must enumerate (b)–(f); today it discloses only 7-day audit retention + 90-day cross-session ID

### H.9. Per-user opt-out toggle for DOM adaptation (CEO decision 2026-06-21)

> **Binding decision (Piotr Nawrocki, CEO, 2026-06-21):** A reversible, AL-only per-user opt-out for DOM adaptation is added as a legal safeguard and product showcase feature. Implementation tracked by FOLLOW-372.

**Scope (AL-DOM only):**

- The toggle controls **Adaptive-Listings DOM adaptation only**: archetype-based headline/photo-order/features DOM mutation and the underlying profiling that drives it.
- It does **NOT** affect app.estalara.com's own buying-intent identification, lead ranking, or agent-facing chat summaries — those ride the mandatory registration consent (§H.8) and are outside AL's per-user opt-out scope.

**Reversible — NOT erasure:**

- OFF state: suspends AL profiling + DOM adaptation for the opted-out user. Accumulated archetype and intent state is preserved (enables the with/without comparison showcase).
- ON state: resumes full adaptation with no data loss.
- Hard erasure (Art. 17 GDPR consent withdrawal) remains on the FOLLOW-139 withdrawal path and is not altered by this toggle.

**Technical seams:**

| Component | Effect when opt-out = OFF |
|---|---|
| `packages/sdk/src/index.ts` | Skip `applyArchetypeHints()` and intent-weight updates at init |
| DOM adaptation layer | Return slots to tenant default; suppress mutation |
| `apps/decision-api/src/lib/consent-gate.ts` | Extended with `profilingOptOut` flag → return neutral directives |
| `apps/intent-engine/src/redis_writer.py` | Skip applying AL chat-intent shadow prior for opted-out sessions |
| Persistence | localStorage key + optional `consent_records` row; per-user only; no tenant-wide effect |

**Compliance note:**

Compliance-engineer to confirm in FOLLOW-373 DPIA update that suspend-not-erase is sufficient for AL-only DOM adaptation (no new PII is created by the suspend state; the 12-dim vector TTL continues to expire naturally).

---

## I. Stack Technologiczny — Konkretne Rekomendacje

### I.1. Frontend SDK

| Layer | Wybór | Alternatywy | Rationale |
|---|---|---|---|
| Language | **TypeScript 5.x** strict mode | — | Standard dla DX i enterprise integration |
| UI runtime | **Preact 10** | React (za duży), Lit (mniej ekosystemu), vanilla JS (za bolesne dla Tier 3) | Preact = React API w 3.5KB, idealne dla embeddable |
| Bundler | **tsup** (oparte na esbuild) + **Rollup** dla finalnego CDN bundle | Vite (build-tool nie library-tool), Webpack (wolne) | tsup szybki + multi-format output |
| Styling | **CSS-in-JS przez @emotion/css** w Shadow DOM, Constructable Stylesheets dla shared base | Tailwind (problem z Shadow DOM), styled-components (overhead) | Constructable Stylesheets share parsing cost między 50+ instancjami komponentów |
| State | **Nanostores** (1KB) lub Zustand vanilla | Redux (przesada), Jotai (React-only) | Lightweight, framework-agnostic |
| Telemetry | Custom (ingest endpoint), opcjonalnie OpenTelemetry Web | Sentry SDK (za duży) | Custom jest 2KB |

### I.2. Backend

| Layer | Wybór | Alternatywy | Rationale |
|---|---|---|---|
| Edge ingest | **Cloudflare Workers + Durable Objects** | Vercel Edge Functions, AWS Lambda@Edge | Cloudflare ma zero cold start (V8 isolates), $0.30/M requests, unlimited bandwidth, 300+ POPs ([Northflank](https://northflank.com/blog/best-cloudflare-workers-alternatives)). Vercel pricing kapie z bandwidth ($0.06/GB egress) |
| Control plane API | **Next.js 15 App Router on Vercel** (już mamy) | Hono on Cloudflare, NestJS | Kontynuujemy istniejący stack, używamy Edge Runtime gdzie sensowne |
| Worker tasks (intent enrichment, archetype updates) | **Modal** (serverless GPU/CPU) | Inngest (event workflows), AWS Lambda, Trigger.dev | Modal = Python-native, świetne dla ML serving (Modal $1.1B valuation 2025), GPU support, Oracle Cloud partnership for affordable GPU ([Introl analysis](https://introl.com/blog/serverless-gpu-platforms-runpod-modal-beam-comparison-guide-2025)). RunPod tańsze ale bardziej manual |
| Real-time event bus | **Redpanda Cloud** (Kafka-compatible) | Confluent Kafka, AWS Kinesis ($0.014/shard-hour), Cloudflare Queues | Redpanda ma 10x lepszy single-node throughput niż Kafka, niższy ops overhead, multi-region |
| Transactional DB | **Supabase (Postgres 16)** — EU project active; additional regions on-demand (post-seed) | Neon (świetne branching ale słabsze RLS), self-hosted RDS | Supabase = Postgres + auth + RLS + realtime in one. RLS jest battle-tested dla multi-tenant ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)) |
| Event store | **ClickHouse Cloud** | TimescaleDB, Snowflake | ClickHouse 4.8x szybsze loading + 1.7x mniejszy disk niż konkurencja na dużych aggregations ([Tinybird](https://www.tinybird.co/blog/clickhouse-vs-timescaledb)). Trade-off: nie cool dla małych częstych pisów, więc batchujemy na edge |
| Vector DB | **pgvector w Supabase** (do 5–10M wektorów), później **Qdrant Cloud** | Pinecone (drogi przy >10M), Weaviate (skomplikowany ops) | pgvectorscale (Timescale's extension) osiąga 471 QPS @ 99% recall na 50M vectors, conkurencyjne z Pinecone ([dev.to](https://dev.to/polliog/postgresql-as-a-vector-database-when-to-use-pgvector-vs-pinecone-vs-weaviate-4kfi)) |
| Cache / session store | **Upstash Redis** (multi-region, pay-per-request) | Redis Cloud, Vercel KV | Multi-region replication, $0.20/100k commands, idealne dla intent vector cache |
| LLM gateway | **LiteLLM** (self-hosted) lub **OpenRouter** | Direct provider SDKs | Router pozwala na fallback Claude → OpenAI → Cohere, cost tracking, retry logic, jeden interfejs |

### I.3. ML/AI

| Use case | Provider | Model | Koszt |
|---|---|---|---|
| Intent extraction z chatu (real-time, <500ms) | Anthropic | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | $1/$5 per MTok — real-time per-message path |
| Intent extraction z chatu (batch enrichment, 6h async) | Anthropic | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | $3/$15 per MTok — pełny kontekst konwersacji, wyższa accuracy dla multilingual |
| Adaptation reasoning (złożone) | Anthropic | **Claude Sonnet 4.6** | $3/$15 per MTok |
| Headline rewrite (Tier 3 premium) | Anthropic / OpenAI fallback | Sonnet 4.6 / GPT-5.2 | Sonnet $3/$15, GPT-5.2 $1.75/$14 ([IntuitionLabs](https://intuitionlabs.ai/articles/ai-api-pricing-comparison-grok-gemini-openai-claude)) |
| Embeddings | OpenAI | **text-embedding-3-small @ 1024 dim** | $0.02/MTok |
| Photo CLIP scoring | Workers AI built-in (CLIP ViT) | OpenAI Vision (drogie dla volume) | Workers AI ~$0.011/1k requests |
| Future fine-tuned intent classifier | Modal hosted | Llama 3.1 8B fine-tuned na własnych anonimowych konwersacjach | ~$0.50/1k inferences na Modal H100 |

### I.4. Hosting & Infrastructure

- **Vercel Pro**: dashboard + control plane API (~$20/dev + usage)
- **Cloudflare**: Workers ($5/mo + $0.30/M req), R2 storage ($0.015/GB), CDN free
- **Supabase Pro**: $25/project/mo + usage; we run 4 (eu, us, uk-residency, scaling/failover)
- **ClickHouse Cloud**: ~$500–2000/mo at MVP scale
- **Modal**: pay-per-use, ~$300/mo MVP
- **Upstash Redis**: ~$50–200/mo
- **Total infra MVP** ≈ **$2 500–4 000/mo** (skaluje się z usage)

### I.5. Observability

- **Sentry** dla errors (frontend + backend)
- **OpenTelemetry** + **Grafana Cloud** (free tier do 10k metrics) lub **Datadog** dla enterprise tier (~$31/host/mo)
- **PostHog Cloud EU** dla product analytics (self-hosted opcja w roadmapie dla data residency)
- **Custom dashboard w control plane** dla tenant-facing metrics

### I.6. Dev tooling

- Monorepo: **Turborepo** + **pnpm**
- CI/CD: **GitHub Actions** + **Vercel** auto-deploy + **Cloudflare Wrangler** for Workers
- IaC: **Terraform** dla AWS/Cloudflare, **Pulumi** opcjonalnie dla TypeScript-native
- Secrets: **Doppler** lub **Infisical** (open source)
- Feature flags: **PostHog** built-in lub **Statsig** ($0 do 1M events/mo)

---

## J. Multi-Tenancy Model — szczegółowy design

### J.1. Schema strategy

**Hybrid approach:**
- **Shared schema z RLS** dla wszystkich tabel transakcyjnych (tenants, users, listings_metadata, configs, billing) — Supabase RLS per `tenant_id` claim w JWT
- **Schema-per-tenant** dla pgvector embeddings (top-100 enterprise klientów) — lepsza performance dla complex similarity queries
- **Partition-per-tenant** w ClickHouse dla events — tanie i szybkie

```sql
-- przykład RLS policy
CREATE POLICY tenant_isolation ON listings_metadata
  FOR ALL TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

### J.2. API key model

- **Public API key** (per origin, rate-limited): wkleja się w SDK, OK dla client-side
- **Secret API key** (server-side): dla webhook adapters, MLS feed sync, CRM integration
- HMAC sign każdy request z `secret`; rotacja keys w 1-click dashboard
- Per-key scopes: `read:events`, `write:adaptations`, `admin:config`

### J.3. Konfiguracja klienta

Per-tenant configuration JSON Schema:

```typescript
type TenantConfig = {
  tenant_id: string;
  display_name: string;
  region: 'eu' | 'us' | 'uk' | 'uae';
  tier: 'observer' | 'augment' | 'native';
  brand_tokens: { primary_color, secondary_color, font_family, ... };
  brand_voice: { tone, formality, vocabulary_constraints, ... };
  signals_enabled: SignalCategory[];
  adapters: { intercom?, drift?, idealista?, otodom?, ... };
  fair_housing_rules: 'us_strict' | 'uk_standard' | 'eu_standard' | 'custom';
  privacy_mode: 'session' | 'consented' | 'legitimate_interest';
  consent_helper_enabled: boolean;
  white_label: { logo_url?, hide_estalara_badge: boolean };
  webhook_url?: string;
  audit_retention_days: 30 | 90 | 365 | 'compliance';
  
  // NEW v1.1 — Auto-onboarding fields (see B.4-B.6)
  data_schema: TenantSchemaMapping;  // auto-generated, manually editable
  onboarding_status: 'pending' | 'auto_detecting' | 'ready' | 'needs_review';
  primary_url: string;               // dla continuous validation
  detected_platform?: string;        // 'wordpress-houzez', 'idealista', etc.
  schema_health_score: number;       // 0-1, updated daily
  last_drift_detected?: string;      // ISO timestamp
  auto_recovery_enabled: boolean;    // default: true
};
```

### J.4. Per-tenant dashboard

Sekcje w dashboardzie:
1. **Overview**: live visitors, active intent-detected sessions, conversion lift
2. **Adaptations**: which listings adapted, top-performing variants, A/B results
3. **Buyer Archetypes (anonymized)**: distribution of buyer types z ich własnego ruchu
4. **Configuration**: tier upgrade/downgrade, signals enable/disable, brand tokens
5. **Integrations**: chat, CRM, MLS feed, webhook
6. **Billing**: current usage, projection, invoices
7. **Compliance**: DPIA template download, ROPA export, DSR queue
8. **Audit log**: kto co zmienił, kiedy

### J.5. Standalone Estalara product

Identyczna architektura, różnica tylko w *frontendzie*:
- Plug-in mode: SDK na cudzej stronie, dane z ich feedu
- Standalone mode: nasz Next.js frontend hostowany na `{tenant}.estalara.app`, ten sam SDK używa się internally, ale my dostarczamy też CMS-like editor dla listingów

To pozwala small agencies bez własnej strony użyć Estalara end-to-end, podczas gdy enterprise integruje SDK do swojej istniejącej witryny.

---

## K. Internal Operations Panel (Estalara Staff Only)

Sekcja zamyka lukę zidentyfikowaną po Sprint 0: nie było planu dla wewnętrznego panelu admin dla staff Estalara (Piotr/CEO, Rafał/CTO, future Customer Success staff) do monitoringu i interwencji w tenant instances. `apps/control-plane` istnieje, ale jest dla tenant-facing dashboardów. Dodajemy internal staff-only routes w tym samym Next.js app (separacja na poziomie middleware + RBAC, nie osobny app — jeden deployment, jeden auth domain, mniejszy ops overhead).

### K.1. Access levels (RBAC, 3 role)

| Rola | Kto | Permissions |
|---|---|---|
| `estalara:superadmin` | Piotr (CEO) + Rafał (CTO) | Full access including tenant suspension, billing changes, dangerous interventions |
| `estalara:ops` | Customer Success staff (post-Series A) | View all tenants, send alerts to tenants, force-refresh schema; **CANNOT** suspend tenants ani zmieniać billing |
| `estalara:readonly` | Future auditors / inwestorzy | Read-only access do aggregated metrics dashboards, no per-tenant deep-dive |

Rola przechowywana w `users.estalara_role` enum (separate od tenant role w sekcji J — staff member może też być tenant userem, role są niezależne). Wszystkie akcje staff logowane do `staff_audit_log` (K.5) — append-only, retention 7 lat (compliance + investigation requirements).

### K.2. Routing (apps/control-plane)

- `/admin/*` routes — separate from `/dashboard/*` tenant routes (które używają tenant subdomeny lub `/t/{tenant_id}/`)
- Middleware (Next.js Edge Middleware) sprawdza `estalara_role` na każdym `/admin/*` request, redirects do 403 jeśli not staff
- Separate Supabase RLS policy: staff z `estalara_role IS NOT NULL` może czytać all rows w `tenants/events/listings_metadata/etc`, podczas gdy regular tenant users widzą tylko `own_data(t)` per existing F section
- Session timeout: **1h inactive** (vs 24h dla tenant users)
- Wszystkie `/admin/*` routes wymagają **MFA mandatory** (TOTP via Supabase Auth, hardware key opcjonalny)

### K.3. Phase 1 — Monitoring (Sprint 3–4, read-only)

#### K.3.1. Fleet Overview Dashboard

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Estalara Internal Ops — Fleet Overview                          [👤 ops] │
├──────────────────────────────────────────────────────────────────────────┤
│ Filtry: [status ▼] [region ▼] [plan ▼] [search tenant...]                │
├──────────────────────────────────────────────────────────────────────────┤
│ Tenant            Status   Last seen   Events 24h   DQS    Plan   MRR   │
│ ─────────────────────────────────────────────────────────────────────── │
│ 🟢 marbella-rs     active   2m ago      12 430       0.81   T2     $1999 │
│ 🟢 idealista-pl    active   12s ago     1 892 003    0.74   Ent    $25k  │
│ 🟡 london-elite    trial    4h ago      341          0.58   T1     $499  │
│ 🔴 warsaw-realty   warn     1d ago      0            n/a    T1     $499  │
│ ⚫ test-suspended  susp.    14d ago     0            n/a    —      $0    │
└──────────────────────────────────────────────────────────────────────────┘
```

Tabela wszystkich tenantów z kolumnami: status, last_seen, events_24h, archetype_confidence_avg (DQS z D.5.3), plan, MRR. Filterable by status (active/suspended/trial), region, plan tier. Click row → Tenant Detail page (K.3.2).

#### K.3.2. Tenant Detail Page

Pięć sekcji per tenant:

- **SDK health:** wersja zainstalowana (z latest event metadata), last heartbeat timestamp, errors w last 24h (z Sentry), bundle hash
- **Archetype quality:** confidence distribution histogram, top 5 detected archetypes (per Q.x scenarios), accuracy vs ground truth (cross-reference D.5 — pełen DQS panel)
- **Auto-detect health:** schema confidence (B.4), last refresh date, drift indicators (B.5.4 fingerprint distance, B.6 health score)
- **Billing:** plan, usage vs limit, MRR, days until next invoice, payment status (Stripe webhooks)
- **Recent activity:** last 100 events (ClickHouse query), last 10 admin actions on this tenant (z `staff_audit_log`)

#### K.3.3. Alerts Center

Auto-generated alerts gdy conditions trigger:

| Alert type | Warunek | Default severity |
|---|---|---|
| `sdk_silent` | SDK silent >1h na tenancie który normalnie ma events | warning |
| `dqs_drop` | DQS < 0.4 na >50% decyzji w ostatnim 1h window | critical |
| `usage_approaching_limit` | Usage > 80% plan limit | warning |
| `schema_drift_predicted` | B.5.4 fingerprint cosine < 0.85 | warning |
| `payment_failed` | Stripe `invoice.payment_failed` webhook | critical |
| `archetype_unstable` | Stability score < 0.5 dla nowego tenanta | info |

Severity: info / warning / critical. Assignable to ops staff (claim/assign UI). Acknowledged/resolved tracking. SLA per severity: critical = 30 min, warning = 4h, info = 1 dzień.

#### K.3.4. Global ML Health (superadmin only)

Cross-tenant aggregated metrics (z respect dla DP guarantees w F.3):
- Composite DQS distribution (per archetype, per region)
- Archetype distribution shifts (np. "luxury investor" rośnie 18% MoM)
- Embedding drift detection (centroid movement w archetype space)
- Model performance trends (accuracy, latency p95/p99 per LLM provider)

Used to detect when global model retraining is needed (cross-ref D.5.4 weekly retrain trigger). Restricted (sensitive ML internals) — superadmin only.

#### K.3.5. Revenue Dashboard (superadmin only)

MRR, ARR, churn rate (logo + revenue), expansion rate (NDR), gross margin per tenant. Tenants at churn risk (declining usage, support tickets, payment issues — composite "churn risk score"). Cohort analysis (signup month → retention curve). Exportable do CSV dla board reports.

### K.4. Phase 2 — Intervention (Sprint 5–6, read-write z audit log)

Każda akcja w K.4 wymaga `reason` (free text, min 10 znaków), confirmation modal, i automatic log do `staff_audit_log` (K.5).

#### K.4.1. Tenant Lifecycle Actions (superadmin only)

- **Suspend tenant** (pauses all SDK responses — Decision API zwraca `{adapt: false}`, soft-delete approach: row pozostaje, flag `suspended_at` set)
- **Reactivate** suspended tenant (clears `suspended_at`)
- **Force-cancel subscription** (Stripe cancel + reason field, nie usuwa danych)
- **Migrate tenant region** (rare, requires DB backup snapshot + dual-write window — runbook w `docs/runbooks/region-migration.md`)

#### K.4.2. Personalization Override (superadmin + ops)

- **Disable personalization** dla specific tenant (returns control archetype globally — useful przy customer escalation albo investigation)
- **Reset archetype assignments** dla specific user_id within tenant (clears Redis session + invalidates intent vector)
- **Force-refresh** auto-detected schema (triggers B.4 re-run)
- **Re-run signal classification** na historical events (replay z ClickHouse, useful po model improvement)

#### K.4.3. SDK Management (superadmin)

- **Pin tenant** to specific SDK version (rollback support — overrides `latest` channel)
- **Push hotfix** SDK version do specific tenant subset (canary deployment dla SDK fixes)
- **Force-refresh CDN cache** dla tenant's SDK bundle (Cloudflare purge by tag)

#### K.4.4. Communication (superadmin + ops)

- **Send in-product notification** do tenant admins (banner w `/dashboard`)
- **Send email** do tenant via configured channels (SES, with Estalara branding)
- **Schedule maintenance notice** (cron-driven announcement)
- **Mark tenant as "VIP"** (priority support flag — escalates ticket SLA)

#### K.4.5. Audit Log (all staff view own, superadmin sees all)

Każda K.4.* akcja logged z: actor, target, action_type, timestamp, reason (required), before_state JSON, after_state JSON, IP, user agent. Immutable (append-only — DB trigger blocks UPDATE/DELETE). Exportable for compliance audits (GDPR DSAR, SOC2 evidence). Retention: **7 lat** (regulatory + insurance requirement).

### K.5. Data model

Trzy nowe tabele:

```sql
-- staff_audit_log: immutable audit trail (append-only via trigger)
CREATE TABLE staff_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action_type action_type_enum NOT NULL,    -- 'suspend_tenant', 'reset_archetype', etc.
  target_tenant_id uuid REFERENCES tenants(id),
  target_user_id uuid REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) >= 10),
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_audit_actor ON staff_audit_log(actor_user_id, created_at DESC);
CREATE INDEX idx_staff_audit_tenant ON staff_audit_log(target_tenant_id, created_at DESC);

-- alerts: ops alert queue
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity severity_enum NOT NULL,           -- 'info' | 'warning' | 'critical'
  tenant_id uuid REFERENCES tenants(id),
  alert_type alert_type_enum NOT NULL,       -- 'sdk_silent', 'dqs_drop', etc.
  payload jsonb,
  assigned_to_user_id uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_open ON alerts(severity, created_at DESC)
  WHERE resolved_at IS NULL;

-- tenant_health_snapshots: materialized view, refreshed every 5 min
CREATE MATERIALIZED VIEW tenant_health_snapshots AS
SELECT
  t.id as tenant_id,
  now() as snapshot_at,
  -- SDK version z latest event
  (SELECT sdk_version FROM events
   WHERE tenant_id = t.id ORDER BY ts DESC LIMIT 1) as sdk_version,
  -- events w last 24h
  (SELECT count() FROM events
   WHERE tenant_id = t.id AND ts > now() - interval '24 hours') as events_24h,
  -- avg DQS z D.5.3
  (SELECT avg(dqs) FROM session_quality
   WHERE tenant_id = t.id AND ts > now() - interval '24 hours') as avg_dqs,
  -- active alerts count
  (SELECT count(*) FROM alerts
   WHERE tenant_id = t.id AND resolved_at IS NULL) as active_alerts
FROM tenants t;
```

### K.6. Sprint mapping

| Sprint | Tickets | Co dostarcza |
|---|---|---|
| Sprint 3 (SDK Tier 1) | TICKET-XXX foundations | `estalara_role` enum, `/admin/*` middleware, basic Fleet Overview read-only |
| Sprint 4 (Intent ontology) | TICKET-XXX | Tenant Detail, Alerts Center, Global ML Health (ties into model retraining decisions per D.5) |
| Sprint 5 (LLM gateway) | TICKET-XXX | Phase 2 begins — Personalization Override, Communication |
| Sprint 6 (Embeddings + matching) | TICKET-XXX | Tenant Lifecycle Actions, SDK Management, full Audit Log |
| Sprint 9 (DPIA + compliance) | TICKET-XXX | Audit Log retention enforcement, exportable for GDPR audits, ROPA integration |

### K.7. Security

- Wszystkie `/admin/*` routes wymagają **MFA** (mandatory dla `estalara:*` ról, optional dla tenant users)
- Staff IP allowlist (configurable, default: any IP ale logged with geo-IP)
- Session timeout: **1h inactive** (re-auth required after)
- Wszystkie staff actions trigger Slack notification do `#estalara-ops` channel (real-time visibility)
- **Quarterly access review** (superadmin reviews i re-confirms ops staff list — compliance hygiene)
- Hardware security key (WebAuthn) wymagane dla `superadmin` od Sprint 9 (post-MVP hardening)

### K.8. Cross-references

- **Section B.4–B.7** (Auto-Onboarding): Internal Ops może force-refresh detected schemas (K.4.2)
- **Section J** (Tenant Auth): `estalara_role` żyje w tej samej `users` table ale jest niezależna od tenant memberships
- **Section D.5** (Detection Quality): Tenant Detail page (K.3.2) surface'uje D.5 metrics; K.3.4 Global ML Health agreguje DQS cross-tenant
- **Section R** (Innovation Roadmap): Internal Ops dogfooded dla measuring innovation impact (R.1–R.6 metrics surface'ują się w K.3.4)
- **Section H** (Compliance) Sprint 9: `staff_audit_log` feeds do ROPA exports (Art. 30 GDPR)

---

## L. Pricing Model (Hybrid)

### L.1. Pricing tiers — konkretne stawki

**TIER 1 "Observer"** — Self-serve, kredyt karta, instant signup
- Base: **$499/month** (annual: $4 990, save 17%)
- Included: 50k tracked visits/mo
- Overage: **$0.40 / 1k additional visits**
- LLM: not used (pure observation + widget)
- Target: solo agents, brokerages 1–10 people

**TIER 2 "Augment"** — Light-touch sales, 14-day trial
- Base: **$1 999/month** (annual: $19 990)
- Included: 200k tracked visits + 50k adaptations
- Overage: $1.20 / 1k adaptations, $0.30 / 1k additional visits
- LLM passthrough: actual LLM cost + 25% margin
- Target: mid-market agencies, 10–100 agents

**TIER 3 "Native"** — Enterprise, sales-led, custom contract
- Base: **starting $7 500/month** (annual contract minimum)
- Included: 1M visits, 500k adaptations, 100k LLM-rendered listings
- Overage: $4 / 1k rendered listings, LLM passthrough +20%
- White-label + SLA 99.95% + dedicated CSM + custom features
- Target: portals (Idealista/Otodom/Zillow scale), enterprise brokerages

**Free tier (long-tail acquisition):**
- 5k visits/mo, Estalara badge wymagane, no LLM features, watermarked
- Cel: SEO + viral acquisition + funnel do Tier 1

### L.2. Pricing benchmarking — competition

| Vendor | Entry pricing | Notes |
|---|---|---|
| **Mutiny** | Custom, listed ~$1k/mo entry, real deals $50k–$200k+ ARR | B2B ABM personalization, nie real-estate-specific ([Vendr](https://www.vendr.com/marketplace/mutiny)) |
| **Optimizely Web Experimentation** | ~$36k/rok minimum, $113k+ enterprise dla 10M impressions | Pure A/B testing ([Mida](https://www.mida.so/blog/how-much-is-optimizely)) |
| **Dynamic Yield** | ~$35k–60k+/rok minimum, $250k+ dla enterprise | Mastercard-owned, e-commerce focus ([Personizely](https://www.personizely.net/blog/dynamic-yield-pricing)) |
| **Segment (CDP)** | $25k–$200k/rok depending on volume | Data pipeline, not personalization ([Spendflo](https://www.spendflo.com/blog/segment-pricing-guide)) |
| **Drift** | ~$2 500/mo entry ($30k/rok) | Conversational sales, B2B ([Social Intents](https://www.socialintents.com/blog/drift-vs-intercom/)) |
| **Intercom** | $39/seat starting, $903/mo Advanced, scales to enterprise tens of thousands | Customer support primary ([Featurebase](https://www.featurebase.app/blog/intercom-pricing)) |

**Nasze pricing rationale:** plasujemy Tier 2 niżej niż Mutiny/Dynamic Yield (specjalizacja vertical, nie general-purpose), Tier 3 enterprise konkurencyjnie z Dynamic Yield ale z unique value prop (real-estate vertical depth + EU-first z dnia 1; US/UK/UAE deployment on-demand post-seed — multi-region jest *region-pluggable* w architekturze, nie *region-deployed* dziś).

### L.3. Enterprise dla portals (Idealista/Otodom/Zillow scale)

Custom enterprise contracts:
- Base $50k–$200k+/mo
- Volume discounts: -10% przy >5M visits/mo, -20% przy >50M
- 3-year commitment unlock dodatkowe 15–25% discount (zgodne z industry norm — Vendr data dla Optimizely/Segment)
- Co-marketing rights (case studies, joint webinars)
- On-prem option (Year 3+) dla największych

---

## M. Business Model & Go-To-Market

### M.1. Plan wdrożenia (4 fazy)

| Faza | Czas | Cele | Liczba klientów | ARR target |
|---|---|---|---|---|
| **MVP** | M1–M3 | Build core platform + Tier 1 + Tier 2 (basic), 3-5 design partners | 3–5 (free pilots) | $0 |
| **Beta** | M4–M6 | Stabilize, add Tier 3 Native, recruit pilot enterprise | 10–20 paying | $200–400k |
| **General Availability** | M7–M12 | Marketing engine, content, case studies, self-serve flow | 50–100 paying | $1–2M |
| **Enterprise tier** | Y2 | Dedicated SE team, channel partnerships, on-prem option | 5–10 enterprise + 200+ SMB | $5–10M |

### M.2. Acquisition channels

**Tier 1 Observer (self-serve):**
- SEO content: "AI for real estate listings", "real estate website personalization", "Idealista alternative for personalization"
- Polish + English + Spanish blog
- Free tier viral loop ("Powered by Estalara" badge na free tier)
- Real estate communities (BiggerPockets, ARRA, polskie grupy FB agentów)

**Tier 2 Augment (light-touch):**
- Outbound do top 500 agencji w każdym z 5 rynków (US/UK/ES/PL/UAE)
- Webinary "How AI is changing real estate listings"
- Industry conferences: Inman Connect, REtech, Property Forum (Polska), Dubai REst

**Tier 3 Native (enterprise sales):**
- Account-based marketing dla top 50 portals/brokerages globally
- Partnerships: HouseSigma, Boomtown CRM, Reonomy, Lone Wolf — integracje + co-sell
- Direct relationships z Idealista (enterprise plan SE-led), Otodom (Allegro Group), Rightmove (UK), Zillow Group (US)
- W UAE: Bayut (Dubizzle Group), Property Finder

### M.3. Sales motion per tier

| Tier | Motion | Time-to-close | ACV |
|---|---|---|---|
| Tier 1 | Self-serve, credit card, 24h activation | minutes | $5 988/yr |
| Tier 2 | Light-touch, 30-min demo, 14-day trial, contract | 14–30 dni | $24 000–48 000/yr |
| Tier 3 | SE-led, POC, custom contract, security review, DPIA | 60–120 dni | $100k–500k+/yr |

---

## N. Koszty & Unit Economics

### N.1. COGS — kalkulacja per 1 000 visits / adaptations / inferences

**Założenia bazowe:**
- 1 wizyta = avg 60 events, 4 adaptacje, 0–1 chat session (avg 2 messages), 3–8 LLM inferences
- LLM mix: 80% Claude Haiku 4.5 ($1/$5 per MTok), 20% Sonnet 4.6 ($3/$15)
- Avg input/output per inference: 800 / 200 tokens

| Komponent | Koszt na 1k visits | Komentarz |
|---|---|---|
| Cloudflare Workers ingest (60k events) | $0.018 | $0.30 / M req |
| ClickHouse Cloud storage + queries | $0.05 | based on $1500/mo dla 100M events/mo |
| Postgres (Supabase) — config reads | $0.005 | minimal |
| Embedding (per session ~10 calls × 500 tokens) | $0.10 | OpenAI text-embedding-3-small |
| LLM intent + adaptation (~5 inferences avg) | $1.50 | 80% Haiku, 20% Sonnet |
| GPU inference (CLIP photo scoring, cached) | $0.02 | mostly amortized |
| CDN egress (SDK delivery) | $0.10 | Cloudflare free egress, only R2 storage |
| Egress to LLM providers | $0.05 | minimal |
| **Total COGS / 1k visits** | **~$1.85** | |
| **Total COGS / 1k adaptations** (no LLM) | **~$0.40** | mostly compute |
| **Total COGS / 1k LLM inferences** | **~$3.00** | dominated by Sonnet |

### N.2. Margin targets per tier

| Tier | Avg revenue/1k visits | COGS/1k visits | Gross margin |
|---|---|---|---|
| Tier 1 Observer ($0.40/1k overage) | $0.40 | $0.10 (no LLM, light ops) | 75% |
| Tier 2 Augment ($1.20/1k adaptations) | $1.20 | $0.40 | 67% |
| Tier 3 Native ($4/1k rendered + LLM passthrough) | $4.00 + $0.50 LLM markup | $1.85 + LLM cost | 70% blended |

**Blended target: 70–75% gross margin**, w linii z najlepszymi B2B SaaS.

### N.3. CAC i LTV

Estymacje na podstawie analogicznych SaaS:

| Tier | CAC | ACV | Year 1 LTV (assuming 90% logo retention, 110% NRR) | LTV/CAC |
|---|---|---|---|---|
| Tier 1 (self-serve) | $200 | $5 988 | $30k 5-yr | 150x (excellent) |
| Tier 2 (light-touch) | $3 000 | $36 000 | $180k 5-yr | 60x |
| Tier 3 (enterprise) | $40 000 | $250 000 | $1.5M+ 5-yr | 37x |

**Payback period target: <12 miesięcy dla Tier 1, <18 dla Tier 2, <24 dla Tier 3.**

---

## O. Ryzyka i Mitygacje

### O.1. Techniczne

| Ryzyko | Prawdopodobieństwo | Impact | Mitygacja |
|---|---|---|---|
| SDK latency >100ms degraduje UX klienta | Medium | High | Performance budget per tier; Cloudflare edge; lazy-load; chaos engineering testy |
| Intent misidentification (np. flagujemy retiree jako student) | High (early) | Medium | Confidence threshold; default-no-adapt; A/B holdout zawsze on; monthly accuracy audit |
| Scaling do 10M+ events/dzień przed Y2 | Medium | High | ClickHouse + Cloudflare radzą sobie; load test po MVP; budget na ClickHouse upgrade |
| Vector DB hit ceiling (pgvector @ 10M+) | High w Y2 | Medium | Plan migracji do Qdrant w roadmapie Q4 Y1 |
| Detection accuracy regression przy retraining | Medium | High | Canary deployment 1% traffic, DQS comparison 24h, auto-rollback if regression > 2pp. Patrz D.5.4 |

### O.2. Prawne

| Ryzyko | Prawdopodobieństwo | Impact | Mitygacja |
|---|---|---|---|
| Enforcement na fingerprinting w EU/UK | High | High | Mode A jako default; strict legal opinion przed launch; Estalara Consent Helper jako optional component; transparent privacy notice |
| AI Act high-risk classification by regulator | Low–Medium | Very High | Defensive posture (pełna dokumentacja jakby był high-risk); legal counsel relationship; participate in CEN/CENELEC consultations |
| Data localization wymóg w UAE | Medium | Medium | Region-specific deployment od dnia 1; AWS me-central-1 plan ready |
| Schrems III scenario (US transfers) | Medium | High | Data residency w EU; SCC + supplementary measures; dla US tenantów ich dane stay w US-region |

### O.3. Konkurencyjne

| Konkurent | Threat level | Komentarz |
|---|---|---|
| **Mutiny** | Medium | Mogliby wejść w real estate, ale ich DNA to B2B ABM. Nasza vertical depth jest realnym moat. |
| **Salesforce/HubSpot** | Low–Medium | Mają CRM, ale nie embeddable adaptive listing layer. Przez 2–3 lata bezpiecznie. |
| **Adobe Target** | Low | Enterprise-only, drogie, generic personalization, nie real-estate. |
| **Zillow / Realtor.com / Idealista internal AI** | High | Już budują własne AI search ([Real Estate News](https://www.realestatenews.com/2025/10/14/2-more-portals-embrace-ai-powered-home-search-tools)). Strategy: zostać partnerem, nie konkurentem — sprzedajemy IM Tier 3 enterprise z ich brandem |
| **Real-estate-specific startupy** | Medium | Niewielu z nas widzi (RentSync, EliseAI w property mgmt, ale nie embeddable adaptive listings). Mamy 18-mo head start. |

### O.4. Reputacyjne — "creepy factor"

- Default privacy mode = Mode A (session only, brak persistence)
- Transparent: każdy listing pokazuje "Powered by Estalara — learn more" link → strona "How we personalize"
- Buyer może opt-out 1-click (cookie sets, persistence cross-session)
- Limit adaptation aggressiveness: max 30% headline/copy delta od oryginału (etyczne nie-misleading)
- Fair-housing constraint linter: nigdy nie filtrujemy/adaptujemy na podstawie chronionych klas (race, religion, family status etc.) — to jest hard-coded, nie konfigurowalne

### O.5. Reliance na third parties

| Vendor | Risk | Mitigation |
|---|---|---|
| Anthropic Claude | Pricing change, downtime | LiteLLM router → OpenAI fallback; long-term plan: fine-tuned Llama na Modal |
| OpenAI embeddings | Price hike, model deprecation | Plan na BGE-M3 self-hosted w Y2 (break-even @ 15M embed/mo) |
| Cloudflare | Outage, vendor lock-in | Multi-region; failover do Vercel Edge; Workers-compatible standard (Hono) używany |
| Vercel | Pricing escalation | Architecture pozwala na migrację na Cloudflare Pages + Workers w razie potrzeby |

### O.6. ML model risks

Wprowadzenie systemu D.5 (Continuous Detection Quality) i innowacji R.1–R.6 (patrz sekcja R) tworzy nowe kategorie ML-specific ryzyk, które wcześniej nie istniały (gdy adaptacja była rule-based). Tabelka mitygacji:

| Ryzyko | Prawdopodobieństwo | Impact | Mitygacja |
|---|---|---|---|
| Detection Quality Score (DQS) plateau przy 70–75% — nie osiągamy 90% target | Medium | Very High | Active learning queue (D.5.5), quarterly archetype refresh (D.5.4), fallback to fine-tuned classifier Y2; jeśli plateau utrzymuje się >2 sprinty, eskalacja do Krystiana z propozycją expanded archetype set |
| Cross-tenant retraining wprowadza bias (over-representation top-3 tenants) | High | Medium | Stratified sampling per tenant, k-anon ≥50 per archetype across tenants minimum, weighted loss function (rare tenants up-weighted) |
| Adversarial attack — bot fakuje signals żeby manipulować adaptation | Low (MVP) | Medium | Bot detection w ingest (rate limit, CAPTCHA dla suspicious patterns), tagged jako "low_trust" sessions excluded z global learning loop (D.5.4) |
| Distribution shift gdy expanding to new region (new buyer types) | High | Medium | Region-specific model checkpoints, gradual rollout per region, manual archetype curation by Krystianie dla pierwszych 90 dni nowego rynku |
| Confidence calibration drift po model update | Medium | Medium | Continuous calibration on rolling 7-day window (Platt scaling — patrz R.1), alerts gdy ECE (Expected Calibration Error) > 0.1, surface w K.3.4 |
| Federated learning protocol leakage (Y2 R.3) | Low | High | Secure aggregation (Bonawitz 2017), DP-FedAvg z ε ≤ 2 cumulative, third-party audit przed enterprise rollout |

---

## P. Roadmap & Priorities dla MVP (12 tygodni)

### P.0. Localhost-first stage and the FOLLOW-820 exit gate

> **Added 2026-09-13 in v4.12 (FOLLOW-1148; CEO decision #1, `docs/AUDIT-2026-09-13.md` §8).** The
> underlying ruling is the CEO's of 2026-08-21, which reaffirms the 2026-06-10 localhost-first ruling
> and ESC-052 option 2. This subsection DEFINES the stage and the gate. Their status is in
> §Snapshot.0, and the operative ticket order is in `backlog/QUEUE.md`. P.1–P.5 below are the
> original 12-week plan and are historical.

**Rule.** The final version of Adaptive Listings is tested to completion on localhost before any
production step. There is no staging; localhost is the pre-production substrate (§V.6.1). The only
exit is **FOLLOW-820**, a CEO go/no-go decision ticket (`backlog/FOLLOW_UPS.md`). Until it reads GO:

- the critical path is the work that feeds it: FOLLOW-817 + FOLLOW-818 + FOLLOW-560 →
  **FOLLOW-819** (the differentiator E2E on localhost, `tests/e2e/follow-819/`) → FOLLOW-815
  (consent) → **FOLLOW-820**;
- production-side work (canary hygiene, prod observability, prod-only measurements) queues behind
  that path; a P1 on the prod axis does not outrank a P1 on the localhost path;
- "works on localhost" means the real control plane (`/api/adapt` via `llm-gateway.ts`); a run with
  the `:9100` mock decision harness in the loop is not evidence.

**GO requires all four conditions, verified not asserted** (text of record: FOLLOW-820):

1. **FOLLOW-819 green, a technical condition as restated by ESC-073 (2026-08-25).** Clause 1: the
   chain runs on real data (SDK → ingest → decision → DOM → analytics), and the production path
   computes the lift from real substrate rows. Clause 2: the holdout mechanism separates the arms,
   so a control session receives no directives and an adapted session does. The condition does
   **not** require a positive `ctaLift`. The business proof is FOLLOW-1130, which gates
   outward-facing efficacy claims and does not gate GO. **Grading:** clause 1's adaptation is graded
   by `results[AC(1)].evidence.outcomes.adapted` in the harness artefact (the `results[]` entry with
   `ac: 'AC(1)'`, #894), read together with that entry's verdict. Clause 2 is graded by AC(7), which
   is not gradeable on its own until FOLLOW-1196 lands. Runs are cited by recorded `source`, never by
   tally. Per CEO decision #2, the graded run must stand on tamper-evident measurement (§E.3.4).
2. **FOLLOW-815 shipped** (the consent bundle). The SDK goes on no page whose consent layer is
   defective (§H.8).
3. **FOLLOW-817 deployed to the prod Modal environment**, with `MODAL_CHAT_NLP_URL` set in the prod
   ingest Worker and a traffic proof (a `chat_intent` shadow key populated end to end).
4. **FOLLOW-450's prod operator leg flipped** (`FEEDBACK_ENDPOINT_ENABLED=true` in Doppler `prd`), with
   a pasted real weight delta.

**On GO:** execute ESC-020's required action (FOLLOW-553 Wave 0 step 6). FOLLOW-560 / FOLLOW-565 /
FOLLOW-212 then become dependency-eligible. A GO licenses a production deploy. It licenses no
statement about whether adaptation sells (FOLLOW-1130).

### P.1. Co budujemy (MVP scope)

**Tygodnie 1–2 — Foundation:**
- Monorepo Turborepo, pnpm workspace
- @estalara/sdk skeleton (Preact + Shadow DOM, builds & test harness)
- Cloudflare Workers ingest endpoint (events → Redpanda → ClickHouse)
- Supabase Postgres schema + RLS policies
- Auth: tenant signup, API key generation
- Sentry + OTel basic instrumentation
- **🆕 Auto-Detection Service skeleton** (Modal function, Puppeteer setup)
- **🆕 15 platform templates** (Idealista, Rightmove, Otodom, Zillow, Bayut + top 10 WordPress themes)

**Tygodnie 3–4 — Tier 1 Observer + Magic Link Onboarding:**
- SDK Tier 1 widget (sidebar overlay, intent display, basic chat anchor)
- Event taxonomy v1 (top 30 event types)
- Behavioral fingerprinting (Mode A — session only)
- Per-tenant config dashboard (Next.js)
- Real-time intent vector update (Redis cache)
- **🆕 Magic Link onboarding flow** (paste URL → AI Vision detect → script tag w 90s)
- **🆕 Schema discovery pipeline** (L1-L5 layered detection per B.5)
- **🆕 Field mapping UI** (admin może review/edit auto-detected schema)

**Tygodnie 5–6 — Intent Engine:**
- Claude Haiku 4.5 integration via LiteLLM
- Intent ontology v1 (12 wymiarów, simplified)
- OpenAI embeddings integration + pgvector setup
- 50 seed archetypes (manually crafted from real estate domain knowledge — Krystian's PhD value here)
- Decision API endpoint (Edge Runtime)
- **🆕 NLP feature extraction** (parse "4 dormitorios, piscina" → structured)

**Tygodnie 7–8 — Tier 2 Augment + Adaptation:**
- SDK Tier 2 (declarative slots, DOM augmentation)
- Adaptation engine v1: headline rewrite (templates+slots), feature reorder, photo re-rank
- A/B holdout framework (10% default)
- Inquiry conversion tracking webhook
- **🆕 WordPress Plugin v1** (1-click install dla Houzez/Realtyna themes)
- **🆕 Auto-suggest Tier 2 upgrade** (gdy stats wskazują wysokie potential uplift)

**Tygodnie 9–10 — Compliance, Self-Healing & Polish:**
- DPIA document (master + tenant template)
- ROPA auto-export
- DSR endpoint + admin UI
- Privacy policy generator dla tenants
- White-label config
- Billing integration (Stripe + usage metering via Lago lub własny)
- **🆕 Continuous schema validation** (daily cron job per tenant)
- **🆕 Drift detection telemetry** (SDK reports broken selectors)
- **🆕 Auto-recovery flow** (B.6.3 — re-crawl + auto-update schema)

**Tygodnie 11–12 — Pilot launch prep:**
- Onboard 3 design partners (1 Marbella ES, 1 Warszawa PL, 1 London UK)
- Documentation + integration guides
- Loom demo videos
- Pricing page + signup flow
- **🆕 Onboarding success metrics dashboard** (tenant time-to-value tracking)
- **🆕 Test onboarding na 50 random sites** (validate >90% auto-detect success rate)

### P.2. Co NIE budujemy w MVP

- ❌ Tier 3 Native (full SDK component) — Q5–Q6
- ❌ UAE region deployment — Q5 (legal-heavy, czekamy na pierwszego UAE klienta)
- ❌ Federated learning — never (centralized DP wystarczy)
- ❌ Self-hosted Llama fine-tuning — Q7+, after $15M embed/mo crossover
- ❌ Mobile native SDKs (iOS/Android) — Q5+, MVP web-only
- ❌ Adaptive video / 3D tour — Q6+
- ❌ Voice / phone integration — Y2
- ❌ Multi-language SDK UI (poza EN/ES/PL) — wagi marketu

### P.3. Data flywheel ready od dnia 1

Nawet jeśli MVP używa adaptacji w 30% przypadków, **zbiera 100% sygnałów**:
- Pełen event taxonomy aktywny od dnia 1
- Anonimowe archetypes generowane co tydzień (cron job na Modal)
- ClickHouse z full event history → możemy retrospektywnie rebuild modeli gdy je dodamy
- Schema versioning: każdy event ma `schema_version`, więc można migrować dane forward

### P.4. Walidacja z 3–5 pilot klientami

Konkretne metryki sukcesu pilota:
1. **Inquiry rate uplift > 15%** (vs holdout group) w pierwszych 60 dniach
2. **Time-on-listing uplift > 20%** dla adapted vs holdout
3. **Pilot CSAT > 8/10** od tenant
4. **Latency SLA p95 <100ms** dla wszystkich Decision API calls
5. **Zero compliance incidents**

Pilot terms: free 90 dni → opcja Tier 2 paid ($1 999/mo) z 50% discount na Y1.

### P.5. Budżet i zespół MVP

**Zespół (12 tygodni):**
- Piotr Nawrocki (CEO) — sales, partnerships, fundraising (0.5 FTE on product)
- Rafał Palak PhD (CTO) — architecture, backend, ML/AI lead (1 FTE)
- Krystian Wojtkiewicz PhD (CPO) — product, real-estate domain ontology, design (1 FTE)
- **Senior Full-Stack Engineer #1** — SDK lead, frontend (kontraktor lub hire, 1 FTE)
- **Senior Backend/Data Engineer #2** — ingest, ClickHouse, ML serving (kontraktor lub hire, 1 FTE)

**Budżet 12 tygodni:**
| Pozycja | Koszt |
|---|---|
| Founders (3 × $5k/mo equity-heavy) | ~€36 000 |
| 2 senior engineers (€8–12k/mo full cost) | ~€60 000–72 000 |
| Legal (DPIA, MSA template, ToS, Privacy Policy x4 jurisdykcje) | €15 000 |
| Infra (Vercel, Supabase, Cloudflare, ClickHouse, Modal, Anthropic credits) | €10 000–15 000 |
| Design + branding (Fraunces + Inter system, dashboard UI) | €8 000 |
| Sales + travel dla 3 pilot klientów | €10 000 |
| Buffer / contingency 15% | €20 000 |
| **Total MVP budget** | **€160 000–200 000** |

Po MVP, do general launch (kolejne 6 miesięcy), realnie **€350 000–500 000 dodatkowo** dla zatrudnienia 2 nowych inżynierów + 1 sales/CSM + marketing.

---

## Q. Przykładowe User Stories & Data Flows

### Q.1. Scenariusz 1: Anonimowy buyer w Marbelli (pierwszy raz)

**T+0s** — Brytyjska kobieta (45) wchodzi na stronę agencji Marbella Realty (Tier 2 Augment). SDK ładuje się async (32KB, 80ms).
**T+1s** — `page.view`, `device.context` (UK locale, mobile Safari, view-port iPhone). Session ID = HMAC z fingerprint + tenant_secret + day_bucket.
**T+15s** — Widzi listing willi €1.2M, otwiera 4 zdjęcia, dwell na zdjęciu basenu 8s, scrolluje do features.
**T+45s** — Otwiera czat (Intercom integracja), pisze: *"Czy ta nieruchomość ma dostęp do pomocy domowej? Planujemy spędzać 4 miesiące rocznie w Hiszpanii."*

**System reaguje:**
- Worker Streams: chat message → Claude Haiku 4.5 prompt: extract intent ([NLP intent extraction template])
- Output structured JSON: `{purchase_purpose: 'second_home', cross_border: 'eu_intra → expat', urgency: 'exploratory', family_stage: 'established_family' (inferred from "we"), feature_priority: {staff_quarters: 0.9, lifestyle: 0.8}, geo_priority: 'beach', budget_band: 'comfortable'}`
- Match against archetypes: 0.91 similarity z `british_part_year_resident_costa_del_sol`
- Adaptation engine returns directives:
  - `headline.rewrite`: "4-Month Lifestyle Villa with Live-In Staff Quarters — Marbella" (zamiast generycznego "3-bed villa for sale")
  - `features.reorder`: [staff_quarters, pool, beach_proximity] na top
  - `photos.reorder`: pool deck first, master suite second, kitchen later
  - `chat.suggested_reply`: assistance with year-round property management info + tax implications for UK residents (pre-canned z RAG nad tenant FAQ)

**T+47s** — DOM mutated przez SDK Tier 2; user widzi smoothly zaktualizowany listing
**T+50s** — Agent chat replies (z naszym suggested reply jako draft), user kontynuuje conversation

### Q.2. Scenariusz 2: Ten sam buyer tydzień później (inna agencja, ten sam tenant network)

**Tydzień później** — wchodzi na stronę agencji w Walencji (też klienta Estalara, Tier 2). Default tryb = Mode A (Session) → fingerprint dla Walencja agency to **inny hash** (HMAC z innym tenant_secret), więc *cross-tenant identification jest technicznie niemożliwe*.

**ALE:** archetype już jest w globalnym embedding space. SDK na nowej sesji szybko zbiera 10–15 sygnałów (page.view + initial scroll + first listing photo opens) → intent vector ekstrahowany w <30s mapuje do `british_part_year_resident_costa_del_sol` archetype z confidence 0.78.

→ Adaptation już działa po ~30 sekundach na drugiej witrynie, mimo że buyer "anonimowy" z perspektywy nowego tenanta. **To jest data network effect w akcji** — drugi tenant od dnia 1 dostaje benefit z archetypów wytrenowanych na danych innych tenantów.

**Krytyczne:** ten sam ludzki buyer **nie jest re-identifikowany** — Estalara nie wie że to ta sama osoba. System jedynie szybko klasyfikuje *typ* buyera. Privacy preserved, value delivered.

### Q.3. Scenariusz 3: Idealista (Tier 3 Native) — pierwszy tydzień

**Setup:** Idealista enterprise contract, $150k/mo. Custom integration: Idealista wstawia `<EstalaraListing/>` component dla 100k properties (gradual rollout, A/B 10% traffic).

**Day 1–7 metrics widoczne w dashboardzie (Krystian-led design):**

```
ESTALARA DASHBOARD — IDEALISTA — Week 1

Traffic
├─ Tracked sessions: 4.2M
├─ Adapted impressions: 12.8M (avg 3 per session)
├─ Holdout group impressions: 1.4M (10%)
└─ p95 latency: 73ms (SLA 100ms ✓)

Buyer Archetypes (Top 10 of 87 detected in your traffic)
├─ british_costa_del_sol_part_year_resident   18.2% (770k)
├─ spanish_first_home_madrid_couple           14.7%
├─ french_riviera_barcelona_investor          9.1%
├─ german_retirement_canarias                 7.8%
├─ ... (7 more)

Conversion Lift (vs holdout)
├─ Photo gallery engagement:        +34% ↑↑↑
├─ Time-on-listing:                  +28% ↑↑↑
├─ Inquiry-started rate:             +19% ↑↑
├─ Inquiry-completed rate:           +14% ↑↑
└─ Tour-requested rate:              +22% ↑↑

Top-performing adaptations
1. Photo re-rank (master/pool first):    +41% photo engagement
2. Headline rewrite (lifestyle framing): +18% inquiry start
3. Feature reorder (staff/parking):      +12% engagement

Anomalies (auto-detected)
└─ archetype_id "swedish_lakeside_seeking_med_climate" 
   shows -8% conv vs holdout — auto-paused, investigation queued

Top 3 listings ID-ied as "high intent magnets":
└─ Detail in CSV export
```

Idealista CMO dostaje **case study material w 7 dni**, Idealista product team widzi że są 87 archetypów w ich traffic (czego nie wiedzieli wewnętrznie), Estalara CSM book quarterly review.

---

## R. Innovation Roadmap & Patent Strategy

**Filozofia:** Estalara nie konkuruje executionem (Mutiny i Dynamic Yield mają większe zespoły i budżety). Konkurujemy **vertical depth + technical innovation**. Sześć obszarów gdzie budujemy unique IP — każdy z nich to potencjalny patent + technical moat. Sekcja koresponduje z O.3 (analiza konkurencji) i M.2 (acquisition channels — innowacje są też marketing material).

### R.1. Innovation #1 — Real-Time Confidence Calibration & Graceful Degradation

**Problem:** Konkurenci działają binarnie — albo personalizują, albo nie. Jeśli model jest niepewny, wciąż serwują jakąś wersję (czasem gorszą niż nieadaptowaną).

**Innowacja:** Multi-level adaptation based on calibrated confidence intervals. Adaptation engine zwraca trzy confidence scores (archetype, directive, expected_uplift) i degraduje gracefully:

| Confidence | Akcja |
|---|---|
| > 0.85 | Full adaptation (headline rewrite, photo reorder, feature highlight, CTA personalization) |
| 0.6–0.85 | Partial adaptation (np. tylko reorder photos, no headline rewrite) |
| 0.4–0.6 | "Soft cues" (subtle re-rank features bez DOM mutation) |
| < 0.4 | No adaptation, serve original |

**Patent angle:** "Calibrated multi-level adaptation system based on confidence intervals in real-time personalization."

**Tech stack:** Quantile regression for uplift estimation, isotonic calibration (`sklearn.calibration`), conformal prediction (Vovk et al. 2005), Platt scaling for confidence calibration.

**Sprint mapping:** Sprint 7 (Adaptation engine) baseline, Sprint 8 (A/B holdout) calibration tuning.

**Defensibility:** 12–18 miesięcy dla konkurenta żeby zreplikować bez literatury z conformal prediction expertise.

### R.2. Innovation #2 — Causal A/B Framework (Beyond Vanilla CTR)

**Problem:** Standard A/B testing mierzy CTR uplift ale **nie izoluje czy to przez personalizację czy szczęście**. Holdout group też może mieć wysoki CTR (bo to po prostu dobrzy buyerzy).

**Innowacja:** Counterfactual estimation z meta-learners + Heterogeneous Treatment Effects (HTE):

- **T-Learner / X-Learner:** estymują individual treatment effect dla każdej sesji (co by się stało gdyby ten konkretny buyer dostał holdout vs treatment)
- **HTE (causal forests):** które archetypy MAJĄ uplift, a które nie
- **Auto-pause** dla archetypów bez causal effect — oszczędność LLM cost (prawdopodobnie 20–30%)

**Patent angle:** "Real-time CATE (Conditional Average Treatment Effect) estimation in live personalization pipelines for vertical SaaS."

**Tech stack:** EconML (Microsoft), DoWhy, causal forests (Wager & Athey 2018). Bayesian uplift models (PyMC) dla long-tail.

**Sprint mapping:** Sprint 8 (A/B framework) — extended z sekcji E.3.1.

**Defensibility:** Causal inference w produkcji to >95% B2B SaaS nie ma. 24+ miesięcy dla konkurenta bez ML PhD na zespole.

### R.3. Innovation #3 — Cross-Tenant Federated Archetype Learning

**Problem:** Master Design v1.1 (sekcja F.1) wybiera centralized aggregation. Pragmatyczne dziś, ale FL na 2–3 lat staje się compliance requirement w EU dla high-volume processors (po pierwszym wielkim incydencie data leak w cross-tenant scenario).

**Innowacja:** Hybrid roadmap:

- **Year 1:** centralized + DP (jak w F.1)
- **Year 2:** opcjonalny FL mode dla enterprise klientów (Idealista, Otodom) którzy nie chcą wysyłać żadnych danych poza swoją infrastrukturę
- **Year 3+:** "Federated Archetype Protocol" jako otwarty standard branżowy → potential industry leadership

**Patent angle:** "Real-estate-specific federated learning protocol with domain-aware aggregation rules and differential privacy guarantees."

**Tech stack:** Flower framework (Y2), secure aggregation (Bonawitz 2017), DP-FedAvg, własny protokół optymalizujący bandwidth dla archetype updates (małe wektory, więc unikamy gradient compression overhead).

**Sprint mapping:** Y2 Q3–Q4 (long-term roadmap, nie MVP).

**Defensibility:** FL infrastructure to 18–24 miesiące dla zespołu bez ML expertise. My budujemy bazę w Y1.

### R.4. Innovation #4 — Self-Healing Schema Detection (Predictive)

**Problem:** Master Design B.6 ma drift detection + auto-fix, ale to **reactive** (czeka aż SDK zgłosi błąd). Problem: tenant traci dane przez kilka godzin przed detekcją.

**Innowacja:** Predictive drift detection (już zaimplementowane jako B.5.4) — Estalara wie że strona klienta SIĘ ZMIENI zanim cokolwiek przestanie działać:

- Co tydzień zaplanowany re-crawl + porównanie DOM signature embedding
- Anomaly detection na tenant-level traffic patterns (nagły spadek event volume = możliwy drift)
- "Schema fingerprint embedding" — wektorowa reprezentacja struktury strony, similarity tracking
- Auto-fix triggered ZANIM SDK reportuje failure (proactive re-detection)

**Patent angle:** "Predictive web schema drift detection using embedding-based similarity tracking for SaaS personalization integrations."

**Tech stack:** Sentence transformers nad DOM hashes (BGE-M3), isolation forest dla anomaly detection (sklearn), DOM diffing (jsdiff), embedding distance threshold tuning.

**Sprint mapping:** Sprint 6 baseline (B.5.4 + przedłużenie B.6), Sprint 9 production hardening.

**Defensibility:** Niche problem, ale realnie wartościowy dla każdego B2B SaaS z DOM integration. Patent niezależny od domain real estate.

### R.5. Innovation #5 — Adaptive Trust Score (Self-Supervised Accuracy)

**Problem:** Klasyczny ML wymaga ground truth labels. Estalara w Mode A nie ma labels (anonimowi buyerzy).

**Innowacja:** Self-supervised accuracy estimation through convergence signals (zaimplementowane w D.5):

- **Behavioral consistency:** czy archetype prediction jest **stable across signals**?
- **Adaptation confirmation:** czy adaptacja powoduje **expected behavior**?
- **Bayesian update confidence** po każdym evencie

To jest serce systemu osiągania 90%+. Każdy event jest input do prediction JAK I evaluation poprzedniej prediction. Patrz D.5 dla pełnego mechanizmu.

**Patent angle:** "Self-supervised intent classification accuracy estimation in anonymous user contexts via behavioral consistency metrics."

**Tech stack:** Bayesian neural networks (Pyro/NumPyro), online learning, behavioral consistency metrics, sequential hypothesis testing (Wald 1945 SPRT).

**Sprint mapping:** Sprint 5 baseline, Sprint 7 production hardening (z D.5.6).

**Defensibility:** Wymaga rozumienia self-supervised learning + statystyki sekwencyjnej. 12–18 miesięcy dla konkurenta.

### R.6. Innovation #6 — Adaptive Directives Schema (Domain-Specific Language)

**Problem:** Master Design (E.1) opisuje adaptation directives jako "JSON" ale nie precyzuje strukturę. Każda implementacja ad-hoc.

**Innowacja:** **EAdL — Estalara Adaptation Language**:

- Deklaratywny DSL do opisywania jak modyfikować stronę real estate
- Versioned schema, backwards compatible
- Compiler kompiluje DSL do konkretnych DOM mutations + LLM prompts
- Tenants mogą pisać własne directives (Tier 3 power users)
- Cross-platform — działa na WordPress, Idealista, custom React

**Przykładowa składnia EAdL:**

```yaml
# Tenant-defined adaptation rule
when:
  archetype: british_part_year_resident_costa_del_sol
  confidence: > 0.7
do:
  - reorder_features:
      priority: [staff_quarters, pool, beach_proximity]
  - rewrite_headline:
      style: lifestyle_framing
      max_length: 80
  - add_section:
      type: tax_implications
      content_template: "uk_resident_spain_property"
unless:
  - listing.price > 5000000  # don't auto-adapt premium
  - tenant.disabled_directives.contains(rewrite_headline)
```

**Patent angle:** "Domain-specific declarative language for real-estate listing personalization with cross-platform compilation."

**Tech stack:** Tree-sitter parser, JSON Schema for validation, własny IR (intermediate representation), compiler do DOM mutations + LLM prompts.

**Sprint mapping:** Sprint 7 baseline (basic JSON), Y2 H1 full DSL z editor UI, Y2 H2 community marketplace dla EAdL recipes.

**Defensibility:** DSL adoption tworzy lock-in (tenants inwestują w pisanie reguł). Plus open-source release może stać się standardem branżowym (analogia: GraphQL od Facebooka).

### R.7. Patent filing strategy

**Q4 2026 (post-MVP):**
- **Filing #1:** Innovation R.5 (Adaptive Trust Score) — najszybszy do wykazania prior work + clear technical novelty
- **Filing #2:** Innovation R.4 (Predictive Schema Detection) — niche ale clear

**Q2 2027 (post-pilot validation):**
- **Filing #3:** Innovation R.1 (Confidence Calibration) — wymaga production data dla claims
- **Filing #4:** Innovation R.2 (Causal A/B) — wymaga statystycznej walidacji uplift methodology

**Q4 2027:**
- **Filing #5:** Innovation R.6 (EAdL) — po release jako open-source (defensive patent)
- **Filing #6 (optional):** Innovation R.3 (Federated protocol) — jeśli nie zdecydujemy się open-source'ować

**Jurysdykcje:** US (PCT priority), EU (EPC), UK, Polska. Skip UAE (różny system, niska wartość commercial dla patentowanego ML w tym rynku).

**Budget:** ~$15–25k per patent (USPTO + EPO + EU validation + counsel). Total program: ~$120–150k przez 24 miesiące. Część może być pokryta z Series A.

### R.8. Innovation governance

- **Quarterly innovation review** (Piotr + Rafał + Krystian, 90 min) — review progress, prioritize next quarter
- **Patent committee** (external patent attorney + Rafał) — reviews technical novelty before filing
- **Innovation showcase** — semi-annual blog posts / conference talks (Inman, ProptechOS) — buduje reputation
- **Open-source strategy** — niektóre innowacje (R.4, R.6) mogą być open-sourced post-patent dla industry leadership
- **Internal Ops dogfooding** — K.3.4 Global ML Health surface'uje innovation impact metrics (DQS po wprowadzeniu R.1, koszt LLM po R.2 auto-pause, etc.)

---

## S. Podsumowanie strategiczne i następne kroki

Estalara Adaptive Listings jest projektowany jako **vertically-specialized, embeddable-first, EU-first SaaS** (z region-pluggable architekturą, multi-region deployment planowany post-seed — patrz §A.3), który wykorzystuje **cztery** strategiczne dźwignie:

1. **Vertical depth** — real-estate-specific intent ontology (12 wymiarów, 50–500 archetypów) jest niemożliwa do skopiowania przez generic personalization (Mutiny, Dynamic Yield) bez 18+ miesięcy work.
2. **Embeddable-first DX** — SDK <40KB, 3 tiery integracji, zero-touch start (jeden script tag) to przewaga vs stand-alone competitors.
3. **Compliant-by-design data network effect** — DP-protected archetype space daje wartość każdemu nowemu klientowi od dnia 1, bez naruszania tenant isolation, GDPR czy ePrivacy.
4. **🆕 Zero-config onboarding** — Magic Link + AI Vision + 50+ platform templates + WordPress Plugin sprawiają że time-to-value to <5 min vs tygodnie u konkurencji. To dramatyczny win dla self-serve Tier 1/2 acquisition i obniża CAC.

**Następne kroki — gotowość do kodowania:**

✅ Architektura zatwierdzona: Cloudflare Workers + Next.js (Vercel) + Supabase + ClickHouse Cloud + Modal + Anthropic Claude (Haiku 4.5/Sonnet 4.6) + OpenAI embeddings + pgvector
✅ Repo struktura: monorepo Turborepo z `packages/sdk`, `packages/sdk-react`, `apps/ingest` (Cloudflare Worker), `apps/control-plane` (Next.js), `apps/intent-engine` (Modal Python), **`apps/auto-detect`** (Modal Python + Puppeteer), **`packages/wp-plugin`** (WordPress PHP), `infra/` (Terraform)
✅ Schema baz danych: Postgres (tenants, configs, billing, listings_metadata, **schema_mappings**, **detection_history**) z RLS + ClickHouse (events, sessions, **schema_drift_events**) + pgvector (per-tenant embeddings + global archetype space)
✅ Schema eventów: 30+ event types w wspólnym envelope, JSON Schema versioned
✅ DPIA + MSA + ToS + Privacy Policy template — legal sprint M1
✅ MVP backlog: Linear/Jira projekt z **~180 ticketami** (wzrost z 150 po dodaniu auto-onboarding scope) pokrywającymi 12-tygodniowy plan

**Rekomendowany sygnał dla zespołu:** rozpocznij sprint zerowy w poniedziałek — Rafał stawia monorepo + ingest worker + auto-detect service skeleton, Krystian finalizuje intent ontology v1 + 50 seed archetypów + reviewuje top 15 platform templates (jego PhD work value), Piotr zapisuje 3 design partner conversations + valida onboarding flow z nimi, Estalara wchodzi w execution mode.

---

*Dokument przygotowany na bazie analizy 35+ źródeł zewnętrznych (Anthropic, OpenAI, Cloudflare, EDPB, ICO, CNIL, UAE Data Office, Mutiny, Optimizely, Dynamic Yield, Segment, Drift/Intercom, ClickHouse, Supabase, Vercel, Cloudflare, Modal, RunPod, pgvector benchmarks, Pinecone, Cohere, BGE) — wszystkie konkretne stwierdzenia są oparte na cytowanych linkach. Stan prawny i pricingowy aktualny na 25 kwietnia 2026.*

*Wersja 1.1 (26 kwietnia 2026): rozszerzono o sekcje B.4–B.7 dotyczące auto-onboardingu i self-healing schema validation — odpowiedź na pytanie "jak zminimalizować friction onboarding klienta do <5 min".*
---

## T. Conversion Label Loop (Pętla etykiet konwersji)

> **Status:** PROPOSED (v3.9). Bridges the open measurement loop (§Snapshot.1, §E.3) to the Y2
> per-tenant fine-tuned classifier (§D.2, §D.5.7). **Logging must begin day one** — outcome labels
> cannot be reconstructed retroactively, and ClickHouse `events` carries only a 13-month TTL.

### T.1. Cel i uzasadnienie

The MVP deliberately does NOT fine-tune. The Y2 (Sprint 10–12) plan replaces the rule-based /
Thompson-bandit scorer with a **per-tenant fine-tuned classifier (Llama 3.1 8B + LoRA on Modal)**
(§D.5.7, §I.3). TALLRec-style LoRA fine-tuning needs `(prediction, real-world outcome)` training
pairs **per tenant**. Today those pairs are destroyed at write time: the prediction row in ClickHouse
`adaptation_decisions` records no model version and no feature snapshot, has no durable lead
identity, and the outcome arriving at `POST /api/adapt/feedback` is collapsed into Beta counters on
`ab_bandit_weights` (the per-event tuple is discarded). The Conversion Label Loop persists, **from
day one**, a durable training corpus: each scored lead's prediction (what the model thought, the
inputs it saw, the model version) and its later real-world outcome. This extends the §P.3 "data
flywheel od dnia 1" commitment from anonymous behavioral signals to labeled prediction↔outcome pairs.

### T.2. Model danych (EXTEND vs NEW)

**Prediction = EXTEND `adaptation_decisions` (ClickHouse).** Every scored lead already produces one
row (`infra/clickhouse/migrations/0003…0012`, written by `logDecisionAsync()` in
`apps/control-plane/src/app/api/adapt/route.ts`). A new ALTER migration `0013` adds the missing
label-fuel columns — no parallel prediction table:

| Field               | Status                                      | Notes                                                             |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `prediction_id`     | **REUSE** `adapt_decision_id` (added 0012)  | Stable per-decision UUID already minted + returned to SDK.        |
| `lead_id`           | **NEW** `String DEFAULT ''`                 | Durable pseudonymous lead key (T.6); distinct from `session_id`.  |
| `model_version`     | **NEW** `LowCardinality(String) DEFAULT ''` | e.g. `rulebased-bandit-v1` → later `lora-tenant-{id}-v3`.         |
| `score`             | **REUSE** `confidence` (+ `similarity`)     | Existing scalar prediction outputs.                               |
| `features_snapshot` | **NEW** `String DEFAULT ''` (JSON)          | PII-free serialized scorer inputs (intent vector, signals, tier). |
| `created_at`        | **REUSE** `ts`                              | —                                                                 |

(Also formalize the live-but-unmigrated `demo_override` column in the same migration so label rows
can exclude demo-driven decisions.)

**Outcome = NEW table `conversion_labels` (Postgres/Supabase, drizzle `packages/db`).** Mutable,
admin-managed, RLS-governed → Postgres, not append-only ClickHouse. One row per labeled outcome,
joined to the prediction by `prediction_id` (= `adapt_decision_id`):

| Column                      | Type                  | Notes                                                                                   |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `id`                        | uuid PK               |                                                                                         |
| `tenant_id`                 | uuid/text, NOT NULL   | RLS scope key (T.6).                                                                     |
| `prediction_id`             | text, NOT NULL        | = `adaptation_decisions.adapt_decision_id`. A label with no prediction is not fuel.     |
| `lead_id`                   | text                  | Mirrors the prediction's pseudonymous lead key.                                         |
| `outcome_class`             | enum, NOT NULL        | `viewing_booked \| offer_made \| contract_signed \| purchased \| lost \| no_response`.  |
| `outcome_raw`               | jsonb                 | Raw inbound payload (CRM webhook / feedback ping) before mapping.                       |
| `labeled_at`                | timestamptz, NOT NULL |                                                                                         |
| `label_source`              | enum, NOT NULL        | `system` (auto-mapped) \| `manual_admin` (set/changed in admin).                        |
| `confidence`                | real, nullable        | 1.0 for hard CRM facts; lower for inferred.                                             |
| `notes`                     | text, nullable        | Manual reclassification rationale.                                                      |
| `created_at` / `updated_at` | timestamptz           | `updated_at` bumps on reclassification.                                                 |

### T.3. Agregacja

Planned aggregate (ClickHouse materialized view + Postgres→ClickHouse outcome sync, or scheduled
join) over `(tenant_id, outcome_class, model_version, time_bucket)`: **conversion rate per class**;
**score-vs-actual calibration** (reliability curve per `model_version` — proves whether a fine-tuned
`lora-tenant-*` model is better-calibrated than `rulebased-bandit-v1`); before/after across model
rollouts. Extends the `apps/control-plane/src/app/api/pilot/cta-lift/route.ts` JOIN pattern with a
`model_version` dimension + the durable label join.

### T.4. Klasyfikacja (taksonomia)

The outcome enum is canonical. **Taxonomy lives in `packages/shared/src/schemas/conversion-label.ts`**
(new Zod enum, single source of truth, imported by control-plane routes + the `packages/db` schema).
Mapping: **system** — anonymous in-funnel events in ClickHouse `events` (`inquiry.completed`,
`tour.requested`, `cta.clicked`) map to shallow classes; deep classes (`offer_made`,
`contract_signed`, `purchased`, `lost`) arrive only via CRM ingest (T.7). **manual_admin** — admins
set/correct `outcome_class` (T.5); each change bumps `updated_at`, records `notes`, flips
`label_source` so the corpus can weight human-verified labels higher.

### T.5. admin.estalara.com (zarządzanie etykietami)

Extends the existing admin analytics/pilot dashboards (`apps/control-plane/src/app/dashboard/{analytics,pilot}`,
`app/admin/*`) — not a parallel app:

1. **Prediction + outcome table** — joined view (`adaptation_decisions ⋈ conversion_labels` on
   `prediction_id`); filters: tenant, `outcome_class`, date range, `model_version`.
2. **Manual outcome set/change** — writes `label_source=manual_admin` + `notes`.
3. **Aggregate view** — conversion metrics + the score-vs-actual calibration chart (T.3).
4. **Label-set export** — per-tenant PII-free `(features_snapshot, model_version, score) →
   outcome_class` corpus (CSV/JSONL) as future LoRA fine-tuning fuel.

### T.6. Izolacja tenantów / GDPR

- **Sensitive & tenant-scoped.** `conversion_labels` carries **RLS** keyed on `tenant_id` (§J.1, §V.8),
  no exception; ClickHouse access stays tenant-scoped as today.
- **Per-tenant isolation / white-label.** The fine-tuned artifact is per-tenant (`lora-tenant-{id}-*`
  in `model_version`); a tenant's labels train only that tenant's adapter. No cross-tenant pooling
  without the federated governance of §F.3 / §R.3. DB residency in PL/EU (§A.3).
- **`lead_id` ↔ CRM boundary.** `lead_id` is a pseudonymous Estalara key, NOT CRM PII. Deep outcomes
  live in tenant CRMs with PII Estalara never ingests (already enforced: `inquiry.completed` strips
  PII by schema design). CRM ingest (T.7) resolves the CRM record to the Estalara `lead_id`
  tenant-side (or via a tenant-supplied opaque correlation token) so PII never crosses into Estalara
  stores. The label corpus stays PII-free.
- **DSR identifier-resolution model — ALL THREE verbs (FOLLOW-184 + FOLLOW-246, migration 0024):**
  Two identifier namespaces must both be covered by EVERY DSR verb (access, erase, portability):
  - `session_id` — Estalara anonymous fingerprint, used in `session_embeddings` and ClickHouse.
  - `lead_id` (CRM token) — opaque pseudonymous token the tenant CRM sends to `POST /api/crm/outcome`;
    stored in `conversion_labels.lead_id`. **This is a different namespace from `session_id`.**
  Each verb applies the same two-pass pattern to `conversion_labels`:
  - **Pass A:** `conversion_labels WHERE lead_id = session_id` — covers SDK feedback-ping labels.
  - **Pass B:** `conversion_labels WHERE lead_id = durable_lead_id` — covers CRM deep-outcome labels.
    Only runs when `dsr_verifications.durable_lead_id` is non-null/non-empty/!= session_id.
  Both passes gate on `lead_id <> ''` (FOLLOW-180/LG-2 guard). Results are union-merged and
  deduplicated by row `id`. Tenant admins MUST supply the `lead_id` field in `POST /api/dsr/initiate`
  for CRM-integrated subjects (DSR_ALERTING.md §3/§access/§portability).
  Erase (`dsr/erase/route.ts`): runs two DELETE passes in a single transaction (FOLLOW-184).
  Access (`dsr/access/route.ts`): returns both namespaces' rows in the 200 `conversion_labels` array
  (FOLLOW-246, Art. 15 completeness).
  Portability (`dsr/portability/route.ts`): exports both namespaces' rows in the downloadable JSON
  `conversion_labels` array (FOLLOW-246, Art. 20 completeness).
  See also FOLLOW-039 (ClickHouse erasure semantics, §H.1.1) and FOLLOW-186 (tenant compliance gate).
  **Known limitation (LG-2 / FOLLOW-246 AC5):** A supplied-but-wrong `durable_lead_id` produces a
  silent no-op — Pass B matches nothing, and the erase `crm_erasure_status` may report `complete`
  while CRM rows survive. The tenant-side token-correctness contract is documented in §T.6 above
  and the DPA clause (FOLLOW-186 onboarding gate). Operators must verify the opaque CRM token
  matches the value used in the `POST /api/crm/outcome` webhook.
- **Operator-dependency residual (FOLLOW-239 — RETRO-042 DG-2; renamed in FOLLOW-238 PR #237):**
  Pass B is operator-dependent — the admin must know and supply the opaque CRM token at initiation
  time. There is no automated `session_id → durable_lead_id` resolver. When `durable_lead_id` is
  omitted and the tenant has CRM-namespace rows, the erasure is flagged via Sentry warning (`tags.
  follow = 'FOLLOW-238'`), a ClickHouse audit entry (`action = 'crm_unverifiable'`), and the
  `crm_erasure_status: 'crm_tenant_unverifiable'` field in the 200 response — NOT silent. This is a
  tenant-capability warning (FOLLOW-238 AC1): the system cannot confirm whether the surviving rows
  belong to the erased subject; it only knows the tenant has CRM rows and no durable token was
  supplied. The operator procedure for re-running the erasure is documented in
  `docs/compliance/DSR_ALERTING.md §3`. This residual gates the CRM go-live checklist (FOLLOW-187).
  A future FOLLOW may automate resolution by persisting a `session_id ⋈ durable_lead_id` link at
  CRM-write time (path (a) of FOLLOW-239).
  *(Historical note: before FOLLOW-238 the wire value was `incomplete_no_durable_lead_id` and the
  audit action was `incomplete_erasure_crm_rows_detected`. Both were renamed in PR #237 for
  semantic accuracy — see DSR_ALERTING.md §2.)*

### T.7. Zgodność z architekturą (extend, do not duplicate)

| Concern               | Existing component                                                  | Action                                                                  |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Prediction logging    | `adaptation_decisions`; `logDecisionAsync()` (adapt/route.ts)       | **EXTEND** — add `lead_id`, `model_version`, `features_snapshot`.       |
| Prediction migrations | `infra/clickhouse/migrations/0003…0012`                             | **NEW** `0013_*` (+ formalize `demo_override`).                         |
| Outcome persistence   | `POST /api/adapt/feedback` (today only updates `ab_bandit_weights`) | **EXTEND** to also write a durable `conversion_labels` row.             |
| Outcome store         | Postgres/Supabase, `packages/db`                                    | **NEW** `conversion_labels` + RLS.                                      |
| Taxonomy              | `packages/shared/src/schemas`                                       | **NEW** `conversion-label.ts` Zod enum.                                 |
| CRM deep outcomes     | none today (CRMs not ingested by design)                            | **NEW** ingest path (tenant CRM webhook → control-plane, PII-stripped). |
| Aggregation           | `pilot/cta-lift/route.ts` (session_id JOIN)                         | **EXTEND** with `model_version` + durable label join.                   |
| Admin UI              | `dashboard/{analytics,pilot}`, `app/admin/*`                        | **EXTEND** with label table, reclassify, calibration, export.           |
| Fine-tune consumer    | Modal Python app (Y2, §D.2/§D.5.7)                                  | Consumes T.5 export. Out of scope for day-one logging.                  |

### T.8. Cross-references

§D.2 / §D.5.7 (fine-tune target), §E.3 (A/B learning loop), §F.3 / §R.3 (federated governance),
§P.3 (data flywheel day-one), §H.1.1 (erasure), §J.1 / §V.8 (RLS / tenant isolation), ADR-0010
(`neutral_reason` observability ties into T instrumentation). Task breakdown: FOLLOW-170…175
(`backlog/FOLLOW_UPS.md`), ordered T0 prediction-enrichment first.

---

## U. Agency Registration Flow & Master Admin Panel

> **Decyzje architektoniczne zatwierdzone przez Piotra Nawrockiego (CEO) — 5 maja 2026:**
> - U1: Rejestracja agencji = **approval-required** (nie self-serve)
> - U2: Płatności = **Stripe + Invoice** (Stripe dla kart, manual invoice dla enterprise)
> - U3: SDK generation flow = **public API key + gotowy `<script>` snippet** w back office
> - U4: Master admin auth = **RBAC** (superadmin / ops / readonly)
> - U5: Master admin lokalizacja = **`/admin/*` routes w `adaptive.estalara.com`** z middleware RBAC (nie osobny app)

---

### U.1. Dwupanelowa architektura dostępu

System ma dwa logicznie odrębne obszary dostępu w **jednej aplikacji** (`apps/control-plane`, domena `adaptive.estalara.com`):

```
adaptive.estalara.com
│
├── /dashboard/*          ← AGENCY PANEL (każda agencja widzi tylko swoje dane)
│   ├── /dashboard        Overview, analytics
│   ├── /dashboard/demo   Demo Mode toggle + settings
│   ├── /dashboard/sdk    SDK Integration + snippet generator
│   ├── /dashboard/billing Billing, plan, invoices
│   └── /dashboard/config  Configuration, archetypes
│
└── /admin/*              ← MASTER ADMIN PANEL (tylko role estalara:*)
    ├── /admin            Fleet overview — wszystkie agencje
    ├── /admin/tenants    Lista + zarządzanie agencjami
    ├── /admin/tenants/:id Szczegóły jednej agencji
    ├── /admin/registrations Pending approvals
    ├── /admin/demo-sessions Aktywne Demo Mode sessions
    ├── /admin/billing    Revenue dashboard (MRR, ARR, churn)
    └── /admin/alerts     Alerts center
```

**Middleware Next.js** (`apps/control-plane/src/middleware.ts`) blokuje `/admin/*`:
```typescript
// Tylko użytkownicy z JWT claim role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly'
// Redirect → /login dla agencji które trafią na /admin/*
// IP allowlist opcjonalnie dla dodatkowego bezpieczeństwa (Cloudflare WAF rule)
```

**Dlaczego jeden app, nie dwa:**
- `apps/control-plane` już istnieje z Next.js 15, Supabase Auth, Tailwind, shadcn/ui
- RBAC przez JWT claims wystarczy do separacji — nie ma potrzeby osobnego deploymentu
- Szybszy development w Sprint 3; można wyekstrahować do osobnego app post-Series A jeśli zajdzie potrzeba

---

### U.2. RBAC — Role i uprawnienia

#### U.2.1. Role agencji (tenant-scoped)

```typescript
type AgencyRole = 
  | 'agency:owner'    // Pełen dostęp do konta agencji, billing, team management
  | 'agency:admin'    // Konfiguracja, SDK, analytics — bez billing
  | 'agency:viewer'   // Read-only: analytics, archetypes
```

JWT claim dla agencji: `{ tenant_id: "uuid", role: "agency:owner" }`

#### U.2.2. Role Master Admin (Estalara staff)

```typescript
type EstalaraRole =
  | 'estalara:superadmin'  // Pełen dostęp: billing, konfiguracja systemu, user management
  | 'estalara:ops'         // Monitoring, support, impersonation, demo oversight
  | 'estalara:readonly'    // Tylko odczyt: analytics, fleet overview, audit logs
```

JWT claim dla staff: `{ estalara_staff: true, role: "estalara:superadmin" }`

**Przypisanie ról (decyzja Piotra):**
- `estalara:superadmin` — Piotr Nawrocki, Rafał Palak PhD
- `estalara:ops` — Customer Success, Senior Engineers
- `estalara:readonly` — Sales, Marketing, Auditors

#### U.2.3. Schema Supabase Auth

```typescript
// packages/db/src/schema/users.ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),               // Supabase Auth user ID
  email: text('email').notNull().unique(),
  
  // Dla agencji:
  tenant_id: uuid('tenant_id').references(() => tenants.id),
  agency_role: text('agency_role'),          // agency:owner | agency:admin | agency:viewer
  
  // Dla staff Estalara:
  estalara_staff: boolean('estalara_staff').default(false),
  estalara_role: text('estalara_role'),      // estalara:superadmin | estalara:ops | estalara:readonly
  
  created_at: timestamp('created_at').defaultNow(),
  last_login_at: timestamp('last_login_at'),
  mfa_enabled: boolean('mfa_enabled').default(false),  // Mandatory dla estalara_staff
});
```

---

### U.3. Agency Registration Flow (Approval-Required)

Rejestracja agencji jest **dwuetapowa**: agencja składa wniosek → Master Admin zatwierdza → konto aktywne.

#### U.3.1. Etap 1 — Wniosek agencji

**URL:** `adaptive.estalara.com/register`

**Formularz rejestracyjny:**
```
┌─────────────────────────────────────────────────────┐
│  Get started with Estalara Adaptive Listings        │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Agency name *          [Marbella Premium Realty  ] │
│  Website URL *          [https://marbella-prem... ] │
│  Your name *            [Carlos García            ] │
│  Work email *           [carlos@marbella-prem...  ] │
│  Phone (optional)       [+34 ...                  ] │
│  Country *              [Spain ▼                  ] │
│  Listings volume        [○ <100  ● 100–1000  ○ 1k+]│
│  How did you hear?      [Google ▼                  ] │
│                                                     │
│  [Create account →]                                 │
│                                                     │
│  Already have an account? [Log in]                  │
└─────────────────────────────────────────────────────┘
```

**Po kliknięciu "Create account":**
1. System tworzy rekord w tabeli `tenant_registrations` ze statusem `pending`
2. Agencja dostaje email: "Dziękujemy za rejestrację — rozpatrzymy wniosek w ciągu 24h"
3. Slack notification do `#estalara-registrations`: nowy wniosek z nazwą agencji, URL, kraj, volume
4. Master Admin widzi wniosek w `/admin/registrations`

#### U.3.2. Schema `tenant_registrations`

```typescript
// packages/db/src/schema/registrations.ts
export const tenantRegistrations = pgTable('tenant_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Dane z formularza
  agency_name: text('agency_name').notNull(),
  website_url: text('website_url').notNull(),
  contact_name: text('contact_name').notNull(),
  contact_email: text('contact_email').notNull(),
  contact_phone: text('contact_phone'),
  country: text('country').notNull(),
  listings_volume: text('listings_volume'),  // '<100' | '100-1000' | '1000+'
  referral_source: text('referral_source'),
  
  // Status approval
  status: text('status').notNull().default('pending'),
  // 'pending' | 'approved' | 'rejected' | 'needs_info'
  
  // Po approval
  tenant_id: uuid('tenant_id').references(() => tenants.id),  // Tworzony przy approval
  approved_by: uuid('approved_by').references(() => users.id),
  approved_at: timestamp('approved_at'),
  rejection_reason: text('rejection_reason'),
  
  // Metadata
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});
```

#### U.3.3. Etap 2 — Master Admin approval

**W `/admin/registrations`:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Pending Registrations (3)                                           │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ Marbella Premium Realty     Spain    100–1000    2h ago    [Review] │
│ Warsaw Luxury Homes         Poland   <100        5h ago    [Review] │
│ Dubai Properties LLC        UAE      1000+       1d ago    [Review] │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Widok `/admin/registrations/:id`:**
- Dane z formularza
- Auto-check: czy website_url jest dostępny, czy jest na nim system CMS (wykryte przez auto-detect)
- Przyciski: `[Approve]` `[Request more info]` `[Reject]`
- Przy Approve: wybór initial plan (Free / Observer / Augment / Native), opcjonalny trial period

**Po zatwierdzeniu:**
1. System tworzy rekord w tabeli `tenants` (aktywny tenant)
2. Tworzy konto użytkownika dla contact_email z rolą `agency:owner`
3. Agencja dostaje email z linkiem aktywacyjnym (set password + MFA setup)
4. Tenant pojawia się w Fleet Overview

#### U.3.4. Etap 3 — Pierwsze logowanie agencji

Po kliknięciu linku aktywacyjnego:
1. Agencja ustawia hasło + MFA (TOTP)
2. Przekierowanie do `adaptive.estalara.com/dashboard`
3. Onboarding wizard:
   - Krok 1: "Wklej URL swojej strony" → auto-detect schema (B.4 — Magic Link flow)
   - Krok 2: "Skopiuj SDK snippet" → `/dashboard/sdk`
   - Krok 3: "Wklej w `<head>` swojej strony"
4. System zaczyna nasłuchiwać na eventy z domeny agencji

---

### U.4. SDK Generation Flow

**URL:** `adaptive.estalara.com/dashboard/sdk`

```
┌─────────────────────────────────────────────────────────┐
│  SDK Integration                                        │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Your Public API Key                                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ est_live_marbella_abc123xyz                       │  │
│  │                                [Copy] [Rotate]   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Integration Snippet                                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ <!-- Estalara Adaptive Listings -->               │  │
│  │ <script                                           │  │
│  │   src="https://cdn.estalara.com/sdk/v1.js"       │  │
│  │   data-api-key="est_live_marbella_abc123xyz"      │  │
│  │   data-tier="observer"                            │  │
│  │   async>                                          │  │
│  │ </script>                                         │  │
│  │                                          [Copy]   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Add this to the <head> of every page on your site.    │
│                                                         │
│  SDK Status                                             │
│  ○ Not detected yet — paste the snippet and reload     │
│  ✓ marbella-premium.com — Active (last seen 2min ago)  │
│                                                         │
│  [Download WordPress Plugin]  [View documentation]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**SDK Status** jest aktualizowany przez ingest worker — gdy pierwsze eventy dotrą z domeny agencji, status zmienia się z "Not detected yet" na "Active".

---

### U.5. Master Admin Fleet View

**URL:** `adaptive.estalara.com/admin/tenants`

Kolumny tabeli Fleet Overview (rozszerzone o decyzje P1–P5):

| Kolumna | Źródło | Opis |
|---|---|---|
| Agency | `tenants.name` | Nazwa agencji |
| Status | `tenants.status` | `active` / `suspended` / `trial` |
| Plan | `tenants.plan` | Free / Observer / Augment / Native |
| SDK | `events` (ClickHouse) | `live` / `silent` / `not_installed` |
| **Demo Mode** | `demo_sessions` | `OFF` / `🟡 ON — mockup` / `🟠 ON — production` |
| Last seen | `events.ts` | Timestamp ostatniego eventu |
| MRR | `billing` | Miesięczny przychód |
| Registered | `tenants.created_at` | Data zatwierdzenia rejestracji |
| Actions | — | `[View]` `[Impersonate]` `[Suspend]` |

**Demo Mode kolumna — szczegóły:**
- `OFF` — Demo Mode nieaktywny
- `🟡 ON — mockup` — agencja ma aktywny Demo Mode na mock-up page (nie ma SDK na produkcji)
- `🟠 ON — production` — agencja ma aktywny Demo Mode na produkcyjnej domenie
- Kliknięcie → `/admin/demo-sessions` filtrowane po tenant

**Alert: Demo Mode active >7 days** — automatyczny alert w Alerts Center gdy tenant ma Demo Mode aktywny dłużej niż 7 dni. Interpretacja: agencja może mieć problem z wdrożeniem SDK na produkcji (utknęła na mocku). Akcja: Customer Success team kontaktuje się proaktywnie.

---

### U.6. Master Admin Demo Sessions View

**URL:** `adaptive.estalara.com/admin/demo-sessions`

Real-time widok wszystkich aktywnych Demo Mode sessions:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Active Demo Sessions (2)                                            │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ Marbella Premium   mockup      British Retiree   Active 14 min  [X] │
│ Warsaw Luxury      production  Polish Family     Active 3h 22m  [X] │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│ Demo Sessions — Last 30 days                         [Export CSV]   │
│                                                                     │
│ DATE        AGENCY              SCOPE       DURATION  PERSONAS      │
│ 2026-05-04  Dubai Properties    production  42 min    Gulf Investor  │
│ 2026-05-03  Marbella Premium    mockup      8 min     3 switches     │
│ ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Master Admin może:**
- Wymusić zakończenie Demo Session dla dowolnego tenanta (`[X]` → `POST /api/admin/demo-sessions/:id/revoke`)
- Eksportować historię demo sessions (CSV) do analizy sales effectiveness
- Filtrować po scope (mockup / production), dacie, agencji

---

### U.7. Billing & Subscriptions

#### U.7.1. Stripe + Invoice (decyzja P2)

**Stripe** obsługuje:
- Automatyczne cykliczne płatności (miesięczne / roczne) kartą kredytową
- Webhooks: `payment_succeeded`, `payment_failed`, `subscription.updated`, `subscription.canceled`
- Stripe Customer Portal dla agencji (self-serve zmiany planu, aktualizacja karty)

**Manual Invoice** obsługuje:
- Tier 3 Native i enterprise — płatność przelewem
- System generuje fakturę PDF (przez Stripe Invoice lub zewnętrzny system księgowy)
- Master Admin manualnie potwierdza wpłatę i aktywuje plan w `/admin/tenants/:id`

#### U.7.2. Subscription states

```typescript
type SubscriptionStatus = 
  | 'trial'           // 14-dniowy trial (opcjonalny przy approval)
  | 'active'          // Płacąca agencja
  | 'past_due'        // Płatność się nie powiodła, grace period 7 dni
  | 'suspended'       // Po grace period — SDK wyłączony, back office read-only
  | 'canceled'        // Konto anulowane — dane retencja 90 dni
```

#### U.7.3. Master Admin Revenue Dashboard (`/admin/billing`)

Dostępny tylko dla `estalara:superadmin`:
- MRR (Monthly Recurring Revenue) z trendem
- ARR (Annual Run Rate)
- Churn rate (ostatnie 30/90 dni)
- Cohort analysis (retencja po 1/3/6 miesiącach)
- Upcoming renewals i at-risk accounts (`past_due`)
- Export do CSV / integracja z zewnętrznym BI

---

### U.8. Impersonation (Support Tool)

Master Admin z rolą `estalara:ops` lub `estalara:superadmin` może zalogować się jako dowolna agencja:

**Flow:**
1. `/admin/tenants/:id` → przycisk `[Impersonate]`
2. System generuje krótkotrwały JWT (15 min) z `{ tenant_id, impersonated_by: admin_user_id }`
3. Admin widzi back office dokładnie tak jak agencja
4. Żółty banner: "⚠️ Impersonating Marbella Premium — [Exit impersonation]"
5. Wszystkie akcje wykonane podczas impersonation są logowane w `staff_audit_log` z `impersonated_by`

**Ograniczenia:**
- Impersonation nie pozwala na zmianę hasła / MFA agencji
- Billing actions podczas impersonation wymagają dodatkowego potwierdzenia (eskalacja do superadmin)
- Session timeout impersonation: 15 minut (nie extendable)

---

### U.9. Audit Log (staff)

Wszystkie akcje Master Admin są logowane w tabeli `staff_audit_log`:

```typescript
export const staffAuditLog = pgTable('staff_audit_log', {
  id: uuid('id').primaryKey(),
  admin_user_id: uuid('admin_user_id').notNull(),
  action: text('action').notNull(),
  // 'tenant.approved' | 'tenant.suspended' | 'demo.force_stopped' | 
  // 'impersonation.started' | 'subscription.changed' | ...
  target_tenant_id: uuid('target_tenant_id'),
  payload: jsonb('payload'),               // Szczegóły akcji
  ip_address: text('ip_address'),
  created_at: timestamp('created_at').defaultNow(),
});
// append-only, brak DELETE/UPDATE przez RLS
// retention: 7 lat (compliance requirement)
```

---

### U.10. Investor Quiz — opt-in self-declared intent feature (back-office side)

> **Cross-reference:** Pełna specyfikacja widget UX, mapping odpowiedzi do priors, i events tracking — patrz **Section E.4**. Ta podsekcja opisuje wyłącznie back-office (per-tenant toggle + analytics).

#### U.10.1. Per-tenant Quiz Toggle (`/dashboard/quiz`)

Każda agencja decyduje czy quiz inwestora jest aktywny na jej stronie. Domyślnie: **OFF** (agencja musi explicit włączyć).

```
┌─────────────────────────────────────────────────────────────────┐
│ 🎯 Investor Intent Quiz                                         │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ Help your buyers find their match faster with 2 quick questions │
│ Show a sticky widget asking purpose (personal/investment) and   │
│ horizon (≤3 months / >1 year). Answers boost personalization    │
│ accuracy from the very first listing view.                      │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ Quiz status                              [  OFF  ●  ]   │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
│ ── Display options ─────────────────────────────────────        │
│ ☑ Sticky widget (always visible, bottom-right corner)           │
│ ☑ Trigger prompt after 3 listings viewed                        │
│ ☐ Show on listing detail pages only (hide on home/search)       │
│                                                                 │
│ ── Localization ────────────────────────────────────────        │
│ Question language        [ English ▼ ]                          │
│                          (PL, ES, AR, FR, DE coming Sprint 7)   │
│                                                                 │
│ ── Brand styling ───────────────────────────────────────        │
│ Widget accent color      [ #2563EB ]  (inherits brand tokens)   │
│ Widget icon              [ 🎯 ▼ ]                                │
│                                                                 │
│ [Cancel]                                  [Save & Activate]     │
└─────────────────────────────────────────────────────────────────┘
```

**Konfiguracja zapisywana w `tenants.config.quiz`:**
```typescript
type QuizConfig = {
  enabled: boolean;
  display: {
    sticky_widget: boolean;
    trigger_after_n_listings: number | null;  // null = disabled
    show_on_detail_pages_only: boolean;
  };
  localization: {
    language: 'en' | 'pl' | 'es' | 'ar' | 'fr' | 'de';
  };
  styling: {
    accent_color: string;       // hex, inherits brand tokens default
    icon: string;               // emoji or icon ID
  };
  updated_by: string;            // user_id
  updated_at: Date;
};
```

#### U.10.2. Quiz Analytics Dashboard (`/dashboard/quiz/analytics`)

Agencja widzi statystyki skuteczności quizu w czasie rzeczywistym:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🎯 Quiz Analytics — Last 30 days                                │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│ │ Impressions  │ Started      │ Completed    │ Conversion+  │   │
│ │   12,847     │   3,206      │   2,439      │    +18.4%    │   │
│ │              │ 25.0% rate   │ 76.1% rate   │ vs no-quiz   │   │
│ └──────────────┴──────────────┴──────────────┴──────────────┘   │
│                                                                 │
│ ── Funnel ────────────────────────────────────────────────      │
│ Shown    ████████████████████████████████████████  12,847       │
│ Started  ██████████                                  3,206  25% │
│ Q1 done  █████████                                   2,890  90% │
│ Q2 done  ████████                                    2,439  84% │
│                                                                 │
│ ── Answer distribution ────────────────────────────────         │
│ Personal × Short (≤3mo):       ████████  31% (758)              │
│ Personal × Long  (>1yr):       █████     19% (462)              │
│ Investment × Short (≤3mo):     ███████   28% (683)              │
│ Investment × Long (>1yr):      ███████   22% (536)              │
│                                                                 │
│ ── Conversion lift by answer combination ─────────────          │
│ Personal × Short:    +24.1% inquiry rate vs control             │
│ Investment × Short:  +31.2% inquiry rate vs control             │
│ Personal × Long:     +12.8% inquiry rate vs control             │
│ Investment × Long:   +8.4% inquiry rate vs control              │
│                                                                 │
│ ── Quiz vs behavioral mismatch rate ──────────────────          │
│ 14.2% of completed quizzes had behavioral signals               │
│ contradicting answers within 5 minutes.                         │
│ Most common: "Personal" → behavioral indicates investment.      │
│                                                                 │
│ [Export CSV]  [Compare cohorts]  [View as graph]                │
└─────────────────────────────────────────────────────────────────┘
```

**Metryki wyliczane real-time z ClickHouse `events` table:**

| Metric | Definition | Source |
|---|---|---|
| **Impressions** | Count of `quiz.event` z `step='shown'` | events |
| **Started** | Count z `step='started'` | events |
| **Completed** | Count z `step='completed'` | events |
| **Completion rate** | Completed / Started | derived |
| **Conversion lift** | Inquiry rate quiz-completed vs no-quiz cohort | join with `inquiry.completed` |
| **Answer distribution** | Group by (purpose, horizon) | events |
| **Mismatch rate** | % sessions z `quiz_behavioral_mismatch=true` flag | events |

**Drill-down filters:**
- Date range (last 7 / 30 / 90 days, custom)
- Device type (desktop / mobile / tablet)
- Trigger source (sticky / prompt / manual)
- Listing category (residential / commercial / land)
- Geographic region (jeśli tenant ma multi-region listings)

**Export:** CSV download z agregowanymi statystykami (zero PII — tylko enum values + counts).

#### U.10.3. Master Admin oversight (Fleet View extension)

W `/admin/tenants` Fleet Overview dodajemy kolumnę:

| Column | Source | Values |
|---|---|---|
| **Quiz** | `tenants.config.quiz.enabled` | `OFF` / `🟢 ON — N% completion` |

Pozwala Master Adminowi szybko zidentyfikować:
- Tenants którzy mają quiz wyłączony mimo wysokiego SDK traffic (sales opportunity — "włącz quiz, +18% conversion")
- Tenants z bardzo niskim completion rate (<30%) — może źle skonfigurowany trigger lub brand styling

#### U.10.4. Sprint mapping (back-office quiz tickets)

Patrz Section E.4.8 dla pełnej listy quiz ticketów. Tickety wpływające na back-office:

- **TICKET-QUIZ-003** (Sprint 5): Per-tenant toggle `/dashboard/quiz` config page (U.10.1)
- **TICKET-QUIZ-004** (Sprint 5): Agency analytics dashboard `/dashboard/quiz/analytics` (U.10.2)
- **TICKET-QUIZ-007** (Sprint 6): Master Admin Fleet View column dla quiz status (U.10.3)

---

### U.11. Profile Mode (Identified Buyers) — POST-MVP feature, forward-compatibility only

> **Status:** **Deferred to post-MVP roadmap (Sprint 12+).** Ta podsekcja NIE definiuje ticketów do implementacji w Sprint 0-7. Definiuje wyłącznie **forward-compatibility constraints** dla bieżącej architektury — tak żebyśmy nie zablokowali tej funkcjonalności podczas budowania MVP.
>
> **Decyzja produktowa (Piotr Nawrocki, 5 maja 2026):**
> - Profile Mode jako **Tier-agnostic feature** — toggle dostępny dla wszystkich tierów po aktywacji przez Master Admin
> - **Globalna flaga "Profile Mode beta"** w `/admin/tenants/:id` — jednoklikowy toggle Master Admin
> - **Approval workflow ZEWNĘTRZNY** (Notion + email + DPA review) — proces nie zaszyty w systemie IT
> - **Wdrożenie:** dopiero po MVP retrospective (Sprint 12+), z pełnym kontekstem real customer needs

#### U.11.1. Co to jest Profile Mode

Domyślnie Estalara Adaptive Listings jest **anonymous-first**:
- Buyer nie zostawia śladu między sesjami
- Behavioral signals + opcjonalny quiz (E.4) tworzą session-scoped archetype
- Sesja kończy się — profile znika
- Cross-tenant aggregations (Sekcja F) używają tylko anonymized, k-anonymized, DP-protected data

**Profile Mode (opt-in per tenant po Master Admin approval)** dodaje warstwę **identified buyers**:
- Buyer wypełnia registration form (email, imię, telefon optional, preferences)
- Granular consent: contact (phone/email), behavior tracking, team sharing
- Profile zapisany **tylko per-tenant** (RLS scoped) — Idealista NIE WIDZI buyer profiles z Otodom
- Agencja może później do buyera zadzwonić z znajomością preferencji

**Co Profile Mode NIE zmienia:**
- Cross-tenant archetype aggregations (Sekcja F) NIGDY nie używają identified data
- Profile data NIGDY nie wychodzi poza tenant boundaries
- Anonymous mode pozostaje default — Profile Mode wymaga explicit buyer consent

#### U.11.2. Dlaczego post-MVP (uzasadnienie deferreal)

1. **YAGNI w MVP** — większość agencji w pilot phase będzie testować anonymous-first proposition. Profile Mode jest add-on dla power users
2. **Legal complexity** — wymaga custom DPA per tenant, fair-housing review, GDPR Art. 22 (automated decision-making) consent flow. To jest 2-4 tygodnie legal work per pierwszy customer — nie chcemy tego w Sprint 0-7
3. **Spec może się zmienić** — po 6 miesiącach real customer feedback wiemy więcej o tym **co konkretnie** agencje chcą zbierać (czy email + phone wystarczy, czy potrzebują budget range, family size, etc.)
4. **Cross-tenant intelligence path** — przed Profile Mode warto zbudować **Estalara Insights** (Sekcja U.13.5) jako standalone product. Insights używa wyłącznie aggregated anonymous data — zero legal risk

#### U.11.3. Forward-compatibility — co MUSI respektować obecna architektura

To jest **architectural checklist** dla każdego ticketu w Sprint 0-7. Każda decyzja powinna pass tych 6 testów:

**Test 1 — Tenant isolation strict from day 1**
- ✅ RLS na każdej tabeli z tenant_id (już designed w Sekcji J)
- ✅ Drizzle role separation `createTenantClient` vs `createAdminClient` (TICKET-FIX-004 ✅)
- ✅ ClickHouse tenant_id partition key (Sekcja A.4)
- ✅ Cross-tenant queries TYLKO przez admin client + audit log
- **Implication dla Profile Mode:** dodanie `agency_profiles` table w Sprint 12+ wymaga tylko nowych RLS policies, nie refactoring

**Test 2 — Encryption-ready column architecture**
- ✅ pgcrypto extension dostępny w Supabase (zero infra setup needed)
- ✅ Column-level encryption pattern documented w Sekcji V.8.1 (`users.mfa_backup_codes` używa już bcrypt)
- ✅ `DB_COLUMN_ENCRYPTION_KEY` w Doppler scope dla future use
- **Implication dla Profile Mode:** `agency_profiles.email`, `phone`, `full_name` będą encrypted columns od dnia 1 — bez migracji

**Test 3 — Consent tracking primitives**
- ⚠️ **Action item dla Sprint 2 TICKET-021:** dodać generic `consent_records` table (tenant_id, subject_id, consent_type, granted_at, revoked_at, ip_address, user_agent, tos_version)
- ✅ Już planowane dla cookie consent / behavioral tracking opt-in (Sekcja H)
- **Implication dla Profile Mode:** ta sama tabela obsłuży `consent_type='profile_creation'`, `consent_type='phone_contact'`, etc.

**Test 4 — Session ↔ identity bridge**
- ✅ Session model w Sekcji D.3 ma `session_id` (anonymous fingerprint hash)
- ⚠️ **Action item dla Sprint 4 SDK ticket:** SDK musi mieć optional `Estalara.identify(profile_id)` API stub — placeholder, nic nie robi w MVP, ale API exists
- **Implication dla Profile Mode:** w Sprint 12+ `identify()` zaczyna linkować session → profile. Brak stub'u w MVP = breaking change w SDK API later

**Test 5 — Anonymous-first global archetype training**
- ✅ Archetype Update Job (Sekcja F.2) już używa anonymized data tylko
- ✅ Differential privacy, k-anonymity ≥50, no tenant_id w training data
- ✅ Code path explicitly excludes any future identified data
- **Implication dla Profile Mode:** profile data NIGDY nie feed do global archetypes — ten constraint jest zapisany w F.2 documentation jako invariant

**Test 6 — Fair-housing linter ready**
- ✅ Już planowany w Sekcji E.3.2 (weighted objective: `brand_safety_score`)
- ✅ Sprint 8+ implementation
- **Implication dla Profile Mode:** linter musi być gotowy ZANIM Profile Mode aktywny u pierwszego customer — bez tego ryzyko Fair Housing Act violation

#### U.11.4. Co BĘDZIE w Sprint 12+ (placeholder spec)

Pełna specyfikacja będzie w **osobnym dokumencie** napisanym po Sprint 7 retrospective. Wstępny scope:

**Master Admin side (`/admin/tenants/:id`):**
- Toggle "Profile Mode beta" (default OFF)
- Wymaga external approval flow done (audit log captures who, when, DPA reference)
- Audit log entry przy każdej zmianie

**Agency side (`/dashboard/profile-mode`):**
- Konfiguracja registration form fields (email, name, phone, budget, location, etc.)
- Granular consent text editor (per-tenant brand voice)
- Privacy policy template auto-generator
- Lead export (CSV, JSON, CRM webhook)

**SDK side:**
- Registration form widget (Preact + Shadow DOM, sticky, dismissable)
- `Estalara.identify(profile_id)` API
- Session linking
- Profile-aware adaptation (Intent Engine używa profile preferences jako stronger prior niż quiz)

**Data architecture:**
- `agency_profiles` table (per-tenant, encrypted PII columns, RLS)
- `agency_profile_sessions` linking table
- `consent_records` extension dla profile consents
- Indexes dla agency analytics queries

**Compliance:**
- Custom DPA template (Estalara processor, agency controller)
- Fair-housing linter integration (E.3.2)
- GDPR Art. 22 explicit consent flow dla automated personalization
- Right to access/erasure self-service portal dla buyers

**Estimated scope:** 15-20 ticketów, 2-3 sprinty (Sprint 12-14).

#### U.11.5. Estalara Insights (parallel path, also post-MVP)

**Cross-tenant intelligence as standalone product** — zero legal risk because uses only aggregated anonymous data:

- "Top 10 conversion patterns dla luxury Spain coastal" reports
- "Buyer archetype trends Q1 2027" industry reports
- "Adaptation effectiveness benchmarks" by region/property type
- API access for banks, REITs, large brokerages

**Pricing:** $5k-50k/year per subscription (separate from Adaptive Listings).

**Why parallel to Profile Mode:** Insights NIE potrzebuje identified data, więc może iść first (Sprint 10+). Insights revenue stream sam w sobie justifies network effect inwestycji.

Pełna spec w **Year 2 strategic document** — out of scope dla Master Design v1.4.

#### U.11.6. Action items dla obecnych sprintów

Te punkty MUSZĄ być uwzględnione w MVP żeby Profile Mode było viable post-MVP bez breaking changes:

| Sprint | Ticket | Action item |
|---|---|---|
| Sprint 2 | TICKET-021 | Dodać generic `consent_records` table do schema (T3 forward-compat) |
| Sprint 4 | SDK ticket | Dodać `Estalara.identify()` stub do SDK API (no-op, but exported) |
| Sprint 8 | TICKET-FAIR-001 (new) | Fair-housing linter MVP — gate dla Profile Mode aktywacji |
| Documentation | Sekcja F.2 | Add invariant: "global archetype training NEVER uses identified data, even if Profile Mode active" |

Te 4 punkty to suma "kosztu" forward-compatibility w MVP. Każdy z nich jest <1 dnia pracy — łączny narzut <1 sprint, dystrybuowany. Akceptowalne.

#### U.11.7. Cross-references

- **Sekcja F (Data Network Effect):** Profile Mode RESPECTS F's anonymous-first architecture — identified data nigdy nie feed do global archetypes (invariant)
- **Sekcja H (Compliance):** Profile Mode wymaga custom DPA per tenant; Sekcja H już covers GDPR principles dla anonymous mode, future doc covers identified mode
- **Sekcja J (Multi-Tenancy):** RLS policies wystarczające dla `agency_profiles` extension — bez refactoringu
- **Sekcja V (Security):** column-level encryption już designed (V.8.1) — Profile Mode użyje istniejącego patternu
- **Sekcja E.3.2 (Multi-objective optimization):** `brand_safety_score` (fair-housing linter) MUST be live before first Profile Mode activation

---

### U.12. Sprint mapping

| Sprint | Ticket | Deliverable |
|---|---|---|
| Sprint 2 | TICKET-021 | Postgres schema — dodać `tenant_registrations`, `users` z rolami, `staff_audit_log`, **`consent_records`** (forward-compat dla Profile Mode U.11.6) |
| Sprint 3 | TICKET-ADM-001 | `/register` page + approval flow + Slack notification |
| Sprint 3 | TICKET-ADM-002 | `/admin/registrations` — pending approvals view |
| Sprint 3 | TICKET-ADM-003 | `/admin/tenants` — Fleet Overview z Demo Mode kolumną |
| Sprint 3 | TICKET-ADM-004 | `/admin/demo-sessions` — real-time demo oversight |
| Sprint 4 | TICKET-ADM-005 | `/dashboard/sdk` — SDK snippet generator + SDK Status |
| Sprint 4 | TICKET-ADM-006 | Stripe integration — subscriptions + webhooks |
| Sprint 4 | TICKET-SDK-IDENTIFY | SDK `Estalara.identify()` API stub (no-op, forward-compat dla Profile Mode U.11.6) |
| Sprint 5 | TICKET-ADM-007 | `/admin/billing` — Revenue Dashboard (superadmin only) |
| Sprint 5 | TICKET-ADM-008 | Impersonation tool |
| Sprint 5 | TICKET-QUIZ-003 | Per-tenant Quiz Toggle — `/dashboard/quiz` config page (U.10.1) |
| Sprint 5 | TICKET-QUIZ-004 | Quiz Analytics Dashboard — `/dashboard/quiz/analytics` (U.10.2) |
| Sprint 6 | TICKET-ADM-009 | Manual Invoice flow (Tier 3 enterprise) |
| Sprint 6 | TICKET-QUIZ-007 | Master Admin Fleet View — quiz status column (U.10.3) |
| Sprint 8 | TICKET-FAIR-001 | Fair-housing linter MVP (gate dla Profile Mode aktywacji, E.3.2 + U.11.6) |
| **Sprint 12+** | **PROF-001 do PROF-020** | **Profile Mode pełna implementacja — separate spec doc, post-MVP** |

---

### U.13. Cross-references

- **Sekcja E.4 (Investor Quiz Widget):** pełna specyfikacja widget UX, Bayesian prior mapping, events tracking, sprint mapping. U.10 opisuje wyłącznie back-office; E.4 jest source of truth dla logiki personalizacji
- **Sekcja D.5 (Detection Quality Score):** quiz completion rate i quiz-behavioral mismatch rate jako leading indicators DQS — feed do dashboard `/admin/data-quality`
- **Sekcja F (Data Network Effect):** Profile Mode (U.11) RESPECTS anonymous-first architecture — identified data nigdy nie feed do global archetypes (invariant zapisany w F.2)
- **Sekcja J (Multi-Tenancy):** `tenants` tabela i RLS policies — rozszerzone o `registration_id`, `approved_by`, `status`, `config.quiz` (per-tenant Quiz config), `profile_mode_enabled` (Master Admin gated boolean dla U.11)
- **Sekcja K (Internal Ops Panel):** Section U rozszerza i uszczegółowia Section K — U jest source of truth dla master admin design
- **Sekcja T (Demo Mode):** Demo Mode toggle dostępny po approval (U.3.3); Master Admin oversight Demo Mode opisany w U.5 i U.6
- **Sekcja V (Security):** column-level encryption pattern (V.8.1) reused dla `agency_profiles` w Sprint 12+
- **Sekcja O (Roadmap):** Sprint 2 TICKET-021 musi uwzględnić nowe tabele z U.2.3, U.3.2, oraz `consent_records` z U.11.6


---

## V. Security Architecture & Cybersecurity

> **Decyzja architektoniczna (Piotr Nawrocki, 5 maja 2026):** Estalara Adaptive Listings buduje fundament bezpieczeństwa od dnia 1 — nie jako "compliance check-box" ale jako warunek wejścia w segment enterprise (Idealista, Otodom, Rightmove). Każdy enterprise klient w Year 1 zażąda security questionnaire — musimy mieć na to gotową odpowiedź.

### V.1. Security philosophy & threat model

#### V.1.1. Trust boundaries

System ma **pięć warstw zaufania** — każda granica wymaga eksplicytnej walidacji:

```
┌─ Untrusted: public internet (buyers on agency websites) ─────────────┐
│                                                                       │
│  ┌─ Semi-trusted: SDK on third-party domain ──────────────────────┐  │
│  │  - Origin validated, HMAC-signed payloads, rate-limited        │  │
│  │  - No access to tenant secrets                                 │  │
│  │  - Cannot read tenant config                                   │  │
│  │                                                                 │  │
│  │  ┌─ Tenant-trusted: agency staff (adaptive.estalara.com) ──┐  │  │
│  │  │  - Authenticated via Supabase Auth + MFA                 │  │  │
│  │  │  - JWT scoped to single tenant_id                        │  │  │
│  │  │  - RLS enforces row-level isolation                      │  │  │
│  │  │                                                          │  │  │
│  │  │  ┌─ Estalara-trusted: staff (/admin/*) ──────────────┐   │  │  │
│  │  │  │  - RBAC: superadmin/ops/readonly                  │   │  │  │
│  │  │  │  - MFA mandatory + IP allowlist (post-MVP)        │   │  │  │
│  │  │  │  - All actions audit-logged                       │   │  │  │
│  │  │  │                                                    │   │  │  │
│  │  │  │  ┌─ Infra-trusted: backend service-role ─────┐    │   │  │  │
│  │  │  │  │  - Bypass RLS dla migracji/admin ops       │    │   │  │  │
│  │  │  │  │  - Never exposed to tenant API routes      │    │   │  │  │
│  │  │  │  └────────────────────────────────────────────┘    │   │  │  │
│  │  │  └────────────────────────────────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

#### V.1.2. STRIDE threat model

| Threat | Attack scenario | Mitigation |
|---|---|---|
| **Spoofing** | Atakujący podszywa się pod tenant API key | HMAC signing per request (V.4.2), origin validation, rate limit per tenant |
| **Tampering** | MITM modyfikuje event payload w tranzycie | TLS 1.3 mandatory, HMAC integrity check, idempotency keys (TICKET-019) |
| **Repudiation** | Tenant zaprzecza akcjom administracyjnym | `staff_audit_log` append-only, 7 lat retencji, `tenants_audit_log` per-tenant |
| **Information Disclosure** | Buyer A widzi dane buyera B (cross-session) | Session-scoped fingerprint hash z HMAC + tenant_secret + day_bucket; RLS na poziomie DB; no PII w events (TICKET-FIX-005) |
| **Denial of Service** | Bot pętla wysyła 1M eventów/min do Ingest | Rate limiting Durable Objects (TICKET-013), Cloudflare DDoS protection, per-tenant cost limits (V.10) |
| **Elevation of Privilege** | Tenant user uzyskuje master admin role | Separate JWT claims (`tenant_id` vs `estalara_staff`), middleware RBAC walidacja, MFA dla staff, sudo mode dla destruktywnych akcji |

#### V.1.3. Critical assets — co chronimy

| Asset | Why critical | Tier |
|---|---|---|
| **Buyer behavioral data** | GDPR/CCPA personal data; reputation risk on breach | T1 (najwyższy) |
| **Tenant API keys** | Bypass uwierzytelniania, cross-tenant impersonation | T1 |
| **Master admin credentials** | Full-fleet access | T1 |
| **Stripe webhook signing secret** | Fraudulent billing manipulation | T1 |
| **Tenant config (brand tokens, schemas)** | Reputation if defaced; competitive intel | T2 |
| **ML model weights** | Trade secret, competitive moat | T2 |
| **Audit logs** | Regulatory compliance, incident investigation | T2 |
| **Anonymized archetype embeddings** | Data network effect (DP-protected) | T3 |

---

### V.2. Authentication & Session Security

#### V.2.1. Password policy (Supabase Auth)

```typescript
// packages/db/src/auth/password-policy.ts
export const PASSWORD_POLICY = {
  min_length: 12,                          // NIST SP 800-63B current best practice
  max_length: 128,                         // prevent algorithmic DoS
  require_breach_check: true,              // HaveIBeenPwned k-anonymity API
  disallow_common_passwords: true,         // top 10k blacklist (zxcvbn dictionary)
  disallow_user_attributes_match: true,    // password ≠ email/name fragments
  history_count: 5,                        // last 5 passwords cannot be reused
  expiry_days: null,                       // NIST: no forced rotation (modern standard)
};
```

**HaveIBeenPwned integration:** SHA-1 prefix lookup (k-anonymity), nigdy nie wysyłamy pełnego hasha. Implementowane jako Supabase Auth hook lub middleware przy signup/password-change.

#### V.2.2. JWT & session management

| Claim | Wartość | Komentarz |
|---|---|---|
| `iss` | `https://adaptive.estalara.com` | Audience-scoped issuer |
| `aud` | tenant_id LUB `estalara:staff` | Single audience per token |
| `sub` | user_id (UUID) | Subject |
| `tenant_id` | UUID (dla agency users) | Used by RLS auth.jwt() |
| `agency_role` | `agency:owner | agency:admin | agency:viewer` | RBAC enforcement |
| `estalara_staff` | boolean | `true` only for staff |
| `estalara_role` | `estalara:superadmin | estalara:ops | estalara:readonly` | Staff RBAC |
| `mfa_verified` | boolean | True jeśli MFA passed w bieżącej sesji |
| `iat`, `exp`, `jti` | standard | jti dla revocation list |

**Session TTLs:**
- Access token: **15 min** (krótkie żeby ograniczyć blast radius przy kradzieży)
- Refresh token: **7 dni** dla agency users; **24h** dla `estalara:*` staff
- Idle timeout: **1h** dla `/admin/*` (per K.7), **8h** dla `/dashboard/*`
- Absolute session timeout: **8h** staff, **30 dni** agency

**Token revocation:** Supabase Auth supports JTI-based revocation list w Postgres. Dodajemy `revoked_tokens` tabelę z TTL = max(refresh_token TTL). Middleware sprawdza JTI przy każdym request do `/admin/*` i destruktywnych akcjach.

**Refresh token rotation:** Każde użycie refresh token wymienia go na nowy (one-time use). Kradzież wykryta → all-sessions invalidate.

#### V.2.3. Brute-force protection

- **Account lockout:** 5 nieudanych prób w 15 min → 30-min lockout, eskalacja do ops alert po 10 lockoutach z różnych IP w 1h (możliwy credential stuffing attack)
- **Cloudflare Turnstile** na `/login` i `/register` (invisible challenge dla legitimate users, hard challenge dla suspicious patterns)
- **Geographic anomaly detection:** Login z innego kraju niż last_login → wymaganie MFA + email notification ("New device login from {city, country}")
- **Failed login telemetry:** wszystkie wysyłane do `auth_events` table → aggregacja w Sentry + Slack `#estalara-security` alert dla anomalii

#### V.2.4. Multi-Factor Authentication (MFA)

| Persona | MFA wymagane | Method |
|---|---|---|
| `agency:viewer` | Optional (rekomendowane) | TOTP |
| `agency:admin` | **Mandatory** od MVP | TOTP (Google Authenticator, Authy, 1Password) |
| `agency:owner` | **Mandatory** od MVP — billing access | TOTP + backup codes |
| `estalara:readonly` | **Mandatory** | TOTP |
| `estalara:ops` | **Mandatory** | TOTP + WebAuthn (Sprint 9 hardening) |
| `estalara:superadmin` | **Mandatory** | TOTP + **WebAuthn hardware key** od Sprint 9 |

**Backup codes:** 10 jednorazowych kodów generowanych przy MFA setup, encrypted-at-rest w `users.mfa_backup_codes` (bcrypt-hashed).

#### V.2.5. Sudo mode dla destruktywnych operacji

Dla operacji wysokiego ryzyka — usunięcie konta agencji, force-suspend tenant, wyłączenie MFA dla staff member, zmiana super-admin permissions, master admin impersonation — wymagamy **re-authentication w ostatnich 5 minutach** (sudo mode timer):

```typescript
// apps/control-plane/src/middleware/sudo-mode.ts
export async function requireSudoMode(req: Request) {
  const lastAuth = await db.query.users.findFirst({
    where: eq(users.id, req.user.id),
    columns: { last_sudo_auth_at: true }
  });
  
  if (!lastAuth?.last_sudo_auth_at || 
      Date.now() - lastAuth.last_sudo_auth_at > 5 * 60 * 1000) {
    throw new HTTPError(403, 'sudo_mode_required', 
      'This action requires recent re-authentication. Please confirm your password.');
  }
}
```

#### V.2.6. Just-in-Time (JIT) elevated access

Dla `estalara:ops` impersonation tenant accountu (Section U.8) — wymagamy **JIT approval workflow**:

1. Ops klika "Impersonate Marbella Premium" → system tworzy `pending_impersonation` request
2. Drugi superadmin (Piotr lub Rafał) musi approve w `#estalara-security` Slack channel (lub w `/admin/jit-approvals`)
3. Po approval, ops dostaje 15-min impersonation token (single-use)
4. Wszystkie akcje podczas impersonation oznaczone w `staff_audit_log` z `impersonation_request_id`
5. Tenant dostaje email notification w ciągu 24h: "Estalara support team accessed your account on {date}. Reason: {reason}. If this was unexpected, contact security@estalara.com immediately."

**Compliance note:** JIT + tenant notification spełnia GDPR Art. 5(1)(a) "lawfulness, fairness, transparency" dla legitimate interest impersonation.

---

### V.3. API Security

#### V.3.1. Rate limiting strategy (multi-layered)

| Layer | Where | Limits | Enforcement |
|---|---|---|---|
| **L1: Cloudflare WAF** | Edge, before Workers | Generic DDoS, suspicious patterns | Auto-block IP |
| **L2: Per-tenant ingest** | Ingest Worker (Durable Objects, TICKET-013) | 1000 events/sec/tenant baseline; tier-scaled | 429 + retry-after |
| **L3: Per-IP for unauthenticated** | Control Plane middleware | 60 req/min per IP for `/login`, `/register` | 429 + Cloudflare Turnstile |
| **L4: Per-user for authenticated** | Control Plane middleware | 600 req/min per user_id (any endpoint) | 429 |
| **L5: Per-endpoint critical paths** | Control Plane middleware | `/api/admin/impersonate`: 10/hour; `/api/billing/*`: 30/min | 429 + Sentry alert |

**Implementation:** Upstash Redis dla L3-L5 (sliding window), Cloudflare Durable Objects dla L2 (już zaimplementowane).

#### V.3.2. Request signing (HMAC)

**Ingest endpoint** (już zaimplementowane w TICKET-012):
```
HMAC-SHA-256(secret_api_key, timestamp + ":" + body_hash)
```

**Webhook endpoints (Stripe, future integrations):**
- Stripe webhook secret (per environment) sprawdzane w middleware
- Replay protection: timestamp ± 5 min tolerance, nonce z body hash w Redis (TTL = 10 min)
- Signature header: `x-estalara-signature`, body hash: SHA-256

**Admin destructive actions:**
- HMAC signing wymagane dla: tenant suspend, billing changes, impersonation, force-stop demo
- Sygnowane przez session JWT + nonce → middleware weryfikuje przed wykonaniem
- Idempotency keys (TICKET-019) dla każdej destruktywnej akcji

**POST /api/adapt/feedback — bandit feedback endpoint (FOLLOW-051, shipped Sprint 10):**

`POST /api/adapt/feedback` mutates `ab_bandit_weights` directly (Thompson sampling Beta
parameters). Without request signing, any party knowing only that the endpoint exists can flood
`converted: false` for a `(tenant, archetype, variant)` triple and bias sampling against the
control arm (adversarial bandit poisoning).

Scheme: HMAC-SHA256 of the raw request body, keyed by the tenant's public API key.

```
// SDK (packages/sdk/src/core/adapt.ts):
const body = JSON.stringify({ session_id, tenant_id, archetype, variant, converted });
const sig  = HMAC-SHA256(config.apiKey, body);   // hex digest
fetch(feedbackUrl, {
  headers: {
    Authorization:        `Bearer ${config.apiKey}`,
    'X-Estalara-Signature': sig,
  },
  body,
});

// Server (apps/control-plane/src/app/api/adapt/feedback/route.ts):
const bearerToken = authHeader.slice(7);           // raw API key
const rawBody     = await req.text();
const expected    = HMAC-SHA256(bearerToken, rawBody);
assert constantTimeEqual(provided, expected);
```

Threat model:
- **Prevents:** external adversaries who do not know the tenant's API key from poisoning bandit
  weights. Cross-tenant poisoning is blocked: an attacker must know the specific tenant key to
  produce a valid signature for that tenant's `ab_bandit_weights` rows.
- **Does not prevent:** a malicious tenant manipulating their own weights — the `tenant_id` in
  the body is from the same scope as the key. This is an accepted risk (tenant_id already scoped;
  a tenant poisoning their own bandit merely degrades their own personalization).
- **Ops fallback:** when `ADAPT_API_KEY` env var is set, a matching Bearer token is accepted
  without HMAC verification. Used for integration tests and manual operations.

No timestamp / replay protection on this endpoint — the bandit update is idempotent
(replaying a `converted: true` just increments alpha again; at-most-ε impact given
Thompson sampling convergence). Replay protection would require Redis nonce storage and
adds latency to a fire-and-forget path; deferred to post-MVP if replay attacks observed.

#### V.3.3. Input validation

**Wszystkie inputs walidowane przez Zod schemas** (już praktykowane w `packages/shared`):
- Event envelope (TICKET-011) z PII blacklist (TICKET-FIX-005)
- API request bodies — każda route handler używa `.safeParse()` przed processingiem
- Path parameters — UUID format validation
- Query parameters — explicit schema, nie blank `z.string()`

**Output sanitization:**
- DOMPurify dla user-generated content w archetype names, listing titles
- Escape sequences w SQL queries — NIGDY raw SQL, zawsze parameterized przez Drizzle
- LLM output sanitization — prompts zwracane do user UI przepuszczane przez DOMPurify (XSS prevention)

#### V.3.4. CORS configuration

**Rewritten against HEAD (`main` `9c614f8c`) — FOLLOW-954.** The previous revision of this section
was wrong in every claim a 2026-08-13 audit (RETRO-267) checked: it cited a code file that does not
exist, a production origin that appears nowhere in the code, framed per-tenant enforcement as an
ingest-only property when the control plane gained it in #714, and asserted "wildcard never
allowed" against three sites where it is required or accepted. See the retired text preserved for
provenance at the bottom of this subsection; do not treat it as current.

**Three layers, not one.** A single browser request touches three independent CORS decisions in
this codebase, and conflating them is exactly how the retired text went stale: (1) the **preflight**
(`OPTIONS`), which cannot know the tenant and REFLECTS; (2) **authenticated enforcement**, which
runs on the actual request and is the layer that actually protects tenant data with a `403`; (3) the
**actual-response header**, a separate decision about whether the browser is allowed to *read* the
2xx response layer 2 already approved.

```typescript
// apps/control-plane/src/lib/origin-policy.ts:36-39 — the PLATFORM list, inherited only by the
// first-party tenant. There is NO `apps/control-plane/src/middleware/cors.ts` — that directory
// does not exist (`ls apps/control-plane/src/middleware/` → no such file or directory). The real
// files are `apps/control-plane/src/middleware.ts` (preflight + actual-response header, Next.js
// middleware) and `apps/control-plane/src/lib/origin-policy.ts` (precedence + first-party
// resolution, shared by both layers so they read ONE list — Rule AQ).
export const CORS_PROD_ORIGINS: readonly string[] = [
  'https://app.estalara.com',
  'https://admin.estalara.com',
];
```

**1. Preflight** (`sdkCorsPreflightResponse`, `middleware.ts:94-126`) — reflects the caller's
`Origin` unconditionally on every SDK-facing route (`SDK_CORS_PREFIXES = ['/api/adapt',
'/api/quiz/completion']`, `middleware.ts:69`), because `OPTIONS` carries no API key and the tenant
cannot be resolved at this layer. Grants nothing: a preflight authorizes no side effect.

**2. Authenticated enforcement, per-tenant, since #714 [FOLLOW-941].** `resolveApiKey`
(`apps/control-plane/src/lib/api-key-auth.ts:157-193`) calls `resolveOriginDecision`
(`apps/control-plane/src/lib/origin-policy.ts:114-237`) on the actual request and refuses a
disallowed origin with `403` before any write. Precedence (`origin-policy.ts:126-137`):

```
allowed = (api_keys.allowed_origins ?? []).length > 0
  ? api_keys.allowed_origins        // per-key override
  : tenants.allowed_origins         // NOT NULL DEFAULT [] — [] here means "not configured"
```

If neither is configured, the request falls through to the **first-party platform fallback**
(`CORS_PROD_ORIGINS` above) — but only when the resolved tenant is not a confirmed external one; a
confirmed external tenant with nothing configured gets `403 origin_policy_unconfigured` rather than
silently inheriting Estalara's own domains (the guard FOLLOW-658 added).

**What decides `isFirstParty` [FOLLOW-951].** `classifyFirstPartyTenant(tenantId)`
(`apps/control-plane/src/lib/brand-identity.ts:334-345`) reads `FIRST_PARTY_TENANT_ID` and returns a
**tri-state** — `'confirmed' | 'external' | 'unverified'` — never a boolean. The two branches that
consult it apply OPPOSITE defaults on `'unverified'`, deliberately (`origin-policy.ts:139-234`):
- **Grant branch** (an origin list IS configured, the origin isn't on it, but it IS a platform
  origin) — fail-**CLOSED**: `'unverified'` returns a distinct `403 first_party_unverified`
  (`origin-policy.ts:157-173`), not the ordinary `forbidden_origin` — granting Estalara's platform
  origins to an unprovable first party would repeat the FOLLOW-658 failure one layer up.
- **Unconfigured branch** (nothing configured at either level) — fail-**OPEN** on purpose
  (`origin-policy.ts:230-234`): `'unverified'` still gets the platform fallback, because prod runs
  exactly one tenant with `tenants.allowed_origins = []`, so this is the only thing standing between
  a drifted `FIRST_PARTY_TENANT_ID` and every live SDK request 403ing.

The live value of `FIRST_PARTY_TENANT_ID` and the prod `allowed_origins` configuration are
**measured, point-in-time facts, not architecture** — this document does not restate them. See
`docs/ops/MEASURED_PREMISES.md` (FOLLOW-952, PR #735, verified green, awaiting merge at the time of
this revision) for the current `[MP-NNN]` entry once that PR lands; the file was not present in this
working tree when this revision was written, so no specific tag is cited here — backfill it the
moment #735 merges rather than guessing the number.

**3. Actual-response header — reflect vs. platform-only, an INVARIANT, not a data structure
[FOLLOW-943/949/950].** As of this revision, two open PRs both change how layer 3 decides, and they
conflict with each other:
- **PR #734 (FOLLOW-949)** keeps the opt-**OUT** `isFullyOriginGated(pathname)` and makes it
  method-aware: `GET /api/adapt` becomes fully gated (and therefore reflects); `POST /api/adapt`
  stays excluded because it has a browser-reachable demo-JWT path that bypasses the gate.
- **PR #733 (FOLLOW-950)** replaces that function with an opt-**IN** `ORIGIN_REFLECTING_ROUTES`
  registry keyed by `(path, method)`, with no `/api/adapt` row at all — i.e. `/api/adapt` reflects
  nothing under #733 until a row is added.

Merge order, and whether the second PR is rebased to carry the other's intent, is an **unresolved
human decision** this document does not encode and this ticket did not resolve. What is stable
regardless of which shape lands is the invariant, not the mechanism:

> A route may reflect the caller's `Origin` on its actual (non-preflight) response only if every
> browser-reachable authentication path on that route runs `resolveOriginDecision` before returning
> success. "Browser-reachable" excludes server-side-only credentials — today, the `ADAPT_API_KEY`
> ops bearer, which Next.js never inlines to a browser (`NEXT_PUBLIC_*` only — framework-enforced,
> not prose-only). `/api/adapt` needs `(path, method)` granularity because its **POST** has a
> browser-reachable demo-JWT short-circuit that bypasses the gate (FOLLOW-943); no other currently
> CORS'd route has a comparable un-gated browser path (FOLLOW-949's per-route table).

Before trusting a line number for this layer, run
`grep -n "isFullyOriginGated\|ORIGIN_REFLECTING_ROUTES" apps/control-plane/src/middleware.ts` — this
paragraph goes stale the moment either PR merges, by design; the invariant above is what should
still hold and is what the next doc pass should re-verify against, not this prose.

**Wildcard axis — `is the response tenant-identified?`, not "never".** Three sites answer
`Access-Control-Allow-Origin: '*'` today, and a different half of that question makes each one
correct or merely-tolerated:
1. `/consent-text.json` (`apps/control-plane/next.config.mjs:54`) — byte-identical for every
   tenant, no credentials, no identifier of any kind (ADR-0021 §D3). `*` is **required**, not
   merely allowed: a reflected allow-list here would itself violate §D3 by making an
   identifier-free response vary by origin.
2. `GET /api/intent/config` (`apps/control-plane/src/app/api/intent/config/route.ts:55`) and
   `GET /api/quiz/public-config` (`apps/control-plane/src/app/api/quiz/public-config/route.ts:97`)
   — the body IS tenant-scoped (weight/quiz config), but both routes require the tenant's own
   Bearer API key via `resolveApiKey` — which also runs the origin gate — before returning it, so
   the wildcard alone does not let another origin read another tenant's data; only a page already
   holding that key could, from any origin. **Flagged, not fully endorsed:** FOLLOW-950 AC(3)
   treats "`*` safe only because upstream enforcement runs" as a combination the CORS registry
   should record explicitly rather than assume; today it is defended only by the auth check inside
   the route, with nothing that fails if that check is ever removed.

The retired claim — _"Wildcard NEVER allowed — the exact origin is echoed or nothing"_ — is falsified
by all three sites above and must not be read as current.

**Ingest endpoint (cdn.estalara.com SDK calls) — re-checked against HEAD, unchanged from the prior
revision:**

```
// PER-TENANT ENFORCEMENT (implemented 2026-07-25, FOLLOW-642 — supersedes the
// 2026-07-24 FOLLOW-622 de-scope now that external re-brand clients are onboarding):
// on every `POST /v1/events` the ingest Worker resolves the tenant from the api key
// and matches the browser `Origin` against that tenant's `allowed_origins`, returning
// HTTP 403 (before any Redpanda/ClickHouse side effect) on a mismatch. See
// `apps/ingest/src/origin-gate.ts` + `handlers/events.ts`.
//   - Data source: the ingest Worker has no Postgres binding, so it reads its tenant
//     projection from `KV_API_KEYS` (`ApiKeyRecord.allowed_origins`). NOT a hardcoded
//     env list.
//   - WRITE PATH (corrected 2026-07-26, FOLLOW-658 — this passage previously claimed the
//     value was "seeded at provisioning", describing automation that did not exist): NO
//     service writes `KV_API_KEYS`. The KV key is `api_key:<RAW key>` and the raw key is
//     never stored in Postgres, so the projection cannot be fully automatic. It is an
//     explicit operator step — `apps/control-plane/scripts/project-allowed-origins.mts`
//     reads `api_keys.allowed_origins ?? tenants.allowed_origins`, reconciles the key
//     against Postgres (SHA-256 → owning tenant), and writes the KV record
//     (`docs/runbooks/BRAND_PROVISIONING.md` §Step 6).
//   - Semantics: absent/null → inherit the env allow-list (Estalara's OWN domains);
//     `[]` → deny all cross-origin; `[...]` → allow exactly those origins. The
//     `z.string().url()` normalization bug is fixed by re-normalizing both stored values
//     and the request Origin to scheme+host[+port].
//   - TWO-STORE TRAP: Postgres `tenants.allowed_origins` is `NOT NULL DEFAULT []` where
//     `[]` means "not configured" — the OPPOSITE of KV `[]` = deny-all. A mechanical copy
//     blocks 100% of a brand's browser traffic; the script refuses the ambiguous empty
//     case instead of guessing.
//   - FAIL-LOUD (FOLLOW-658): `inherit` is only ever correct for the first-party tenant.
//     When the Worker's `FIRST_PARTY_TENANT_ID` is set, any OTHER tenant still on
//     `inherit` proves its KV record was never seeded and is refused 403
//     `origin_policy_unconfigured` (Sentry level error) instead of silently inheriting
//     Estalara's allow-list. Unset var = guard off (pre-FOLLOW-658 behavior), so a
//     forgotten value cannot black-hole first-party traffic.
//     ⚠️ CORRECTED 2026-08-12 (FOLLOW-965) — "(Sentry level error)" describes the CODE, not
//     production. The 403 is real and unaffected; the ALERT is not delivered anywhere. Both
//     capture sites of this class sit behind a DSN that is unset: `SENTRY_DSN_INGEST` for the
//     Worker (RETRO-266 / FOLLOW-937) and `SENTRY_DSN_CONTROL_PLANE` for the control plane —
//     absent from every Vercel environment, measured 2026-08-12. Read "raises a Sentry error"
//     throughout this document as "emits a producer whose channel is currently mute"; the
//     delivery status and the check commands live in `docs/runbooks/observability.md`
//     §Control-plane Sentry signals and `INGEST_WORKER_DEPLOY.md` §signal register.
//   - Preflight (OPTIONS) carries no api key (browsers strip custom headers), so it
//     reflects the requested origin and enforcement happens on the actual POST.
```

**Retired text (provenance only — DO NOT treat as current).** Before this revision, this subsection
opened with a code block citing a nonexistent `apps/control-plane/src/middleware/cors.ts`, a
hardcoded `ALLOWED_ORIGINS.production` list containing `'https://adaptive.estalara.com'` (a host
that appears nowhere in the code) and missing `'https://admin.estalara.com'` (the real staff host,
`CORS_PROD_ORIGINS`), and closed with _"Wildcard ('\*') NEVER allowed"_ and a note deferring sibling
propagation to FOLLOW-649. All three claims are corrected above. FOLLOW-649's premise — that this
section was correct and only siblings were stale — has inverted; it is CLOSED, with its one
surviving finding (a stale `adaptive.estalara.com` host at §V.1.1) folded into the older, broader,
still-open FOLLOW-154 rather than executed as originally written (see changelog v4.10).

**SDK CDN (cdn.estalara.com):**
- Public access (każda strona klienta może załadować SDK)
- CORS `Access-Control-Allow-Origin: *` ale TYLKO dla `/sdk/*.js` static assets
- Ingest endpoint validuje origin against the per-tenant `allowed_origins` (FOLLOW-642,
  data-driven from tenant config) — see the per-tenant enforcement note above

#### V.3.5. API key lifecycle

```typescript
// packages/db/src/schema/api_keys.ts
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  
  type: text('type').notNull(),                  // 'public' | 'secret'
  prefix: text('prefix').notNull(),              // 'est_live_' | 'est_test_' | 'est_secret_'
  hashed_key: text('hashed_key').notNull(),      // bcrypt or argon2id
  last_4: text('last_4').notNull(),              // dla wyświetlania w UI
  
  scopes: text('scopes').array().notNull(),      // ['read:events', 'write:adaptations']
  allowed_origins: text('allowed_origins').array(),
  
  created_by: uuid('created_by').references(() => users.id),
  created_at: timestamp('created_at').defaultNow(),
  expires_at: timestamp('expires_at'),           // optional TTL
  last_used_at: timestamp('last_used_at'),
  rotated_at: timestamp('rotated_at'),
  revoked_at: timestamp('revoked_at'),
  revoke_reason: text('revoke_reason'),
});
```

**1-click rotation flow:**
1. Agency owner klika "Rotate API Key" w `/dashboard/sdk`
2. System generuje new key, ustawia `rotated_at` na old key
3. Old key działa przez 24h grace period (`revoked_at = now + 24h`)
4. SDK na produkcyjnej stronie powinien w tym czasie zostać zaktualizowany
5. Po 24h old key zwraca 401, alerty Slack do ops

**Automatic detection of leaked keys:**
- GitGuardian / TruffleHog scanner monitoruje GitHub i pastebin sites
- Wykryty key automatycznie revoked + email do tenant + ops alert

#### V.3.6. Idempotency

Idempotency keys (TICKET-019) wymagane dla:
- POST `/v1/events` (ingest) — already implemented
- POST `/api/admin/tenants/:id/suspend`
- POST `/api/admin/demo-sessions/:id/revoke`
- POST `/api/billing/subscriptions` (Stripe sync)
- DELETE wszystkie destruktywne ops

Header: `Idempotency-Key: <uuid v4>`. Cached response w Redis TTL 24h. Ten sam key + różne body = 409 Conflict.

---

### V.4. OWASP Top 10 (2021) — coverage matrix

| OWASP # | Risk | Mitigation w Estalara |
|---|---|---|
| **A01:2021** Broken Access Control | RLS in Postgres (per-tenant), middleware RBAC, JWT claim validation, sudo mode dla destructive ops |
| **A02:2021** Cryptographic Failures | TLS 1.3 mandatory, HSTS preload (TICKET-FIX-003), Argon2id dla passwords, AES-256 at rest, Stripe-managed PCI tokens (no card storage) |
| **A03:2021** Injection | Parameterized queries via Drizzle (no raw SQL), Zod validation on all inputs, DOMPurify on output, escape user content w LLM prompts |
| **A04:2021** Insecure Design | Threat modeling (V.1.2), security review per epic, design partner security questionnaires |
| **A05:2021** Security Misconfiguration | secureHeaders middleware (TICKET-FIX-003), CSP for Control Plane (V.5), no default credentials, infrastructure-as-code (Terraform) |
| **A06:2021** Vulnerable Components | Dependabot, Renovate, `pnpm audit` w CI, `pip-audit` for Python, monthly security review (V.7.3) |
| **A07:2021** Authentication Failures | MFA mandatory dla staff, brute-force protection, password policy z HaveIBeenPwned check, session timeout, JIT elevated access |
| **A08:2021** Data Integrity Failures | Subresource Integrity (SRI) na CDN'owanym SDK, signed releases (SLSA provenance), HMAC integrity checks na requests |
| **A09:2021** Logging & Monitoring Failures | OTel distributed tracing (TICKET-FIX-001), `staff_audit_log` 7yr retention, Sentry, security events to Slack `#estalara-security` |
| **A10:2021** Server-Side Request Forgery (SSRF) | URL allowlist dla outbound requests (auto-detect Puppeteer service), DNS validation, no internal network access from public services |

---

### V.5. Web security headers (Control Plane)

#### V.5.1. Headers stack dla `adaptive.estalara.com`

```typescript
// apps/control-plane/src/middleware.ts
export const securityHeaders = {
  // Strict Transport Security — wymuś HTTPS na 2 lata, włącz preload
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  
  // Content Security Policy — restrykcyjne, no inline scripts
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'nonce-{NONCE}' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'", // Tailwind requires for now; migrate to CSS modules Sprint 6
    "img-src 'self' data: https://*.supabase.co https://*.estalara.com",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://api.stripe.com https://o4505.ingest.sentry.io",
    "frame-src https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",          // anti-clickjacking
    "block-all-mixed-content",
    "upgrade-insecure-requests",
  ].join('; '),
  
  // Anti-clickjacking
  'X-Frame-Options': 'DENY',
  
  // MIME-type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Permissions Policy (formerly Feature-Policy)
  'Permissions-Policy': [
    'camera=()', 'microphone=()', 'geolocation=()', 
    'payment=(self "https://js.stripe.com")',
    'usb=()', 'fullscreen=(self)', 'autoplay=()',
  ].join(', '),
  
  // Cross-Origin policies
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-site',
};
```

**Nonce strategy:** Każdy server-rendered response generuje cryptographic nonce, embedded w CSP `script-src` i w każdym `<script>` tagu. Brak `unsafe-inline`, brak `unsafe-eval`.

#### V.5.2. SDK CDN (cdn.estalara.com) headers

Inne headers (SDK ma być embeddable w cudze strony):

```typescript
{
  'Cache-Control': 'public, max-age=31536000, immutable',  // long cache dla versioned URLs
  'Cross-Origin-Resource-Policy': 'cross-origin',           // allow cross-origin embedding
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': null,  // brak CSP dla static assets
}
```

#### V.5.3. Subresource Integrity (SRI)

SDK loader generated dla każdego tenanta zawiera SRI hash:

```html
<script async 
        src="https://cdn.estalara.com/sdk/v1.2.3/estalara.min.js"
        integrity="sha384-{hash}"
        crossorigin="anonymous"
        data-tenant="est_live_marbella_abc123">
</script>
```

SDK Snippet Generator (`/dashboard/sdk`) automatycznie wstawia aktualny SRI hash. Build pipeline computuje hash przy każdej release.

---

### V.6. Secrets Management

#### V.6.1. Doppler — single source of truth

Wszystkie secrets w Doppler. Brak `.env` plików w repo (gitleaks w pre-commit hook).

⚠️ **CORRECTED 2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2 — localhost-first is official for the data plane).** This section previously read _"environments: `dev` / `staging` / `prod`"_. **There is no staging environment.** Doppler `stg.DATABASE_URL_ADMIN` was verified **byte-identical to `prd`** (same sha256 `ba5e3741 83a629df…` over the whole URL, same user/host/database on `aws-0-eu-west-3.pooler.supabase.com`), twice and independently. Live configs are **`dev`** (local development) and **`prd`** (production); **`stg` is retired** by FOLLOW-873 and must not be written to — a write to `stg` is a write to production. Nothing may continue to *appear* to provide isolation it does not provide.

**CI injection pattern (FOLLOW-040, 2026-05-24):**

GitHub Actions uses a repo-level secret `DOPPLER_TOKEN_DEV` (service token scoped to
`config=dev`). Workflows that need injected secrets install the Doppler CLI via
`dopplerhq/cli-action@v3` and wrap commands with `doppler run --`:

```yaml
- name: Install Doppler CLI
  uses: dopplerhq/cli-action@v3

- name: Run with secrets
  run: doppler run -- pnpm seed:archetypes
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN_DEV }}
```

Soft-degradation contract: if `DOPPLER_TOKEN_DEV` is absent (forked PR, external
contributor), the workflow logs a clear message and continues — it does not fail with a
cryptic error. The `doppler-verify` job in `ci.yml` is the canonical health check; it
passes green when the token is present and auth succeeds, and soft-skips when absent.

**Token scoping:**

| Token | Scope | Location |
|---|---|---|
| `DOPPLER_TOKEN_DEV` | project=estalara, config=dev | GitHub Actions repo secret |
| Production token | project=estalara, config=prod | Vercel environment variable ONLY — NOT in GitHub |

Production secrets never enter GitHub Actions.

⚠️ **CORRECTED 2026-08-07 (FOLLOW-878).** This paragraph previously read _"Staging deploys read
from `config=dev` (same token) because staging config mirrors dev for non-prod secrets."_ Both
halves are false: `db-migrate.yml:100` runs `doppler run --config stg` under a **separate**
`DOPPLER_TOKEN_STG` repo secret, and `stg` mirrors **`prd`**, not `dev` (ESC-052). The only
Worker "staging" deploy that exists — `deploy-staging.yml`, `workflow_dispatch`-only — is a
bundle/upload smoke that injects no Doppler secrets at all. See FOLLOW-873 for the retirement of
the `stg` config and the `migrate-staging` job.

**Secret categories i rotation policy:**

| Category | Examples | Rotation cadence | Rotation method |
|---|---|---|---|
| Database credentials | `DATABASE_URL`, `DATABASE_URL_ADMIN` | 90 dni | Supabase Dashboard → service role rotate |
| API keys (provider) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` | 180 dni LUB on suspected breach | Provider dashboard + Doppler update |
| JWT signing keys | `SUPABASE_JWT_SECRET` | 365 dni LUB on breach | Supabase Auth → JWT settings |
| HMAC tenant secrets | `tenants.hmac_secret` (per-tenant) | 1-click w dashboard, max 90 dni | UI w `/dashboard/sdk` → Rotate |
| Webhook signing secrets | `STRIPE_WEBHOOK_SECRET` | On breach only | Stripe dashboard regenerate |
| Internal service-to-service | OTel collector token, Sentry DSN | 365 dni | Doppler → all environments |

#### V.6.2. Secrets scanning

| Layer | Tool | When |
|---|---|---|
| Pre-commit | `gitleaks` (Lefthook hook) | Local dev, every commit |
| CI | `gitleaks` workflow | Every PR + merge to main |
| Supply chain | GitGuardian dla GitHub | 24/7 monitoring private repos |
| Production logs | Custom regex w Pino serializer | Real-time log scrubbing |
| Dependencies | `pnpm audit` + `pip-audit` | CI + weekly cron |

**Secret detected w git history:**
1. Trigger immediate rotation (Doppler + provider dashboard)
2. `git-filter-repo` removal z historii (force push)
3. Notify all developers do re-clone
4. Post-mortem: jak doszło, czy CI hook zadziałał

#### V.6.3. Environment isolation

```
┌──────────────────────────────────────────────────────────┐
│ dev — local development, hobby/test API keys             │
│   - Cloudflare Workers preview deployments               │
│   - Supabase dev project (separate from prod data)       │
│   - Anthropic dev API key (low rate limit)               │
├──────────────────────────────────────────────────────────┤
│ staging — RETIRED 2026-08-07 (ESC-052, CEO option 2).    │
│   NEVER EXISTED as an isolated environment:              │
│   - no Supabase staging project (stg == prd, byte-ident) │
│   - no staging ClickHouse (Doppler stg has no CLICKHOUSE_*)│
│   - ingest/decision `[env.staging]` Workers have no DNS  │
│     record and no KV/DO/queue bindings (upload smoke only)│
├──────────────────────────────────────────────────────────┤
│ prod — production, real customer data                    │
│   - Mandatory MFA dla developers z prod write access     │
│   - Audit log każdego prod-write access                  │
│   - 4-eyes principle dla destructive ops                 │
└──────────────────────────────────────────────────────────┘
```

⚠️ **WYCOFANE 2026-08-07 (FOLLOW-878 / ESC-052).** Ten akapit brzmiał: _"**Brak shared secrets między environments.** Brak access do prod z laptopów developerów (CLI tools czytają tylko z dev/staging)."_ **Oba zdania były nieprawdziwe.** `stg` i `prd` dzieliły **ten sam** `DATABASE_URL_ADMIN` (sha256 identyczny), więc "CLI tools czytają tylko z dev/staging" oznaczało w praktyce **odczyt produkcji**. Stan docelowy po ESC-052 (option 2): dwa configi — `dev` (lokalny) i `prd` (produkcja); brak shared secrets **między `dev` a `prd`** pozostaje wymogiem i jest jedynym rozdziałem, który realnie istnieje. Egzekucja: CI gate `scripts/check-no-staging-plane.sh` (FOLLOW-878) blokuje ponowne pojawienie się nowych odwołań do warstwy staging.

---

### V.7. Supply Chain Security

#### V.7.1. Dependency management

**TypeScript / Node:**
```json
// .github/dependabot.yml
{
  "version": 2,
  "updates": [
    {
      "package-ecosystem": "npm",
      "directory": "/",
      "schedule": { "interval": "weekly", "day": "monday" },
      "groups": {
        "security": { "patterns": ["*"], "applies-to": "security-updates" },
        "patch": { "update-types": ["patch"] },
        "minor": { "update-types": ["minor"] }
      },
      "open-pull-requests-limit": 5,
      "reviewers": ["Pnawrocki9"],
      "labels": ["dependencies"]
    },
    {
      "package-ecosystem": "github-actions",
      "directory": "/",
      "schedule": { "interval": "weekly" }
    }
  ]
}
```

**Python:** Renovate Bot z group strategy (security PRs auto-merged dla patch versions).

#### V.7.2. Software Bill of Materials (SBOM)

Generated for every release:
```yaml
# .github/workflows/sbom.yml
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    format: cyclonedx-json
    output-file: sbom-${{ github.sha }}.cdx.json
- name: Upload SBOM artifact
  uses: actions/upload-artifact@v4
  with:
    name: sbom
    path: sbom-*.cdx.json
    retention-days: 365
```

SBOM dla każdej Vercel/Cloudflare release zachowywana 1 rok dla compliance audits.

#### V.7.3. Container image scanning

Modal Functions używają container images. Scanowanie przed deployment:
```yaml
- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'estalara/auto-detect:${{ github.sha }}'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'  # fail build on high-severity findings
```

#### V.7.4. Signed releases & provenance

SLSA Level 3 provenance attestations dla:
- Cloudflare Workers production deploys
- Vercel production deploys
- Modal function image builds
- npm package publishes (`@estalara/sdk`, `@estalara/react`)

```yaml
# Use sigstore + cosign for signing
- name: Sign artifact
  uses: sigstore/cosign-installer@v3
- run: cosign sign-blob --bundle artifact.bundle artifact.tar.gz
```

#### V.7.5. Vendor risk assessment

Quarterly review:
- SOC 2 Type II reports — Anthropic, OpenAI, Stripe, Cloudflare, Vercel, Supabase, Sentry, Modal
- Sub-processor list — published na status.estalara.com (GDPR Art. 28 transparency)
- Changes in vendor terms — automated monitoring (Klaus.ai, Termly, lub manual quarterly)

---

### V.8. Database Security

#### V.8.1. Encryption

| Layer | Method | Key management |
|---|---|---|
| **At rest** (Postgres) | AES-256-GCM (Supabase native) | AWS KMS managed by Supabase |
| **At rest** (ClickHouse) | AES-256 disk encryption | ClickHouse Cloud managed |
| **At rest** (column-level) | pgcrypto dla `users.mfa_backup_codes`, `tenants.hmac_secret` | App-level, key w Doppler `DB_COLUMN_ENCRYPTION_KEY` |
| **In transit** | TLS 1.3 mandatory | Supabase + ClickHouse Cloud certs |
| **Tenant-tier 3 (enterprise)** | Customer-Managed Keys (CMK) opt-in Year 2 | AWS KMS w tenant's account, cross-account role |

#### V.8.2. Row Level Security (RLS) — testing

**TICKET-FIX-004 already separated `createTenantClient` (RLS enforced) vs `createAdminClient` (RLS bypass).** 

**Automated isolation tests w CI** (Sprint 2 enhancement do TICKET-021):

```typescript
// packages/db/src/__tests__/rls-isolation.test.ts
describe('RLS tenant isolation', () => {
  it('tenant A cannot SELECT rows owned by tenant B', async () => {
    const tenantA_db = createTenantClient(tenantA_jwt);
    const result = await tenantA_db.select().from(listings_metadata)
      .where(eq(listings_metadata.tenant_id, tenantB_uuid));
    expect(result).toHaveLength(0);  // RLS hides tenant B's rows
  });
  
  it('tenant A cannot INSERT row with tenant_id = B', async () => {
    const tenantA_db = createTenantClient(tenantA_jwt);
    await expect(
      tenantA_db.insert(listings_metadata).values({
        tenant_id: tenantB_uuid, /* ... */
      })
    ).rejects.toThrow(/policy|permission/i);
  });
  
  it('admin client bypasses RLS', async () => {
    const admin_db = createAdminClient();
    const result = await admin_db.select().from(listings_metadata);
    expect(result.length).toBeGreaterThan(0);  // sees everything
  });
});
```

#### V.8.3. Database audit logging

PostgreSQL `pgaudit` extension (Supabase): logs DDL, role changes, sensitive table access.

```sql
-- Enable pgaudit (Supabase Dashboard → Database → Extensions)
CREATE EXTENSION IF NOT EXISTS pgaudit;
ALTER SYSTEM SET pgaudit.log = 'ddl, role, write';
ALTER SYSTEM SET pgaudit.log_relation = on;
SELECT pg_reload_conf();
```

Audit logs streamed do ClickHouse `db_audit_log` tabela, 7-year retention dla compliance.

#### V.8.4. Connection pooling & prepared statements

- **PgBouncer (Supavisor)** — already w stack
- Transaction mode dla pooled connections (port 6543) — używane przez `createTenantClient`
- Session mode dla long-lived ops — używane przez `createAdminClient`
- **Statement timeout:** 30s dla tenant queries, 5min dla admin/migrations
- **Connection limits per tenant:** Max 100 concurrent connections per tenant API key (anti-noisy-neighbor)

#### V.8.5. Backup & restore

Patrz Section W.1 (Disaster Recovery) dla pełnych RPO/RTO targets. Skrótowo:
- Postgres: continuous WAL backup (PITR), 7-day retention dla MVP, 30-day dla enterprise tier
- ClickHouse: daily snapshots, 30-day retention
- Quarterly restore drill (W.1.5) — testowane w staging

---

### V.9. Frontend SDK Security

SDK wstrzykuje się w **cudze strony klientów** — security threats są asymetryczne (klient nie kontroluje co dzieje się na ich stronie).

#### V.9.1. Sandbox & isolation

- **Shadow DOM (open mode)** dla wszystkich UI elements (już zaplanowane w B.2)
- Brak dostępu do `window.parent.X` properties z host page (read-only przez `Estalara.identify()` API)
- `postMessage` z origin validation:
  ```typescript
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://cdn.estalara.com') return;
    // process message
  });
  ```

#### V.9.2. CSP-friendly distribution

SDK loader nie używa `eval`, `new Function()`, ani inline event handlers — zgodne z restrictive CSP klientów. Wymagany CSP klienta:
```
script-src cdn.estalara.com 'self' 'wasm-unsafe-eval'
connect-src ingest.estalara.com 'self'
```

Documented w SDK integration guide. Magic Link onboarding pomaga klientom auto-update CSP (przez WordPress plugin gdy applicable).

#### V.9.3. Prototype pollution protection

```typescript
// packages/sdk/src/utils/safe-merge.ts
export function safeMerge<T extends object>(target: T, source: object): T {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // safe merge logic
  }
  return target;
}
```

Wszystkie merge ops (config, brand tokens) używają `safeMerge`. Audit `Object.assign` calls w PR review.

#### V.9.4. Anti-clickjacking dla SDK widgets

- SDK widgets renderowane w Shadow DOM nie mogą być iframed — sprawdzamy `window.top !== window` i logujemy alert
- Brak click-jacking-vulnerable actions (np. "Confirm purchase") w SDK UI — wszystkie destructive flows na `adaptive.estalara.com`

#### V.9.5. Telemetry sanitization

SDK NIE WYSYŁA do ingest:
- Hashed/raw passwords (form fields type=password)
- Credit card data (PCI scope)
- Authorization headers, cookies (browser-blocked)
- URL fragments (#hash) zawierające `password`, `token`, `secret`, `api_key`
- Local storage / sessionStorage values

Już enforced przez TICKET-FIX-005 (PII blacklist) na poziomie Zod validation w ingest.

---

### V.10. Cost Controls & Abuse Prevention (Denial of Wallet)

**Zagrożenie:** Złośliwy lub buggy SDK wysyła pętlę 1M eventów/min → triggeruje Anthropic / OpenAI calls → bill $50k/dzień.

#### V.10.1. Per-tenant spending limits

```typescript
// packages/db/src/schema/billing_limits.ts
export const billingLimits = pgTable('billing_limits', {
  tenant_id: uuid('tenant_id').primaryKey(),
  
  // Hard caps (events budget per tier)
  max_events_per_day: integer('max_events_per_day').notNull(),
  max_llm_calls_per_day: integer('max_llm_calls_per_day').notNull(),
  max_llm_spend_usd_per_day: decimal('max_llm_spend_usd_per_day').notNull(),
  
  // Soft alerts (% of cap)
  alert_threshold_percent: integer('alert_threshold_percent').default(80),
  
  // Action when exceeded
  exceed_action: text('exceed_action').default('throttle'),  // 'throttle' | 'block' | 'alert_only'
});
```

**Per-tier defaults:**

| Tier | Events/day | LLM calls/day | LLM spend/day USD |
|---|---|---|---|
| Free | 5,000 | 0 | $0 |
| Observer | 200,000 | 1,000 | $5 |
| Augment | 1,000,000 | 10,000 | $50 |
| Native | unlimited (custom contract) | custom | custom |

#### V.10.2. Real-time anomaly detection

Cloudflare Worker z Durable Object per tenant tracks rolling 1-min event volume. **Sudden spike >10x baseline** = circuit breaker:
- Throttle events to baseline rate
- Slack alert do `#estalara-ops`
- Email do tenant owner: "Unusual traffic detected on your site. We've throttled to protect against abuse. [Review](link)"
- Anthropic/OpenAI calls SUSPENDED dla tego tenanta przez 1h cooldown

#### V.10.3. Circuit breaker dla zewnętrznych API

```python
# apps/llm-gateway/src/circuit_breaker.py
from circuitbreaker import circuit

@circuit(failure_threshold=5, recovery_timeout=60, expected_exception=AnthropicError)
async def call_claude(prompt: str) -> str:
    return await anthropic_client.messages.create(...)
```

Open circuit po 5 failures w 60s → fallback do simpler heuristic adaptation. Closed po 60s recovery.

#### V.10.4. Cost monitoring dashboard

`/admin/billing/spend` — real-time view:
- Total LLM spend per provider (Anthropic, OpenAI) z trendem 7-day
- Top 10 tenants by LLM spend
- Anomalies: tenants z >2σ deviation od ich baseline
- Forecast: projected month-end spend, alert jeśli >budget

---

### V.11. Security Testing & Validation

#### V.11.1. Test pyramid (security-specific)

| Layer | Tests | Frequency | Gate |
|---|---|---|---|
| **Unit** | Authorization logic, input validators, crypto helpers | CI per PR | Block merge on fail |
| **Integration** | RLS isolation (V.8.2), MFA flow, JWT validation | CI per PR | Block merge on fail |
| **E2E** | Full auth flows, impersonation, password reset | Nightly + per-PR | Warn on fail |
| **DAST (OWASP ZAP)** | Auth bypass, injection, XSS, CSRF on staging | Weekly cron | Slack alert on findings |
| **SAST (Semgrep)** | Static analysis dla insecure patterns | CI per PR | Warn on fail |
| **Dependency scanning** | `pnpm audit`, `pip-audit`, Trivy, GitGuardian | CI + 24/7 monitoring | Block on critical |
| **Penetration testing** | External pentest firm | Annually + post-major-release | Triage all findings |
| **Bug bounty** | HackerOne lub Intigriti | Continuous (post-Series A) | Triage SLA per severity |

#### V.11.2. Penetration testing schedule

- **Year 1 H2:** First external pentest (post-MVP, before first enterprise customer) — budget ~$15k, vendor: Cure53 or Bishop Fox
- **Year 2 H1:** Second pentest (after Series A) — budget ~$25k
- **Continuous:** Bug bounty program launched Q3 2026 — budget $5-50k/year

**Scope:** SDK injection vectors, SSO/auth flows, RLS isolation, admin panel, billing integration.

#### V.11.3. Security review process

Każdy PR z security implications wymaga:
- Code review przez senior engineer (Rafał lub designated security champion)
- Threat model update dla new features
- Security test cases w PR description
- For sensitive changes (auth, billing, RLS): 2-osobowy approval

---

### V.12. Compliance Certifications Roadmap

**Decyzja:** Inwestujemy w SOC 2 Type II w Year 1 jako blocker dla US enterprise klientów (Zillow, Realtor.com), ISO 27001 w Year 2 dla EU enterprise.

#### V.12.1. SOC 2 Type II — timeline

| Quarter | Milestone | Cost | Deliverable |
|---|---|---|---|
| **Q3 2026** | Engage Vanta lub Drata (compliance automation) | $15k/year | Continuous monitoring setup |
| **Q3 2026** | SOC 2 Type I audit (point-in-time) | $30k | Letter of attestation |
| **Q1-Q2 2027** | 6-month observation window | — | Evidence collection |
| **Q3 2027** | SOC 2 Type II audit | $60k | Final report |

**Trust Service Criteria:** Security (mandatory), Availability, Confidentiality. Skip Processing Integrity i Privacy dla MVP — możemy dodać Year 2.

#### V.12.2. ISO 27001 — Year 2

Po SOC 2 Type II, dodajemy ISO 27001 dla EU enterprise:
- Implement Information Security Management System (ISMS) — większość zarobu już zrobiona dla SOC 2
- Statement of Applicability (SoA) — Annex A controls
- External audit przez akredytowanego auditora (BSI, DNV, lub TÜV) — ~$40k
- Annual surveillance audit ($15k) + 3-year recertification ($25k)

#### V.12.3. Other certifications (deferred)

- **PCI DSS:** Nie obejmuje nas direct — Stripe Tokenization (PCI Level 1) handles card data. Zachowujemy PCI SAQ-A self-assessment annual.
- **HIPAA:** Brak applicability (real estate ≠ healthcare).
- **FedRAMP:** Skip dla MVP (US gov customers nie są target).

---

### V.13. Cyber Insurance

**Recommendation:** Cyber liability insurance od dnia 1 — wymóg wielu enterprise klientów (Idealista MSA explicitly requires).

| Coverage | Limit | Provider candidates |
|---|---|---|
| Data breach response (forensics, notifications, credit monitoring) | $5M | Coalition, At-Bay, Beazley |
| Business interruption | $2M | Same |
| Regulatory fines (GDPR, CCPA) | $5M | Cyber-specific extension |
| E&O / professional liability | $2M | Hiscox, Travelers |

**Premium estimate:** $8-15k/year dla startup at MVP stage (3-person team, no real customer data yet). Skaluje się z ARR.

**Decision required from Piotr:** zapewnij cyber insurance przed pierwszym enterprise customer signed.

---

### V.14. Bug Bounty Program (post-Series A)

Launch Q3 2026 (po pierwszych 10-20 paying customers):

```yaml
program:
  platform: HackerOne (preferowany — większy researcher pool)
  scope:
    - "*.estalara.com"
    - "cdn.estalara.com (SDK)"
    - "@estalara/sdk npm package"
  out_of_scope:
    - "*.estalara.app (tenant subdomains)"
    - "Third-party services (Stripe, Anthropic)"
    - "Social engineering, physical attacks"
  rewards:
    critical: $5000-$15000   # auth bypass, RCE, data leak
    high:     $1000-$5000    # privilege escalation, stored XSS
    medium:   $250-$1000     # CSRF, IDOR, info disclosure
    low:      $50-$250       # missing security headers, version disclosure
  triage_sla:
    initial_response: 24h
    triage_decision: 5 days
    resolution: 90 days for critical, 180 for high
```

Annual budget: $25-75k initially.

---

### V.15. Cross-references

- **Section H (Compliance)** — V uzupełnia o technical security; H pozostaje source of truth dla privacy regulations
- **Section J (Multi-tenancy)** — V.8 rozszerza J o explicit RLS testing strategy
- **Section K (Internal Ops)** — V.2.6 (sudo mode) i V.2.5 (JIT impersonation) rozszerzają K.7
- **Section O.1 (Technical risks)** — V.10 (Cost controls) mityguje "DoW attack" risk
- **Section U (Master Admin)** — V.2 i V.3 są implementacją security wymagań Section U
- **Section W (Operational Excellence)** — komplementarne; V to "what we secure", W to "how we operate it"


---

## W. Operational Excellence — DR, Monitoring, Deployment

> **Filozofia:** Section V opisuje *co* chronimy, Section W opisuje *jak operujemy*. To jest sekcja, którą będzie czytać każdy enterprise customer w due diligence — i każdy on-call engineer o 3 nad ranem.

### W.1. Disaster Recovery & Business Continuity

#### W.1.1. RPO/RTO targets per data store

| Data store | RPO (max data loss) | RTO (max downtime) | Strategy |
|---|---|---|---|
| **Postgres (Supabase)** | 5 min (PITR) | 1h | Continuous WAL → S3, hot standby w region paired |
| **ClickHouse Cloud** | 1h | 4h | Daily snapshots + replicated zones |
| **pgvector embeddings** | 24h | 4h | Daily logical backup do S3, regenerable z events |
| **Redpanda Kafka** | 24h | 2h | Multi-AZ replication, message retention 7 dni |
| **R2 / S3 storage** | 0 (eventually consistent) | 30 min | Cloudflare R2 native multi-region |
| **Cloudflare Workers code** | 0 | 5 min | Wrangler deploy z any region |
| **Vercel deployments** | 0 | 5 min | Git-based, instant rollback |

**Tier-specific SLAs:**
- Free / Observer: best-effort, 99.5% uptime
- Augment: 99.9% uptime, RTO 2h, RPO 30 min
- Native (enterprise): 99.95% uptime, RTO 1h, RPO 5 min, dedicated DR runbook

#### W.1.2. Backup strategy per data store

**Postgres (Supabase):**
- Continuous WAL backup (Point-in-Time Recovery — PITR)
- Daily full backup retained 7 dni (MVP), 30 dni (Augment+), 90 dni (Native)
- Weekly cross-region backup do AWS S3 (eu-west-1 ↔ eu-central-1)
- **Encryption at rest:** AES-256 (S3 SSE-KMS)

**ClickHouse Cloud:**
- Daily snapshots (ClickHouse Cloud native)
- Retention: 30 dni (default)
- Cross-region replication dla Native tier (Year 2 feature)

**pgvector:**
- Daily `pg_dump` logical backup
- Embeddings są regenerowane z source events (ClickHouse) jeśli backup fails

**Source code & infrastructure-as-code:**
- GitHub repo private (Pnawrocki9/Adaptive-Listings)
- Mirror do GitLab (passive backup) raz dziennie
- Terraform state w S3 z versioning + state lock w DynamoDB

#### W.1.3. Multi-region failover strategy

**Active-Active (default):**
- Cloudflare Workers automatycznie route do najbliższego POP
- Read replicas w paired regions: EU primary (Frankfurt) + EU read replica (Dublin)
- Write traffic w primary region only — failover wymaga manual promotion

**Failover triggers (W.1.4):**
- Region complete outage (>15 min)
- Data corruption detected w primary
- Compliance event (e.g., region-specific legal injunction)

**Failover playbook (manual, runbook w Notion):**
1. Confirm outage z Cloudflare/Supabase status pages
2. Promote read replica → primary (Supabase Dashboard or `pg_ctl promote`)
3. Update Doppler `DATABASE_URL` → new primary endpoint
4. Re-deploy apps z new env (Vercel/Cloudflare auto)
5. Monitor lag, validate writes succeed
6. Public communication via status.estalara.com

**Estimated failover time:** 30-60 min manual w MVP, target 5 min automated w Year 2.

#### W.1.4. Disaster scenarios & response

| Scenario | Likelihood | Impact | Response |
|---|---|---|---|
| Cloudflare global outage | Low (1-2/year) | High | Failover do Vercel Edge dla Ingest (architecture allows); SDK CDN fallback do AWS CloudFront |
| Supabase region down | Low (rare) | Critical | Promote read replica; document in runbook |
| Anthropic API outage | Medium (occasional) | Medium | LiteLLM router → OpenAI fallback (already configured); circuit breaker (V.10.3) |
| Stripe outage | Low | Medium | Queue billing events w Redpanda, replay when Stripe back; tenants don't see disruption |
| Data corruption (logical bug) | Low | Critical | PITR to before-corruption timestamp; communicate data window lost |
| Ransomware on developer laptop | Low | Medium | No prod credentials on laptops; MFA mandatory; can't escalate to prod |
| GitHub repo compromise | Very Low | Critical | Force-push protection, signed commits, immediate revoke + restore from backup mirror |
| Insider threat (rogue admin) | Very Low | Critical | Audit log review weekly; 4-eyes principle dla destructive ops; offboarding checklist |

#### W.1.5. Restore drill schedule

**Quarterly disaster recovery drill** (mandatory, calendar-blocked):
- Q1: Postgres PITR restore w staging — verify <1h RTO
- Q2: ClickHouse snapshot restore — verify queryable after restore
- Q3: Cross-region failover (full stack) — chaos engineering
- Q4: Tabletop exercise — simulated breach + comms drill

**Drill report:** posted in Notion, sent do board jako quarterly metric. Failed drill = blocker dla next sprint until issue resolved.

---

### W.2. Incident Response Plan

#### W.2.1. Severity levels

| Severity | Definition | Examples | Response time | Communication |
|---|---|---|---|---|
| **SEV-1** | Critical: data loss, security breach, complete outage | Master DB down, breach detected, zero ingest events 30+ min | 15 min | Status page red, all-hands Slack ping, customer email if >1h |
| **SEV-2** | Major: feature broken, partial outage, performance regression | Demo Mode broken, single region down, p99 latency >5s | 30 min | Status page yellow, engineering Slack |
| **SEV-3** | Minor: degraded UX, single tenant impact | Specific archetype detection failing, dashboard slow | 4h | Internal Slack only |
| **SEV-4** | Cosmetic: typos, minor UI issues | Misaligned button, 404 on edge case | Next sprint | None |

#### W.2.2. On-call rotation

**MVP (3-person team):**
- Rafał (CTO) — primary on-call dla wszystkich SEV-1/SEV-2 (24/7)
- Piotr (CEO) — secondary on-call (escalation only)
- Krystian (CPO) — domain expert escalation (ML/data quality issues)

**Post-Series A (target by Q4 2026):**
- 5+ engineers w rotation (1 week shifts)
- Primary + Secondary always on-call
- PagerDuty / Opsgenie integration

#### W.2.3. Incident workflow

```
1. DETECTION
   - Sentry alert / Grafana threshold / customer report / status check
   ↓
2. TRIAGE
   - On-call assesses severity (SEV-1/2/3/4)
   - Creates incident channel: #incident-{date}-{slug}
   - Updates status.estalara.com if SEV-1/2
   ↓
3. RESPONSE
   - Identify root cause (use OTel traces, logs)
   - Mitigate first (rollback, throttle, failover) — fix later
   - Document timeline w incident channel
   ↓
4. RESOLUTION
   - Validate mitigation (metrics return to baseline)
   - Update status page green
   - Send customer communication (if SEV-1)
   ↓
5. POST-MORTEM (within 5 business days)
   - Blameless review meeting (all engineers)
   - Document w Notion: timeline, root cause, contributing factors, action items
   - Public post-mortem dla SEV-1 (on blog) — builds trust
```

#### W.2.4. Post-mortem template

```markdown
# Post-mortem: <incident-name>

**Date of incident:** YYYY-MM-DD HH:MM UTC
**Severity:** SEV-1 / SEV-2 / SEV-3
**Duration:** <X> minutes
**Authors:** <on-call engineer>, <reviewer>

## Summary
<1-paragraph executive summary>

## Impact
- Affected services: ...
- Affected tenants: <X> tenants, <Y>% of total traffic
- Data loss: yes/no, scope
- Revenue impact: $<X>

## Timeline (UTC)
- HH:MM — Detection: <how was it detected>
- HH:MM — Triage: <severity declared>
- HH:MM — Mitigation: <what was done>
- HH:MM — Resolution: <validation>

## Root Cause
<technical analysis — what actually broke>

## Contributing Factors
1. ...
2. ...

## What went well
- ...

## What went poorly
- ...

## Action items (with owners + due dates)
| Action | Owner | Due | Priority |
|---|---|---|---|
| Add monitoring for X | @Rafal | Sprint+1 | High |
| Update runbook for Y | @Piotr | Sprint+2 | Med |

## Lessons learned
<reusable knowledge for the team>
```

#### W.2.5. Status page

`https://status.estalara.com` (Atlassian Statuspage lub Cachet self-hosted):
- Real-time component status (Ingest API, Control Plane, SDK CDN, Demo Mode, Auto-Detect)
- Incident history (last 90 days)
- Subscriber email/SMS notifications dla customers
- Uptime metrics per component (90-day rolling)

**Auto-update integration:**
- Sentry → Statuspage incident creation (SEV-1 only)
- Grafana → Statuspage component degradation (SEV-2)
- Manual: on-call updates dla SEV-1 communications

---

### W.3. SLO/SLI definitions

#### W.3.1. Service Level Objectives

| Service | SLI | SLO | Error budget (per 30 days) |
|---|---|---|---|
| **Ingest API** | Availability (HTTP 2xx/5xx ratio) | 99.95% | 21.6 min downtime |
| **Ingest API** | p99 latency | <100 ms | 1% requests can exceed |
| **Control Plane API** | Availability | 99.9% | 43.2 min downtime |
| **Decision API** | Availability | 99.9% | 43.2 min |
| **Decision API** | p99 latency | <200 ms | 1% can exceed |
| **SDK CDN** | Availability | 99.99% | 4.3 min downtime |
| **Auto-Detect Service** | Success rate | 95% | 5% can fail (graceful fallback) |
| **Demo Mode** | Availability | 99.5% | 3.6h downtime |

#### W.3.2. Error budget policy

**If SLO breached w 30-day window:**
- Engineering team **freezes new feature work** until SLO restored
- Post-mortem dla każdego event który "spalił" >25% budget
- Quarterly SLO review — adjust targets jeśli systematically unmet

**Grace period dla MVP:** First 90 dni post-launch, SLOs są aspirational (no freeze policy). Po stabilization, freeze policy active.

#### W.3.3. Synthetic monitoring

**Checkly (or Pingdom)** — 24/7 synthetic checks z 5 regionów:

```typescript
// Critical user journeys monitored every 1-5 min
const checks = [
  { name: 'ingest-healthz', url: 'https://ingest.estalara.com/healthz', interval: '1m' },
  { name: 'control-plane-login', flow: 'login-flow.spec.ts', interval: '5m' },
  { name: 'sdk-cdn-availability', url: 'https://cdn.estalara.com/sdk/v1.js', interval: '1m' },
  { name: 'demo-mode-end-to-end', flow: 'demo-flow.spec.ts', interval: '15m' },
  { name: 'auto-detect-pipeline', flow: 'auto-detect.spec.ts', interval: '1h' },
];
```

Failed check → Sentry alert → on-call notification.

---

### W.4. Observability Strategy

#### W.4.1. Three pillars

**Logs (Pino + Grafana Loki):**
- Structured JSON, ISO timestamps, request_id correlation
- Log levels: trace/debug/info/warn/error/fatal
- PII redaction w Pino serializer (TICKET-FIX-005 enforces na ingest layer)
- Retention: 30 dni hot, 1 rok cold storage (S3 Glacier)

**Metrics (OpenTelemetry + Grafana):**
- Pre-built dashboards: per-service (ingest, control-plane, intent-engine), per-tenant fleet, business KPIs
- Custom metrics: events/sec, LLM cost/hour, archetype detection accuracy
- Alert rules: PromQL-based, paged via Grafana OnCall

**Traces (OpenTelemetry):**
- Distributed tracing across SDK → Ingest → Kafka → Modal (TICKET-FIX-001 ✅)
- W3C Trace Context propagation
- Tail-based sampling: 100% errors, 10% successful traces, 1% latency outliers
- Backend: Grafana Tempo (cost-efficient) lub Honeycomb (Year 2 dla deeper analysis)

#### W.4.2. Critical dashboards

1. **Real-time Operations** — events/sec, error rate, p99 latency, alert count
2. **Per-tenant Health** — DQS, SDK status, archetype quality (per K.3.2)
3. **Business KPIs** — MRR, active tenants, conversions per tenant, top archetypes
4. **Cost Center** — daily LLM spend, infra costs, cost per tenant per visit
5. **Security Events** — failed logins, MFA failures, anomalous traffic, audit log activity

#### W.4.3. Distributed tracing — what to instrument

**Already instrumented (post TICKET-FIX-001):**
- ✅ SDK → Ingest Worker (auto via @microlabs/otel-cf-workers)
- ✅ Ingest → Redpanda (W3C traceparent in Kafka headers)
- ✅ Redpanda → Modal stream-consumer (extract + child span)

**Sprint 2-4 additions:**
- Control Plane API → Postgres (auto via Drizzle instrumentation)
- Modal → Anthropic / OpenAI (manual span around LLM calls)
- Modal → ClickHouse insert (batch metrics)
- Modal → pgvector queries (similarity search latency)

#### W.4.4. Log retention & PII redaction

```typescript
// packages/shared/src/observability/log-redactor.ts
const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,           // email
  /\b\d{3}-\d{2}-\d{4}\b/,                                  // SSN-like
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/,                            // credit card
  /\b\+?[1-9]\d{1,14}\b/,                                   // phone
];

export function redactPII(message: string): string {
  let redacted = message;
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}
```

Pino custom serializer applies redactPII na każdym log message. Tested w `packages/shared/__tests__/log-redactor.test.ts`.

---

### W.5. Deployment & Rollback

#### W.5.1. Deployment strategy per service

| Service | Strategy | Tool | Rollback time |
|---|---|---|---|
| **Cloudflare Workers (ingest)** | Atomic version swap | Wrangler | 30 sec (revert version) |
| **Vercel (control-plane)** | Atomic deployment | Vercel CLI | 30 sec (promote previous) |
| **Modal Functions** | Versioned deployment | Modal CLI | 1 min (deploy previous) |
| **Database migrations** | Forward-only, backwards-compatible | Drizzle Kit | Manual rollback only |
| **SDK CDN** | Versioned URLs (v1.2.3 immutable) | Wrangler R2 | Update SRI hash w generator |

#### W.5.2. Canary deployment dla critical services

**Ingest Worker** — najbardziej krytyczny, najbardziej traffic:
- Cloudflare Workers Routes z weighted routing
- 5% traffic → new version, 95% → stable
- Monitor 15 min: error rate, p99 latency, schema validation failures
- Auto-rollback jeśli regression >5% lub error rate >0.1%
- Po pass: 25% → 50% → 100% over 1h

**Decision API** (Sprint 5+):
- Same canary strategy, dodatkowo DQS comparison
- 24h canary period (longer due to ML quality variance)
- Auto-rollback jeśli DQS drops >2 percentage points (per O.6 mitigation)

#### W.5.3. Database migration strategy

**Always backwards-compatible:**
1. Add new column (NULL allowed)
2. Deploy code that writes to both old + new
3. Backfill old rows
4. Deploy code that reads from new
5. Drop old column (separate migration, separate deploy)

**Never:**
- Drop columns w same migration as code change
- Rename columns (always: add new, migrate, drop old)
- Change column types in-place (always: new column, migrate, drop)

**Migration testing:**
- Each migration tested w staging z prod-size data sample
- Migration timing tracked — alerts dla slow migrations (>5 min)
- Quarterly: full migration replay test on backup

#### W.5.4. Rollback playbook

**Immediate rollback (one command):**
```bash
# Workers
wrangler deployments list
wrangler rollback <deployment-id>

# Vercel  
vercel rollback <deployment-url>

# Modal
modal deploy --version <previous-version>
```

**Database rollback:** Manual, requires careful data review. Generally: write forward fix instead of true rollback.

**Post-rollback:**
- Sentry alerts confirmed cleared
- Status page updated
- Slack post-mortem channel created
- Action item: prevent recurrence

#### W.5.5. Feature flags

**PostHog feature flags** — gradual rollout:

```typescript
// Example: roll out new archetype model
if (await posthog.isFeatureEnabled('archetype-v2', tenantId)) {
  return await archetypeEngineV2.match(intent);
} else {
  return await archetypeEngineV1.match(intent);
}
```

**Flag types:**
- **Release flags** — feature on/off, deleted after rollout
- **Operational flags** — kill switches dla expensive features (e.g., disable LLM if cost spike)
- **Permission flags** — feature visibility per tier
- **Experiment flags** — A/B testing with assignment tracking

**Hygiene:** Quarterly review removes stale flags (>90 days post-rollout).

---

### W.6. Multi-tenant Isolation Testing

#### W.6.1. Automated isolation tests w CI

Patrz V.8.2 dla code examples. Każda migration adding tenant-scoped table requires accompanying RLS isolation test.

#### W.6.2. Noisy neighbor mitigation

**Per-tenant resource quotas:**
- Connection pool: max 100 concurrent connections per tenant API key
- Query timeout: 30s default (15s for read-heavy queries)
- Rate limits per V.3.1 (Layer 2)
- Cost limits per V.10.1

**Detection:**
- Tenant consuming >5x their fair share → Slack alert
- Consistent abuse → CSM outreach + tier upgrade conversation

#### W.6.3. Fuzzing authentication & authorization

```typescript
// packages/shared/__tests__/auth-fuzz.test.ts
import { fc } from 'fast-check';

describe('JWT fuzzing', () => {
  it('rejects all JWT permutations except valid', () => {
    fc.assert(fc.property(
      fc.string(), 
      (randomToken) => {
        expect(verifyJwt(randomToken)).toBeNull();
      }
    ), { numRuns: 10000 });
  });
});
```

Run weekly w CI (cron) — finds edge cases human tests miss.

---

### W.7. Data Governance

#### W.7.1. PII inventory

| Field | Storage | Classification | Retention | DSR coverage |
|---|---|---|---|---|
| Buyer fingerprint hash | ClickHouse `events.session_id` | Pseudonymous (technical identifier) | 13 months | DSR by session_id |
| Buyer chat transcripts | ClickHouse `chat_events.payload` (PII-redacted) | Personal (after redaction: low) | 90 dni | DSR by session_id |
| Tenant user emails | Postgres `users.email` | PII (email) | Active + 30 dni post-cancellation | Self-service deletion |
| Tenant user names | Postgres `users.full_name` | PII | Same | Same |
| Stripe customer ID | Postgres `tenants.stripe_customer_id` | Pseudonymous | Active + 7 lat (tax compliance) | Anonymized after retention |
| Audit logs | Postgres `staff_audit_log`, `tenant_audit_log` | Internal | 7 lat | Retained even after DSR (legal basis) |

#### W.7.2. Data classification

| Class | Definition | Examples | Encryption | Access |
|---|---|---|---|---|
| **Public** | Intentionally publicly accessible | Marketing site, SDK CDN | TLS in transit only | Anyone |
| **Internal** | Estalara internal use | Internal docs, design specs | TLS + at-rest | Estalara staff |
| **Confidential** | Tenant business data | Tenant config, listings, analytics | TLS + at-rest + RLS | Tenant + authorized staff |
| **Restricted** | PII, secrets | User passwords, MFA secrets, audit logs, Stripe data | TLS + at-rest + column-level encryption | Strictly RBAC + audit |

#### W.7.3. Right to erasure (GDPR Art. 17) — technical implementation

> **Updated 2026-05-24 (FOLLOW-039)** — pre-FOLLOW-039 the ClickHouse step was
> a documented daily-cron design that had not yet been built. The current
> implementation issues the mutations synchronously on `POST /api/dsr/erase`
> and polls via Vercel Cron; see §H.1.1 for the authoritative flow.

**Postgres:** Synchronous `DELETE` + cascading FK constraints inside a
`db.transaction()` block (`sessionEmbeddings`, `consentRecords`).

**ClickHouse:** `ALTER TABLE ... DELETE WHERE session_id IN (...)` issued
per PII-bearing table on the same request that handled the OTP. Mutation IDs
are captured from `system.mutations` and tracked in the Postgres
`dsr_clickhouse_mutations` operational table. A 5-minute Vercel Cron
(`/api/dsr/mutation-poll`) advances each row to `done`/`failed` and finalises
the audit log. Retries: 3 attempts with exponential backoff. See §H.1.1 for
the full flow + data inventory.

**pgvector embeddings:** `session_embeddings` deleted synchronously in the
same Postgres transaction as `session_id` removal. Listing-level embeddings
(`listing_embeddings`) are not session-scoped and are unaffected.

**Audit logs:** `dsr_audit_log` (ClickHouse) retained per legal basis (GDPR
Art. 17(3)(b) — for legal claims). Documented in Privacy Policy.
`dsr_clickhouse_mutations` (Postgres) retained for 7 years as the audit trail
of the erasure performed; not subject to DSR erasure itself.

#### W.7.4. Data lineage tracking

System diagram tracking where data flows:
```
SDK (browser) → Cloudflare Workers (ingest)
              ↓
              Redpanda Kafka
              ↓
              Modal stream-consumer
              ↓ ↓
        ClickHouse  pgvector
              ↓ ↓
        Modal archetype-job (daily)
              ↓
        Global archetype space (DP-anonymized)
```

Documented w Section A diagram + this section. Maintained as we add new data flows.

---

### W.8. Cost Management & FinOps

#### W.8.1. Per-service cost monitoring

**Daily spend dashboard** (`/admin/costs`):
- Cloudflare (Workers + R2 + Durable Objects)
- Vercel (compute + bandwidth)
- Supabase (DB + Auth + Storage)
- ClickHouse Cloud
- Modal (compute + GPU)
- Anthropic API (per model)
- OpenAI API (embeddings + fallback)
- Sentry, Doppler, GitHub, etc.

**Cost per tenant:** Daily aggregation showing margin per tier (Section N alignment).

#### W.8.2. Budget alerts

```yaml
budgets:
  daily:
    total: $250        # alert if exceeded by 20%
    anthropic: $100    # circuit breaker if >150% (V.10.3)
    openai: $50
  monthly:
    total: $7500       # MVP budget
    target_growth: 10% MoM until pilot revenue
```

Alerts: Slack `#estalara-finance` + email do Piotra.

#### W.8.3. Reserved capacity (Year 2)

- Anthropic: prepaid usage credits (reduces marginal cost ~10%)
- Cloudflare: Workers Unbound subscription (reduces per-req cost at scale)
- Supabase: Team plan upgrade (when >$1k/mo on Pay-as-you-go)

---

### W.9. Sprint mapping — Operational tickets

| Sprint | Ticket | Deliverable |
|---|---|---|
| Sprint 2 | TICKET-OPS-001 | Status page setup (status.estalara.com) |
| Sprint 2 | TICKET-OPS-002 | Sentry alert rules (SEV-1/2/3 routing) |
| Sprint 3 | TICKET-OPS-003 | Grafana dashboards: Real-time Ops, Per-tenant Health |
| Sprint 3 | TICKET-OPS-004 | Synthetic monitoring (Checkly or Pingdom) |
| Sprint 3 | TICKET-OPS-005 | PII log redactor (Pino serializer) |
| Sprint 4 | TICKET-OPS-006 | Per-tenant cost limits + circuit breaker (V.10) |
| Sprint 4 | TICKET-OPS-007 | Disaster recovery runbook (Notion) + first quarterly drill |
| Sprint 5 | TICKET-OPS-008 | Canary deployment dla Ingest Worker |
| Sprint 5 | TICKET-OPS-009 | RLS isolation tests (V.8.2) |
| Sprint 6 | TICKET-OPS-010 | DSR automation (Right to erasure) |

---

### W.10. Cross-references

- **Section H (Compliance)** — W.7 (Data Governance) implementuje H.1 GDPR requirements
- **Section J (Multi-tenancy)** — W.6 testuje J's RLS design
- **Section K (Internal Ops)** — W.4 (Observability) feeds K.3.4 Global ML Health
- **Section O (Risks)** — W.1 (DR) mityguje O.5 vendor reliance, W.5 (Deployment) mityguje O.1 deployment risks
- **Section V (Security)** — komplementarne; V to "what we secure", W to "how we operate it"

---

## X. Sprint 1.5 — Hardening Mini-Sprint (Completed 5 May 2026)

> **Context:** Po Sprint 1 audit kodu wykazał 5 luk security/observability które wymagały naprawy **przed** rozszerzaniem systemu. Ten mini-sprint zaadresował wszystkie z nich. Wszystkie commity zmergowane do `main`, CI zielone.

### X.1. Completed fix-tickets

| Ticket | Commit | Branch | Description |
|---|---|---|---|
| **TICKET-FIX-001** | `ff2760f` | `fix/otel-context-propagation` | OTel W3C Trace Context propagation through Kafka headers (Ingest → Redpanda → Modal stream-consumer). 7 Python tests + 2 TypeScript tests. |
| **TICKET-FIX-002** | `efa8f0f` | `fix/canonical-error-shared` | Promote `ErrorResponseBody` type + `errorBody()` helper z `apps/ingest` do `packages/shared/src/errors.ts`. Single source of truth dla całej aplikacji. |
| **TICKET-FIX-003** | `8446bb9` | `fix/ingest-security-headers` | Hono `secureHeaders` middleware na Ingest Worker — HSTS preload, nosniff, Referrer-Policy, Permissions-Policy. |
| **TICKET-FIX-004** | `d34bf9c` | `fix/drizzle-role-separation` | Two Drizzle clients: `createTenantClient` (RLS enforced) + `createAdminClient` (service role). Environment vars: `DATABASE_URL` + `DATABASE_URL_ADMIN`. |
| **TICKET-FIX-005** | `e163f94` | `fix/pii-blacklist-zod` | Zod `superRefine` validator rejecting PII fields (email, phone, name, address, ip, ssn, etc.) w event payloads. 23 test cases. GDPR Art. 5(1)(c) data minimization. |

### X.2. Side benefits

- **commitlint regex extended** — accepts `[TICKET-FIX-NNN]` and `[TICKET-INFRA-NNN]` formats
- **`pnpm install` for `packages/db`** — pre-existing missing dependency caught and fixed
- **224 new tests** — 78 → 101 shared, 113 → 115 ingest, 4 → 8 db, plus 7 Python OTel tests
- **CI green** post-merge: Lint ✅, Typecheck ✅, Test (Node 22) ✅, 7× Test (Python) ✅, Format ✅, Gitleaks ✅, ClickHouse migrations smoke ✅, Build ✅

### X.3. Lessons learned

1. **Zod `superRefine` returns `ZodEffects`, not `ZodObject`** — breaks `.extend()`. Solution: rename base schema, apply superRefine separately. (TICKET-FIX-005)
2. **Vitest mock proxies throw on undefined property access** — optional chaining can't intercept. Solution: try/catch around OTel calls. (TICKET-FIX-001)
3. **Cherry-picking same commit across branches creates duplicate history** — git's ORT merge strategy resolves automatically when diffs are identical. (Multiple branches sharing commitlint fix)
4. **`pnpm install` not run after dependency added to `package.json`** — pre-existing typecheck failure. Caught when typechecking after adding new code. (TICKET-FIX-004)

### X.4. Outcome

System **ready for Sprint 2** (TICKET-021 Postgres schema + remaining 7 tickets). Foundation hardened against:
- Cross-tenant data leakage (RLS enforced via Drizzle separation)
- PII compliance violations (Zod blocks at validation layer)
- XSS/clickjacking (security headers enforced)
- Distributed debugging blind spots (OTel propagation works end-to-end)
- Inconsistent error responses (canonical format shared)

**Next step:** Section U Sprint 2 ticket — TICKET-021 must include new tables from U.2.3 (`users` with RBAC roles), U.3.2 (`tenant_registrations`), and U.9 (`staff_audit_log`).

---

## Y. Document Governance Policy

> **Added in v2.0 (2026-05-20).** This section codifies how Master_Design stays in sync with the documents that reference it, so that the entire project's institutional memory remains coherent. It is the structural counterpart to `docs/ops/OPERATING_PRINCIPLES.md` Rule 2.

### Y.1 — Version metadata lives in content, not filenames

The Master_Design file is `docs/MASTER_DESIGN.md` — always, with no version suffix. Version is on line 3 in `**Wersja:** X.Y` format. Date is on the same line.

Filenames that contain version numbers (e.g. `MASTER_DESIGN_v1_4.md`, `MASTER_DESIGN_PATCH_v1_5.md`) are **historical snapshots**, NOT references. Active documents (CLAUDE.md, AGENT_WORKFLOW.md, subagent prompts) must never link to versioned filenames — they link to `docs/MASTER_DESIGN.md` and rely on the version being current in content.

This rule eliminates the "stale version reference" class of bug at the structural level. Before this rule existed, `CLAUDE.md` in repo root referenced "Master Design v1.1 (2026-04-26)" while the actual Master_Design was at v1.9 from 2026-05-17 — a 1-month-stale mental model that every Claude Code session booted from. The 2026-05-20 anti-pattern (6-hour POC duplicating existing code) was a direct consequence.

### Y.2 — Update propagation (Definition of Done requirement)

Every Master_Design update (any version bump — patch, minor, or major) MUST include review of the following documents. If any of them reference content that changed in Master_Design, they must be updated in the same PR or as an immediate follow-up commit.

**Propagation checklist (canonical list — this is the single source of truth):**

| # | Document | What to check |
|---|---|---|
| 1 | `CLAUDE.md` (repo root) | Does it reference section names (e.g. §B.5, §Snapshot.1) that were renamed? Does it carry implicit version assumptions? (Note: per Y.1, CLAUDE.md does NOT carry explicit version numbers — but it may reference section structure.) |
| 2 | `docs/AGENT_WORKFLOW.md` | Does the process described depend on Master_Design section structure (e.g. "read §B.5 before doing auto-detect work")? If a referenced section moved, fix the reference. |
| 3 | `.claude/agents/*.md` (all subagent prompts) | Each subagent reads Master_Design as part of its boot context. If section names changed, prompts may break. Audit all prompts for hardcoded section references. |
| 4 | `backlog/QUEUE.md` | If sprint counts, sprint themes, or ticket states changed in Master_Design Snapshot.1, QUEUE.md must reflect the same. |
| 5 | `backlog/STATUS.md` | If Snapshot.1 state changed, bump STATUS.md date and re-verify "(none — all sprints through N complete)" claims. |
| 6 | `AUDIT_*.md` (repo root) | Audit reports cite specific Snapshot.1 verdicts. If a verdict changed (e.g. 🟡 Partial → 🟢 Mostly Shipped), the audit's narrative may also need adjustment. |
| 7 | `docs/ops/OPERATING_PRINCIPLES.md` | If §Y (this section) changed materially, Operating Principles Appendix B (which points here) should be reviewed for whether the pointer still makes sense. |

`docs/ops/OPERATING_PRINCIPLES.md` Appendix B links here rather than duplicating the list, so the list above is the only place this checklist lives. That structural choice is itself an application of Master_Design = single source of truth (Operating Principle 1).

### Y.3 — Snapshot.1 freshness policy

§Snapshot.1 is the only section in this document that asserts current implementation state. Sections A–U and §V–§X describe target architecture, strategic vision, and historical milestones; only §Snapshot.1 says "what is built today."

For Snapshot.1 to be trustworthy:

- It MUST be re-verified after every sprint completion (not just "every major version bump")
- The date in its header (e.g. "Implementation Status Snapshot (2026-05-XX)") IS the ground-truth marker — if the snapshot date is older than 7 days, sessions should assume drift and verify against repo before relying on snapshot claims
- When repo reality contradicts Snapshot.1, repo wins. Update Snapshot.1 in the same PR as the work that caused the drift, or open a dedicated reconciliation PR within 24 hours
- Snapshot.1 entries should cite file paths and line counts where possible, so that future verification is mechanical (`git show main:packages/...`) rather than interpretive

### Y.4 — Relationship to OPERATING_PRINCIPLES.md

`docs/ops/OPERATING_PRINCIPLES.md` (the 5 fundamental rules) and this section (Document Governance Policy) are complementary:

- OPERATING_PRINCIPLES.md tells **a session** what to do (read Master_Design first, verify before claiming, apply reflexive thinking, etc.)
- This section (§Y) tells **the documentation system** what to do (where versions live, what propagates, how Snapshot.1 stays fresh)

Operating Principle 1 (Master_Design = SoT) is enforceable because §Y makes the document structurally trustworthy. Operating Principle 2 (continuous synchronization) is enforceable because §Y.2 provides the checklist.

If these two documents drift from each other, treat that as a P0 bug — they exist as a tightly-coupled pair.

### Y.5 — Changelog of this section

- **v2.0 (2026-05-20):** Section established. Codifies structural fixes for the 2026-05-20 anti-pattern (POC duplicating shipped code due to stale CLAUDE.md reference).

---

