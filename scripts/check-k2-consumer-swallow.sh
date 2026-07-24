#!/usr/bin/env bash
# Rule K.2 consumer-side swallow guard — FOLLOW-625.
#
# Mechanises the consumer-side clause of CONVENTIONS_PATCH.md Rule K.2 (and its
# Verification-block grep, which nothing ran): FAILS the build when a CLIENT
# component under apps/control-plane/src/{app,components}/** GETs its editable
# config on a fetch(...) chain, populates form state, and SWALLOWS a failed load
# (empty / comment-only / log-only / no-op .catch) — the "swallow a failed GET
# then Save DEFAULTS over real config" data-loss class that shipped four times
# (FOLLOW-595 → 596 → 600, then the twins fixed in FOLLOW-630) and was caught
# only by retros (RETRO-205 §6 P-2, RETRO-206 §4a LG-2).
#
# The detection logic lives in scripts/check-k2-consumer-swallow.cjs (a
# TypeScript-AST walk; `typescript` is already a repo devDependency). See that
# file's header for the COVERED vs DOCUMENTED-RESIDUAL call-shapes (Rule AE) and
# the annotated allow-list mechanism. This wrapper exists so CI wiring and the
# fixture harness invoke a stable `bash scripts/check-k2-consumer-swallow.sh
# [scan_root ...]` entrypoint.
#
# Exit codes: 0 = pass, 1 = violation found.
# Run: scripts/check-k2-consumer-swallow.sh [scan_root ...]
# Default scan roots: apps/control-plane/src/app  apps/control-plane/src/components

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH."
  exit 1
fi

node scripts/check-k2-consumer-swallow.cjs "$@"
