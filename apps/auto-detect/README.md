# estalara-auto-detect

Modal Python service for auto-detecting site schemas via AI Vision and Puppeteer.

## Status

Placeholder — full implementation in TICKET-033 and TICKET-034 (ml-engineer).

## Purpose

Implements Master Design v1.1 sections B.4-B.7:

- **B.4 Auto-Onboarding & Zero-Config Installation** — Magic Link flow, admin pastes URL, AI detects
  schema
- **B.5 Schema Discovery & Auto-Configuration Pipeline** — Layered detection (Vision + DOM +
  Schema.org + LLM)
- **B.6 Continuous Schema Validation & Self-Healing** — Daily health checks, auto re-detection on
  drift
- **B.7 Pre-Built Platform Templates Library** — 50+ platform templates (WordPress, Webflow, custom)

## Development

```bash
cd apps/auto-detect
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ -v
```

## Deployment

Will run on Modal serverless (Python 3.12). See TICKET-033 for Modal deployment scaffold.
