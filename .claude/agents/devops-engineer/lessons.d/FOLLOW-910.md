# FOLLOW-910 — devops lesson (2026-08-09)

- **Date / ticket:** 2026-08-09 / FOLLOW-910 (the branch guard was blind to Bash-shaped edits).
- **What I decided:** Extended `pre-bash-guard.sh` with a sixth, NON-BLOCKING guard rather than
  adding a matcher — the Bash tool already routes here, and a second hook on the same matcher would
  double every check. Kept it non-blocking because FOLLOW-849's whole finding was that the guard's
  credibility is the scarce resource, and a blocking Bash guard would interrupt sanctioned
  main-branch work constantly.
- **How I kept it believable:** it stays SILENT unless it can point at a real write to a real repo
  file. Quoted spans lose their contents before verb detection, so `echo "sed -i x"` is not a write;
  targets under `/tmp`, `/dev`, `.git/` and `node_modules/` are ignored; the pm-orchestrator's
  exempt backlog files are exempt here exactly as they are on the Edit side. Eight fixture cases
  exist only to prove those silences (section F).
- **The bug my own smoke test caught before the fixtures did:** a `sed` SCRIPT (`s/a/b/`) contains a
  slash, so my first target filter collected it as a path — which made every `sed -i` warn,
  including on the exempt backlog files the exemption list exists to silence. A guard whose first
  behaviour is to cry wolf on the pm's own routine edits would have been dead on arrival. Fixed by
  requiring a target to exist on disk or be shaped like a named file, plus an explicit
  sed/perl-script exclusion.
- **What it deliberately cannot see, stated in the hook rather than discovered later (Rule AS):** a
  write inside an interpreter heredoc whose target is computed at runtime instead of written as a
  literal. The common form — a quoted path beside `open(...)`/`.write(...)` — is caught, and that is
  this session's own dominant editing shape.
- **A guardrail I'd add:** when a control is registered against a TOOL, enumerate the ways the
  guarded ACTION can reach the system, not the ways the tool is named. "Edit|Write|MultiEdit" looked
  exhaustive for "file edits" and covered three of four paths; the fourth was the one the operating
  mode actively encourages. Same family as FOLLOW-918 and FOLLOW-919, both landed today: **controls
  in this estate keep asserting the presence of a name where they mean the coverage of a
  behaviour.**
