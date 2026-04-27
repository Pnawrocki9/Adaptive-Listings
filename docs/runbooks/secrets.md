# Secrets Management Runbook

**Owner:** devops-engineer **Last updated:** 2026-04-27 **Relates to:** TICKET-002, `doppler.yaml`,
`.env.example`, `scripts/doppler-bootstrap.sh`

---

## Overview

All secrets for Estalara Adaptive Listings are managed through **Doppler**. No secrets are committed
to git — not even in `.env` files. The `.env.example` file at the repo root documents every expected
variable with a description and an empty value, serving as a reference only.

This runbook covers: installing the CLI, authenticating, local setup, adding/rotating secrets, CI
integration, and common troubleshooting.

---

## 1. Installing the Doppler CLI

### macOS (Homebrew)

```bash
brew install dopplerhq/cli/doppler
```

### Linux / WSL

```bash
curl -Ls https://cli.doppler.com/install.sh | sudo sh
```

Or without sudo (user-local install):

```bash
curl -Ls https://cli.doppler.com/install.sh | sh
```

### Windows (Scoop)

```powershell
scoop bucket add doppler https://github.com/DopplerHQ/scoop-doppler.git
scoop install doppler
```

Verify installation:

```bash
doppler --version
```

---

## 2. Authenticating

Run once per machine (or after your token expires):

```bash
doppler login
```

This opens a browser window to complete OAuth against your Doppler account. After success, a token
is stored in `~/.config/doppler/.doppler.yaml` (Linux/macOS) or the equivalent Windows path.

To verify authentication:

```bash
doppler me
```

---

## 3. First-time project setup (new contributor)

The fastest path is the bootstrap script:

```bash
bash scripts/doppler-bootstrap.sh
```

This script:

1. Checks if the Doppler CLI is installed (exits with install instructions if not).
2. Runs `doppler login` if you are not yet authenticated.
3. Runs `doppler setup` to configure the local directory for the `estalara-adaptive-listings`
   project with the `dev` config.
4. Smoke-tests secret access and reports how many secrets are available.

To set up manually:

```bash
doppler setup --project estalara-adaptive-listings --config dev
```

You must be invited to the Doppler project by a team member before you can access secrets. Contact
Piotr or Rafał to be added.

---

## 4. Running services locally with secrets

Use the `dev:secrets` script (wraps `doppler run`):

```bash
pnpm run dev:secrets
```

This injects all secrets from Doppler into the environment before starting the Turborepo dev
processes. The plain `pnpm dev` still works if you provide secrets via another mechanism (e.g.,
manual environment variables for CI scripts), but `pnpm run dev:secrets` is the recommended path.

To run any arbitrary command with secrets injected:

```bash
doppler run -- <your-command>
```

Examples:

```bash
doppler run -- node scripts/some-script.js
doppler run -- pnpm test
```

---

## 5. Adding a new secret

All secrets require a PR + peer review before being added to Doppler. The process:

1. **Open a PR** describing the new secret: its name, which service needs it, what it controls, and
   its sensitivity level (public, internal, secret, restricted).
2. **Get approval** from at least one other team member.
3. **Add the secret** to Doppler (all three configs — dev, staging, prod — unless it genuinely only
   applies to one):
   ```bash
   doppler secrets set MY_NEW_SECRET --project estalara-adaptive-listings --config dev
   doppler secrets set MY_NEW_SECRET --project estalara-adaptive-listings --config staging
   doppler secrets set MY_NEW_SECRET --project estalara-adaptive-listings --config prod
   ```
4. **Update `.env.example`** with the variable name and a one-line description (no value). Open a
   follow-up commit in the same branch.
5. **Update any service** that consumes the new secret (usually covered by the feature ticket that
   introduces the secret).

Naming conventions:

- Use `SCREAMING_SNAKE_CASE`
- Prefix with the vendor/service name: `SUPABASE_`, `CLOUDFLARE_`, `REDPANDA_`, etc.
- Avoid abbreviations unless they are universally understood (e.g., `JWT`, `URL`, `API`)

---

## 6. Rotating a secret

Rotation is triggered when:

- A secret is suspected to be compromised
- A service account password expires
- A vendor requires periodic rotation

Steps:

1. Generate a new credential in the vendor dashboard.
2. Update the secret in Doppler for the target config(s):
   ```bash
   doppler secrets set MY_SECRET --project estalara-adaptive-listings --config prod
   ```
3. Doppler syncs changes to running services automatically if the service uses the Doppler Secrets
   Manager SDK or restarts after each secret change. For Modal/Cloudflare Workers, a redeployment is
   needed to pick up the new value.
4. Revoke the old credential in the vendor dashboard **after** confirming the new one works.
5. Note the rotation in the Doppler audit log (visible in the Doppler dashboard under Activity).

---

## 7. CI integration

GitHub Actions receives secrets via the `DOPPLER_TOKEN_DEV` repository secret. To set it up:

1. Create a Doppler service token scoped to the `dev` config:
   ```bash
   doppler configs tokens create ci-github-dev \
     --project estalara-adaptive-listings \
     --config dev \
     --plain
   ```
2. Copy the token value.
3. In the GitHub repository → Settings → Secrets and variables → Actions → New repository secret:
   - Name: `DOPPLER_TOKEN_DEV`
   - Value: (paste the token)

The CI workflow (`ci.yml`) has a `doppler-verify` job that:

- Runs `dopplerhq/cli-action@v3` to install the CLI
- Runs `doppler me` to verify the token is valid
- Is **conditioned on `secrets.DOPPLER_TOKEN_DEV != ''`** so PRs from forks (which cannot access
  secrets) still pass CI without the token.

When the token is not set (fork PRs, freshly cloned repos without the secret), CI prints a skip note
and continues. No hard failure.

---

## 8. Troubleshooting

### `doppler: command not found`

The Doppler CLI is not installed. See Section 1 above.

### `Error: You must be authenticated`

Run `doppler login`. Your token may have expired or been revoked.

### `Error: project 'estalara-adaptive-listings' not found`

You have not been invited to the Doppler project. Ask Piotr or Rafał to add your account.

### `pnpm run dev:secrets` exits immediately

The `doppler run` command exits if Doppler is not installed or not authenticated. Check `doppler me`
and re-run `bash scripts/doppler-bootstrap.sh`.

### Secret is present in Doppler but not visible in the process

Check which config is active: `doppler configure`. Make sure it matches the environment you expect
(`dev`, `staging`, or `prod`). If you recently added the secret, wait a few seconds for Doppler's
CDN to propagate.

### CI `doppler-verify` job fails

1. Verify the `DOPPLER_TOKEN_DEV` secret is set in GitHub (repo Settings → Secrets).
2. Verify the token has not expired:
   `doppler configs tokens list --project estalara-adaptive-listings --config dev`
3. Rotate the token using the steps in Section 6 and update the GitHub secret.

---

## See also

- [Doppler documentation](https://docs.doppler.com/)
- `.env.example` — complete list of all expected secrets with descriptions
- `scripts/doppler-bootstrap.sh` — first-time setup script
- `docs/CONVENTIONS.md` — overall security conventions for this repo
