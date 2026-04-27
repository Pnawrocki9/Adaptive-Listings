---
id: TICKET-005
title: Add apps/auto-detect Python placeholder app (NEW v1.1)
sprint: 0
priority: P1
agent: devops-engineer
status: READY
estimated_hours: 2
depends_on: [TICKET-001]
produces: [TICKET-007, TICKET-033]
affects_files:
  - 'apps/auto-detect/**'
  - 'pnpm-workspace.yaml'
  - 'turbo.json'
context_files:
  - docs/MASTER_DESIGN.md (sections B.4, B.5 — auto-onboarding)
  - apps/intent-engine/* (existing pattern to mirror)
  - .claude/agents/devops-engineer.md
  - .claude/agents/ml-engineer.md
labels: [foundation, p1, infra, auto-onboarding, v1.1]
---

# TICKET-005: Add apps/auto-detect Python placeholder app (NEW v1.1)

## Summary

Create the `apps/auto-detect/` Python app placeholder following the same pattern as the other 6
Modal Python apps (intent-engine, adaptation-engine, llm-gateway, stream-consumer,
archetype-pipeline, data-quality). This is a placeholder only — actual auto-detection logic ships in
TICKET-033 and beyond. This ticket just creates the scaffold so other tickets can depend on it.

## Context

Master Design v1.1 added sections B.4-B.7 (Auto-Onboarding & Zero-Config Installation). The
implementation lives in a new Modal Python app at `apps/auto-detect/`. This brings our Modal Python
apps from 6 to 7, total apps from 9 to 10.

Pattern to mirror exactly: look at `apps/intent-engine/` from TICKET-001 — same `pyproject.toml`
shape, same `src/__init__.py` + `src/main.py` skeleton, same smoke test in `tests/`.

## Scope

### In scope

- Create directory `apps/auto-detect/` with this structure:
  ```
  apps/auto-detect/
  ├── README.md          # Brief: "Modal Python service for auto-detecting site schemas (B.4-B.6)"
  ├── pyproject.toml     # build-backend = "setuptools.build_meta", deps placeholder
  ├── src/
  │   ├── __init__.py    # empty
  │   └── main.py        # placeholder: print('estalara-auto-detect placeholder')
  └── tests/
      ├── __init__.py
      └── test_smoke.py  # imports main, asserts truthy
  ```
- Update root `pnpm-workspace.yaml` (if it lists apps explicitly) to include `apps/auto-detect`
- Update `turbo.json` if it has app-specific config
- Update CI workflow (`.github/workflows/ci.yml`) to add a Test (Python 3.12, auto-detect) job
  mirroring the pattern for other Python apps
- README.md should be brief but reference Master Design B.4-B.7 sections

### Out of scope

- Actual Puppeteer / Vision / Schema.org logic — that's TICKETs 030-035 in Sprint 2.5
- Modal serverless deployment config — comes with real implementation
- Dependencies beyond the placeholder set (no real `puppeteer`, `playwright`, `anthropic` yet)

## Acceptance criteria

- [ ] AC1: `apps/auto-detect/pyproject.toml` exists with `[build-system]` block specifying
      `build-backend = "setuptools.build_meta"` (NEVER `setuptools.backends.legacy`)
- [ ] AC2: `apps/auto-detect/src/__init__.py` exists (even if empty)
- [ ] AC3: `apps/auto-detect/src/main.py` exists with at least one exported function/symbol
- [ ] AC4: `apps/auto-detect/tests/test_smoke.py` exists, imports from `src`, has at least one
      passing pytest test
- [ ] AC5: `apps/auto-detect/README.md` exists, references Master Design sections B.4, B.5, B.6
- [ ] AC6: CI workflow has `Test (Python 3.12, auto-detect)` job that succeeds on this app's smoke
      test
- [ ] AC7: All other CI checks (lint, typecheck, format, build, existing Python tests) still pass
- [ ] AC8: PR title `chore(infra): add apps/auto-detect placeholder [TICKET-005]`

## Implementation guidance

Open `apps/intent-engine/pyproject.toml` first and copy its structure. Replace name, description.
Critical:

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"   # NEVER setuptools.backends.legacy

[project]
name = "estalara-auto-detect"
version = "0.0.1"
description = "Modal Python service for auto-detecting site schemas (Master Design B.4-B.6)"
requires-python = ">=3.12"
dependencies = [
    # placeholder — actual deps (puppeteer, anthropic, etc.) added in TICKET-033+
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.setuptools.packages.find]
where = ["src"]
```

For `src/main.py`:

```python
"""Estalara Auto-Detect — placeholder.

Real implementation lands in TICKET-033 (Puppeteer + Modal scaffold)
and TICKET-034 (Claude Vision integration).

See docs/MASTER_DESIGN.md sections B.4 (Auto-Onboarding flow),
B.5 (Schema Discovery layered detection), B.6 (Continuous validation).
"""

PLACEHOLDER_VERSION = "0.0.1"


def is_ready() -> bool:
    """Smoke test that the package is importable."""
    return True
```

For `tests/test_smoke.py`:

```python
"""Smoke tests for estalara-auto-detect placeholder."""
from src.main import is_ready, PLACEHOLDER_VERSION


def test_is_ready():
    assert is_ready() is True


def test_version():
    assert isinstance(PLACEHOLDER_VERSION, str)
    assert len(PLACEHOLDER_VERSION) > 0
```

For CI workflow, find the existing Python app jobs and copy the pattern:

```yaml
test-python-auto-detect:
  name: Test (Python) (3.12, auto-detect)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with:
        python-version: '3.12'
    - working-directory: apps/auto-detect
      run: |
        pip install -e ".[dev]"
        pytest -v
```

## Test plan

- Local: `cd apps/auto-detect && pip install -e ".[dev]" && pytest -v` — all tests pass
- Local: `pnpm turbo run test` — all tests across monorepo pass (including new Python app)
- CI: open PR, verify all CI jobs green including new Python test job

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-005-auto-detect-placeholder`
- [ ] PR title `chore(infra): add apps/auto-detect placeholder [TICKET-005]`
- [ ] All ACs verified
- [ ] CI fully green via `gh pr checks <pr> --watch`
- [ ] `pnpm exec prettier --check .` clean
- [ ] HANDOFF written to `backlog/HANDOFFS.md` for TICKET-007 and TICKET-033

## Notes

- This is a small ticket. ~2h max. If it takes longer, you're overthinking it. Mirror existing
  Python app exactly.
- Don't add real Puppeteer/Vision deps yet — they go with the actual implementation in TICKET-033+.
