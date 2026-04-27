# Modal Serverless Python Infrastructure

**Status:** Skeleton only. No Terraform provider available for Modal.

## Overview

Modal is our **serverless Python compute platform** for ML and data workloads. We use Modal for:

- **Intent Engine** (Claude Haiku 4.5 + embeddings → intent vector)
- **Adaptation Engine** (Claude Sonnet 4.6 + templates → adaptive listing directives)
- **Auto-Detection Service** (Puppeteer + Claude Vision → schema discovery)
- **Stream Consumer** (Redpanda → ClickHouse ETL pipeline)
- **Archetype Computation** (nightly batch job, aggregates embeddings with differential privacy)

## Why Modal?

- **Serverless Python:** No containers, no k8s, just `@app.function()` decorators
- **Fast cold starts:** <2s for GPU functions (warm-keep for critical paths)
- **Cost-effective:** Pay per second of compute (vs. Modal alternative Replicate ~2x cost)
- **LLM-optimized:** Built-in support for batching, caching, GPU inference
- **Dev experience:** `modal run` for local dev, `modal deploy` for prod

**Alternatives considered:**

- AWS Lambda (15-minute timeout, cold Python environments, awkward GPU support)
- Google Cloud Run (better than Lambda, but still containerized, slower cold start)
- Replicate (focused on model hosting, not general compute, 2x cost)

## Architecture

Modal apps are **code-as-config** (Python decorators), not HCL. Each app in `apps/*/src/main.py`
defines its own Modal functions:

```python
import modal

app = modal.App("intent-engine")

@app.function(
    image=modal.Image.debian_slim().pip_install("anthropic", "openai"),
    secrets=[modal.Secret.from_name("anthropic-api-key")],
    cpu=2.0,
    memory=4096,
    timeout=300,
)
def extract_intent(event: dict) -> dict:
    # Claude Haiku 4.5 call here
    pass
```

Deployment is per-app:

```bash
modal deploy apps/intent/src/main.py
```

CI/CD pipeline (Sprint 1+) runs `modal deploy` on merge to `main`.

## Prerequisites

1. **Modal account**
   - Signup: https://modal.com
   - Free tier: $30 credit (enough for MVP testing)
   - Production: $500-$1k/month estimated (see cost section)

2. **Workspace created**
   - Create workspace `estalara` in Modal dashboard
   - Invite team members (Piotr, Rafał, Krystian)

3. **API Token (Token ID + Token Secret)**
   - Generate: https://modal.com/settings/tokens
   - **Important:** Token secret shown only once — store immediately in Doppler

4. **Modal CLI installed**
   ```bash
   pip install modal
   ```

## Setup

### 1. Authenticate locally

```bash
modal token set --token-id $(doppler secrets get MODAL_TOKEN_ID --plain) \
  --token-secret $(doppler secrets get MODAL_TOKEN_SECRET --plain)
```

### 2. Verify environment

```bash
cd infra/terraform/modal/modal-config
python modal_setup.py
```

Expected output:

```
✓ Modal library installed (version 0.x.x).
✓ Modal environment variables OK.
Modal setup complete. Ready to deploy apps.
```

### 3. Deploy an app (example)

```bash
modal deploy apps/intent/src/main.py
```

## Cost Estimation

Modal charges per second of compute:

| Resource Type        | Price                          | Use Case                 |
| -------------------- | ------------------------------ | ------------------------ |
| CPU (1 vCPU)         | $0.000032/second (~$2.30/hour) | Non-GPU inference, ETL   |
| GPU (T4)             | $0.00056/second (~$2/hour)     | CLIP embeddings (cached) |
| GPU (A100)           | $0.0028/second (~$10/hour)     | Future: fine-tuned Llama |
| Storage (persistent) | $0.10/GB/month                 | Model weights, cache     |

**MVP estimate (100k intent extractions/day, 5s avg per call):**

- Intent engine: 100k × 5s × $0.000032 = $16/day = ~$500/month
- Adaptation engine: 50k × 3s × $0.000032 = $4.80/day = ~$150/month
- Auto-detect (on-demand): 1k × 30s × $0.000032 = ~$1/day = $30/month
- Stream consumer (24/7 low-CPU): 86,400s × $0.000032 = $2.76/day = ~$85/month
- **Total:** ~$765/month

At scale (1M intent extractions/day):

- ~$5k/month compute

**LLM costs** (Claude API calls) are **passthrough** — charged separately via Anthropic billing, not
Modal.

See https://modal.com/pricing for latest pricing.

## Secrets Management

Modal secrets are created via dashboard or CLI:

```bash
# Create a secret in Modal
modal secret create anthropic-api-key ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY --plain)
modal secret create openai-api-key OPENAI_API_KEY=$(doppler secrets get OPENAI_API_KEY --plain)
modal secret create supabase-credentials \
  SUPABASE_URL=$(doppler secrets get SUPABASE_URL --plain) \
  SUPABASE_KEY=$(doppler secrets get SUPABASE_SERVICE_KEY --plain)
```

Then reference in app:

```python
@app.function(secrets=[modal.Secret.from_name("anthropic-api-key")])
def my_function():
    import os
    api_key = os.environ["ANTHROPIC_API_KEY"]
```

## Performance Budget

- **Cold start:** <2s for CPU functions, <5s for GPU functions (T4)
- **Warm-keep:** Critical paths (intent engine, adaptation) keep 5-10 warm instances (adds
  ~$50/month)
- **Timeout:** 5 minutes default, 15 minutes max per function

## Security Notes

- **Token rotation:** Rotate Modal tokens every 90 days (add to Doppler rotation schedule)
- **Network isolation:** Modal functions run in isolated containers (no shared state)
- **Secrets:** Never log secrets; use `modal.Secret.from_name()` for injection
- **GDPR:** Modal runs on AWS/GCP in US/EU regions — choose EU region for EU tenant workloads
  (configure per-app)

## Modal CLI Commands

```bash
# List deployed apps
modal app list

# View logs (live tail)
modal logs intent-engine

# Stop an app
modal app stop intent-engine

# View function stats
modal stats intent-engine
```

## Terraform Alternative (Why Not)

Modal **does not have a Terraform provider**. Alternatives:

1. **Use Modal CLI in CI** (our choice — simpler, Modal-native)
2. **Use Terraform `null_resource` + `local-exec`** (hacky, not recommended)
3. **Wait for community provider** (none exist as of 2026-04)

We chose option 1: `modal deploy` in GitHub Actions workflow (Sprint 1+).

## Next Steps

1. **TICKET-015:** Stream consumer Modal scaffold (Redpanda subscribe → ClickHouse insert)
2. **Sprint 4:** Intent Engine implementation (TICKET-040+)
3. **Sprint 5:** Adaptation Engine implementation (TICKET-050+)
4. Create Modal secrets in dashboard for Anthropic/OpenAI/Supabase credentials
