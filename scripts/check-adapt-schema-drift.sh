#!/usr/bin/env bash
# Rule H gate (adapt sub-case, FOLLOW-105 / ADR-0006 §Decision 4, gate 1).
#
# Asserts the SDK adapt-response Zod validator (`adaptResponseSchema`) carries the
# same top-level field set as the canonical `AdaptationDirectives` contract.
# Delegates the parsing/comparison to the Node helper (no jq dependency).
#
# Exit codes: 0 = field sets match, 1 = drift.
# Run: bash scripts/check-adapt-schema-drift.sh

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH."
  exit 1
fi

node scripts/check-adapt-schema-drift.cjs
