# Codex Review — lokalne próby i logi

[Wszystkie wyniki Codex Review](../../../CODEX_REVIEW.md) ·
[Interpretacja dowodów i komendy](../EVIDENCE.md)

To materiały z lokalnej weryfikacji 2026-10-08 na `b54f472c`. Próby odtwarzają wady; ich PASS nie
oznacza naprawy produktu. Wcześniejsze błędy i wyniki pośrednie zachowano dla pełnego kontekstu, bez
wliczania do końcowego wyniku. Kopie `.txt` są pozbawione kolorów ANSI i nie podlegają regule Git
ignorującej pliki `.log`.

## Kod prób

| Plik                                                   | Zakres                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [vitest.config.ts](vitest.config.ts)                   | Osobna konfiguracja lokalnych prób i aliasów do rzeczywistych źródeł.              |
| [gateway.test.ts](gateway.test.ts)                     | Walidacja faktów, cech i znaczenia liczb w gateway.                                |
| [sdk.test.ts](sdk.test.ts)                             | Follow-up po czacie, stan i lifecycle SDK.                                         |
| [boundaries.test.ts](boundaries.test.ts)               | Granice JWT, SSRF, timestampów, kolejki i usuwania danych.                         |
| [embed-permissions.test.ts](embed-permissions.test.ts) | Uprawnienia rzeczywistego handlera `/api/listings/embed`.                          |
| [otp-race.test.ts](otp-race.test.ts)                   | Równoległe próby OTP z rzeczywistym helperem i PGlite.                             |
| [python_reproduce.py](python_reproduce.py)             | Rzeczywisty helper i job generowania opisu z odizolowanymi dostawcami i writerami. |

## Wyniki końcowe i istniejące testy

| Log                                                      | Interpretacja                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [reproductions-final.txt](reproductions-final.txt)       | Końcowe 16 PASS w 5 plikach TS: potwierdzone reprodukcje wad.                 |
| [python-reproductions.txt](python-reproductions.txt)     | Niepoparte 9.9% trafia do obu writerów cache; sprawdzenie przykładów promptu. |
| [existing-sdk.txt](existing-sdk.txt)                     | 95 istniejących testów SDK PASS.                                              |
| [existing-control-plane.txt](existing-control-plane.txt) | 111 istniejących testów control-plane PASS.                                   |
| [existing-ingest.txt](existing-ingest.txt)               | 60 istniejących testów ingest PASS.                                           |
| [existing-auth.txt](existing-auth.txt)                   | 44 istniejące testy auth PASS.                                                |
| [sdk-build.txt](sdk-build.txt)                           | Build i budżet SDK: 42 400 / 43 136 B gzip.                                   |
| [fire-and-forget.txt](fire-and-forget.txt)               | Kontrola użycia `afterResponse` PASS.                                         |

## Historia prób — nie sumować z wynikami końcowymi

| Log                                                            | Rola w historii weryfikacji                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [first-run.txt](first-run.txt)                                 | Pierwsze uruchomienie, brak aliasu modułu i nieudane asercje prób.                     |
| [boundaries-run.txt](boundaries-run.txt)                       | Nieudane wczesne asercje prób timestampów i rozmiaru kolejki.                          |
| [reproductions.txt](reproductions.txt)                         | Wcześniejszy, częściowy zestaw reprodukcji.                                            |
| [otp-run.txt](otp-run.txt)                                     | Osobne uruchomienie próby wyścigu OTP.                                                 |
| [embed-run.txt](embed-run.txt)                                 | Osobne uruchomienie próby uprawnień embeddingów.                                       |
| [reproductions-late-sample.txt](reproductions-late-sample.txt) | Przebieg pośredni z niepotwierdzonym jeszcze założeniem liczbowym SDK.                 |
| [sdk-immediate.txt](sdk-immediate.txt)                         | Próba założenia o drugiej ekstrakcji; wymaga interpretacji z EVIDENCE.                 |
| [sdk-initial-assumption.txt](sdk-initial-assumption.txt)       | Zachowana wcześniej kopia nieudanej hipotezy: identyczne wymiary dają 0.484, nie >0.6. |
| [sdk-confirmation.txt](sdk-confirmation.txt)                   | Potwierdzenie obu wariantów wejścia przed końcowym zestawem.                           |

Komendy uruchomienia oraz rozdzielenie zależności rzeczywistych i atrap są w
[EVIDENCE.md](../EVIDENCE.md). Pliki `.log`, które mogą pozostać w lokalnym katalogu, mają
odpowiedniki `.txt` w tym archiwum; nie są potrzebne do jego przeniesienia.
