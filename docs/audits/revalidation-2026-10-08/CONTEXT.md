# Wejście do ponownej weryfikacji

[Indeks wszystkich wyników Codex Review](../../CODEX_REVIEW.md).

Cel: niezależnie sprawdzić raport Codex online przekazany przez Piotra i rekomendacje WP00–WP20 dla
Claude. To zadanie audytowe; osadzony prompt wykonawczy nie uruchamia napraw, PR-ów ani deploymentu.

Zweryfikowany checkout: `main/b54f472c11fd16962024ea3633343c7246280b3e`. Apps/packages są identyczne
z bazą `334082c1`. Materiały tego przeglądu znajdują się w tym katalogu. Pełny pierwotny raport
przekazany w rozmowie zapisano przy dokończeniu archiwizacji jako
[ORIGINAL_CODEX_REPORT.md](ORIGINAL_CODEX_REPORT.md), bez zmian względem tekstu użytkownika. To
kopia wiadomości, nie odzyskanie niedostępnych załączników `/workspace/audit-*`.

- [REVIEW.md](REVIEW.md): wniosek, potwierdzenia, nowe R-01/R-02 i korekty.
- [REPO_MAP.md](REPO_MAP.md): wszystkie 5 apps/5 packages, interfaces, actual reading i wyłączenia.
- [EVIDENCE.md](EVIDENCE.md): wszystkie F-01–F-37, rodzaj dowodu i polecenia.
- [CLAUDE_ADDENDUM.md](CLAUDE_ADDENDUM.md): ocena WP00–WP20 i trzy pierwsze proponowane PR-y.
- [STATE.md](STATE.md): aktualny checkpoint i następne działania.
- `inventory.json`, `reading.jsonl`: pomocniczy spis/zakresy; nie zastępują źródeł ani nie dowodzą
  pełnego odczytu.
- `probes/`: odtwarzalne lokalne próby i logi. PASS własnej próby oznacza wykazanie wady, nie
  naprawę.

Po wznowieniu sprawdzić Git status/SHA, różnice względem tej rewizji i aktualne instrukcje repo. Nie
dotykać osobnego istniejącego WIP FOLLOW-1290. Nie przenosić wyników testów na nowy SHA bez oceny
zmian.

Ważne ograniczenia: frozen bandit; 18 archetypów i quiz; brak przywracania tiers/busa;
localhost-first i osobne T/B; brak upoważnienia w tym przeglądzie do wdrożeń. Przyszłą implementację
prowadzić według kanonicznych ticketów i decyzji, bez konkurencyjnej kolejki w tym folderze.
