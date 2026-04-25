# Conventions

The non-negotiable rules every agent follows. When in doubt, follow these. When these conflict with a ticket, follow these and flag the conflict in escalations.

## Languages and tooling

- **TypeScript** for everything in `packages/` and `apps/` except Python ML services
- **Python 3.12+** for `apps/intent-engine`, `apps/adaptation-engine`, `apps/stream-consumer`, `apps/archetype-pipeline`, `apps/data-quality`
- **SQL** with Drizzle (Postgres) and raw SQL files (ClickHouse)
- **HCL** for Terraform
- **YAML** for GitHub Actions, docker-compose

## Repo structure

```
.
├── CLAUDE.md
├── .claude/
│   ├── agents/          # subagent definitions
│   ├── hooks/           # lifecycle hooks
│   ├── commands/        # custom slash commands
│   └── settings.json
├── apps/                # deployable services
│   ├── ingest/                # Cloudflare Worker
│   ├── control-plane/         # Next.js dashboard + API
│   ├── decision-api/          # Edge Worker for adaptation decisions
│   ├── intent-engine/         # Modal Python
│   ├── adaptation-engine/     # Modal Python
│   ├── llm-gateway/           # Modal Python (LiteLLM router)
│   ├── stream-consumer/       # Modal Python (Redpanda → ClickHouse)
│   ├── archetype-pipeline/    # Modal Python (daily batch)
│   └── data-quality/          # Modal Python
├── packages/            # shared libraries
│   ├── sdk/                   # core embeddable SDK
│   ├── sdk-loader/            # tiny loader
│   ├── sdk-react/             # React wrapper
│   ├── sdk-vue/               # Vue wrapper
│   ├── shared/                # Zod schemas, types
│   ├── db/                    # Drizzle schemas, migrations
│   ├── auth/                  # JWT, API key utilities
│   ├── intent-ontology/       # 12-dimension schema
│   └── compliance/            # linters, consent utilities, retention
├── infra/
│   ├── terraform/
│   ├── clickhouse/
│   └── observability/
├── tests/
│   ├── e2e/
│   ├── integration/
│   ├── load/
│   ├── fixtures/
│   ├── visual/
│   └── golden/
├── docs/
│   ├── MASTER_DESIGN.md
│   ├── AGENT_WORKFLOW.md
│   ├── TICKET_FORMAT.md
│   ├── CONVENTIONS.md
│   ├── INTERFACES.md
│   ├── DATA_DICTIONARY.md
│   ├── adr/
│   ├── runbooks/
│   └── compliance/
├── backlog/
│   ├── QUEUE.md
│   ├── STATUS.md
│   ├── ESCALATIONS.md
│   ├── HANDOFFS.md
│   └── sprint-N/
│       └── TICKET-XXX.md
└── scripts/             # repo maintenance scripts
```

## Git

### Branch naming

`<agent>/TICKET-XXX-<kebab-summary>`

Examples:
- `backend-engineer/TICKET-042-event-validation`
- `sdk-engineer/TICKET-018-shadow-dom-mount`
- `compliance-engineer/TICKET-029-fair-housing-linter-us`

### Commit messages (Conventional Commits)

`<type>(<scope>): <subject>`

```
feat(ingest): add event validation [TICKET-042]
fix(sdk): handle missing data-tenant attribute gracefully [TICKET-051]
chore(deps): bump preact to 10.22.0 [TICKET-073]
docs(adr): accept ADR-0007 on archetype DP epsilon [TICKET-091]
test(e2e): add cross-region routing scenarios [TICKET-104]
```

Every commit references at least one ticket. Multiple tickets allowed: `[TICKET-042][TICKET-051]`.

### PR titles

Same format as commit subject. Always include ticket ID. Always pass CI before requesting review.

### Squash on merge

PRs squash on merge to keep `main` linear. The squash commit message is the PR title plus a one-paragraph summary.

## TypeScript conventions

- **strict mode** on everywhere
- No `any` without an inline `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>`
- Prefer `unknown` over `any` when type is genuinely unknown
- All public exports have JSDoc
- All async functions return `Promise<T>` explicitly
- Use `interface` for objects, `type` for unions/intersections
- File names: `kebab-case.ts`
- Class names: `PascalCase`
- Function names: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Test files: `<source>.test.ts` co-located with source

## Python conventions

- Black formatter, line length 100
- Ruff linter
- Pydantic v2 for all schemas
- Type hints everywhere (mypy strict)
- File names: `snake_case.py`
- Function and variable names: `snake_case`
- Class names: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`

## Testing

- Tests live next to source: `foo.ts` + `foo.test.ts`
- Or in dedicated test dirs for E2E/integration: `tests/e2e/`, `tests/integration/`
- Use AAA pattern: Arrange, Act, Assert
- One assertion focus per test (multiple expects ok if testing one behavior)
- Test names describe behavior, not implementation: `it('rejects events without tenant_id')` not `it('throws ZodError')`
- Mock external services with MSW (frontend) or pytest-mock (backend Python) or Vitest mocks
- No real network calls in unit tests

## Schemas (this is the big one)

Every cross-module data structure is defined in **one place** as a Zod schema:

```typescript
// packages/shared/src/schemas/event.ts
import { z } from 'zod';

export const EventSchema = z.object({
  event_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  session_id: z.string().min(32).max(64),
  ts: z.number().int().positive(),
  region: z.enum(['eu', 'us', 'uk', 'uae']),
  consent_state: z.enum(['none', 'session-only', 'legitimate-interest', 'consented']),
  type: z.string(),
  schema_version: z.literal(1),
  payload: z.record(z.unknown()),
});

export type Event = z.infer<typeof EventSchema>;
```

Rules:
- One schema per file
- Always export both the schema and the inferred type
- Always include `schema_version` literal
- Validate at every boundary (HTTP, Kafka, Modal call, etc.)
- Never duplicate schemas across packages

## Error handling

- Throw typed errors, catch as close to the boundary as possible
- Define error types in `packages/shared/src/errors/`
- Every error has a stable `code` field (e.g., `ERR_TENANT_NOT_FOUND`, `ERR_RATE_LIMITED`)
- HTTP errors include `code`, `message`, `details`, `request_id`
- Never log secrets in error context
- Use Sentry context tags for tenant/session correlation

## Logging

- Structured logging only (JSON via Pino in TS, structlog in Python)
- Standard fields: `ts`, `level`, `service`, `msg`, `tenant_id?`, `session_id?`, `trace_id?`
- Levels: `debug` (dev only), `info` (lifecycle events), `warn` (recoverable issues), `error` (failed operations), `fatal` (process death)
- No PII in log messages — use IDs, hashes, or redacted markers
- Log volume budget: 1KB per request average

## API design

- All public HTTP APIs versioned: `/v1/...`
- Resource-oriented URLs, plural nouns: `/v1/tenants/{tenant_id}/listings`
- Standard methods: GET (read), POST (create), PATCH (update), DELETE (delete)
- Standard responses: 200 (ok), 201 (created), 204 (no content), 400 (bad request), 401 (unauthenticated), 403 (forbidden), 404 (not found), 409 (conflict), 422 (validation), 429 (rate limited), 5xx (our fault)
- Every error response includes `code`, `message`, `request_id`
- Pagination: cursor-based with `?cursor=...&limit=...` (max limit 100)
- All list responses include `next_cursor` (or null when end reached)

## Database

- All tables have: `id` (UUID), `tenant_id` (UUID), `created_at`, `updated_at`
- Soft delete: `deleted_at TIMESTAMPTZ NULL` (default queries filter `deleted_at IS NULL`)
- Foreign keys always indexed
- Migrations are forward-only and idempotent
- Migration files named `NNNN_description.sql` zero-padded to 4 digits
- Never `DROP COLUMN` in production — deprecate, then remove in later release
- RLS policy on every tenant-scoped table

## Performance budgets (CI-enforced)

| Service | p95 latency target |
|---|---|
| `apps/ingest` | 50ms |
| `apps/decision-api` (cached path) | 80ms |
| `apps/decision-api` (LLM path) | 2000ms |
| Postgres queries | 50ms |
| ClickHouse dashboard queries | 200ms |
| ClickHouse analytical queries | 30s |

## Bundle size budgets (CI-enforced)

| Bundle | Budget gzip |
|---|---|
| `@estalara/sdk-loader` | 2 KB |
| `@estalara/sdk` Tier 1 | 25 KB |
| `@estalara/sdk` Tier 1+2 | 40 KB |
| `@estalara/sdk` Tier 1+2+3 | 80 KB |
| `@estalara/sdk-react` (delta) | +5 KB |

## Security

- All secrets in Doppler, never in committed files
- All inputs validated with Zod / Pydantic
- All HTTP endpoints rate-limited
- All cross-origin endpoints have explicit CORS allowlist
- All passwords/tokens hashed with bcrypt or argon2
- All SQL parameterized via Drizzle / SQLAlchemy
- All HTML sanitized via DOMPurify before render
- All shell commands escaped via shell-quote

## Documentation

- Every public function has JSDoc/docstring with at least: description, params, returns, example
- Every public package has a `README.md` at its root
- Every cross-cutting concept has an entry in `docs/`
- ADRs for non-obvious decisions

## When in doubt

1. Read `CLAUDE.md`
2. Read `docs/MASTER_DESIGN.md`
3. Search existing ADRs in `docs/adr/`
4. Escalate via `backlog/ESCALATIONS.md`
