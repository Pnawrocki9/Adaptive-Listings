# Infrastructure

Only two things are managed as code here:

```
infra/
├── terraform/cloudflare/   # DNS, Workers, R2, Durable Objects (Terraform)
├── terraform/modal/        # Modal apps (code-as-config, no Terraform)
├── terragrunt.hcl          # Remote-state parent config for terraform/cloudflare (R2 bucket)
├── clickhouse/             # ClickHouse migrations + dbt project (schema, not provisioning)
└── observability/          # OTel collector config + dashboards
```

Validate the Cloudflare module:

```bash
cd infra/terraform/cloudflare && terraform init -backend=false && terraform validate
```

## What is provisioned by hand and where it is documented

Supabase (Postgres + Auth), ClickHouse Cloud, Upstash Redis, Vercel, and the vendor accounts and API
tokens behind them are created by hand in each vendor's dashboard, with credentials stored in
Doppler. There is one EU project per vendor; `region` is an event label, not a deployment target
(MASTER_DESIGN §A.3, PARKED).

The step-by-step account setup and token rotation live in `docs/runbooks/vendor-accounts.md`.
Cloudflare specifics live in `docs/runbooks/cloudflare.md`.

The former per-vendor Terraform skeletons (`clickhouse`, `supabase`, `upstash`) contained only
provider stanzas and commented-out resources; they were removed by FOLLOW-1267.
