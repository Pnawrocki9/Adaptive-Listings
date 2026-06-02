# scripts/dev

Local-only developer tools. Not part of any app build or deploy.

## `mock-decision-server.mjs`

A dev test-double for the decision API. It lets you watch live SDK DOM adaptation in a browser
without standing up the full stack (ClickHouse / Redpanda / Modal / control-plane). For a selected
**archetype** and **LLM model**, it generates an adapted headline + long-form description by calling
Claude, grounded in real listing data, using the **live production system prompt** read straight
from `apps/llm-gateway/src/jobs/generate_description.py` (edit the prompt → next generation reflects
it).

> The in-product equivalent is **DEMO-001 (Archetype Simulator)** on admin.estalara.com. This script
> is the dev/local prototype of that feature; the global model switch mirrors **FOLLOW-161**.

### Run

From the repo root (needs `ANTHROPIC_API_KEY`, supplied via Doppler):

```bash
doppler run -p estalara-adaptive-listings -c dev -- node scripts/dev/mock-decision-server.mjs
```

Without the key it serves a generic fallback copy so the demo still renders.

### Use

1. Open <http://localhost:9100/> → archetype + LLM-model dropdowns (switcher UI).
2. Pick a model + archetype → **Switch + generate**.
3. Reload the listing tab (a site whose SDK points `data-decision-url` at `http://localhost:9100`) →
   the SDK fetches the adapted copy and mutates the DOM.

### Endpoints

| Method | Path                                 | Purpose                                   |
| ------ | ------------------------------------ | ----------------------------------------- |
| GET    | `/` · `/mock/archetype`              | switcher UI (dropdowns)                   |
| GET    | `/mock/archetype/<id>`               | switch archetype + (re)generate           |
| GET    | `/mock/model/<id>`                   | switch generation model (clears cache)    |
| GET    | `/mock/status`                       | current archetype + model                 |
| GET    | `/estalara-sdk.iife.js`              | serve the prebuilt SDK bundle             |
| GET    | `/adapt/description`                 | long-form description (mock decision API) |
| POST   | `/adapt`                             | headline directive (mock decision API)    |
| POST   | `/v1/events` · `/api/adapt/feedback` | no-op 200                                 |

### Env overrides

`PORT` (9100), `SDK_BUNDLE`, `PROMPT_FILE`, `BACKEND_URL` (`http://localhost:8081`), `DEMO_SLUG`,
`LISTING_BASE_URL` (`http://localhost:5173`), `DESCRIPTION_MODEL`, `ARCHETYPE`.

### Requires

- A prebuilt SDK bundle at `packages/sdk/dist/estalara-sdk.iife.js`
  (`pnpm --filter @estalara/sdk build`).
- A local backend serving listing data at `BACKEND_URL` (optional — falls back to empty context).
