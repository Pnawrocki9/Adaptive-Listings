-- local-supabase-shim.sql — make a plain Postgres container accept this repo's migration chain.
--
-- FOLLOW-818. The Drizzle migrations in `packages/db/migrations/` are written against a SUPABASE
-- Postgres: their RLS policies call `auth.jwt()` / `auth.uid()` and their grants name the
-- `authenticated` / `anon` / `service_role` roles. A vanilla `supabase/postgres` CONTAINER ships the
-- extensions but NOT that auth layer (it is provisioned by the hosted platform, not the image), so
-- `pnpm db:migrate` against a fresh container dies on migration 0004 with
-- `function auth.jwt() does not exist` — after the migrator has already created the `drizzle`
-- bookkeeping schema, which makes the failure look like a corrupt DB rather than a missing shim.
--
-- Apply this ONCE, before the first `pnpm db:migrate`, to a LOCAL database only:
--
--   docker exec -i al_pg_local psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
--     < packages/db/scripts/local-supabase-shim.sql
--
-- ⚠️ Never run this against Supabase (any environment). Hosted projects already define these
-- objects for real; `CREATE OR REPLACE` here would overwrite the platform's own definitions with
-- these stubs. It is idempotent and safe to re-run locally.
--
-- The function bodies mirror Supabase's own (they read the GUCs PostgREST sets per request). No
-- local caller sets those GUCs, so every function returns NULL — which is the point: RLS policies
-- must PARSE for the migration to apply, and the control plane reaches this database through
-- `DATABASE_URL_ADMIN` (service role, RLS-exempt), so their runtime verdict is not exercised here.
-- Anything that depends on a non-NULL claim is a hosted-Supabase test, not a local one.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    nullif(current_setting('request.jwt', true), '')
  )::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  select nullif(current_setting('request.jwt.claim.email', true), '')::text;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
