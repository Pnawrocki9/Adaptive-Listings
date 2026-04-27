---
id: TICKET-026
title: Tenant signup flow (skeleton — wizard frame, no auto-detect yet)
sprint: 2
priority: P1
agent: backend-engineer
status: BLOCKED
estimated_hours: 6
depends_on: [TICKET-024, TICKET-025]
produces: []
affects_files:
  - "apps/control-plane/src/app/sign-in/page.tsx"
  - "apps/control-plane/src/app/sign-up/page.tsx"
  - "apps/control-plane/src/app/onboarding/start/page.tsx"
  - "apps/control-plane/src/app/onboarding/wizard/page.tsx"
  - "apps/control-plane/src/app/onboarding/done/page.tsx"
  - "apps/control-plane/src/app/api/v1/tenants/route.ts"
  - "apps/control-plane/src/lib/supabase-client.ts"
  - "apps/control-plane/src/lib/supabase-server.ts"
  - "apps/control-plane/src/components/onboarding/**"
context_files:
  - apps/control-plane/* (TICKET-025)
  - packages/auth/* (TICKET-024)
  - packages/db/src/schema/tenants.ts (TICKET-021)
  - docs/MASTER_DESIGN.md (sections B.4 — Magic Link onboarding)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p1, backend, frontend, onboarding]
---

# TICKET-026: Tenant signup flow skeleton

## Summary

Build the onboarding wizard frame: sign-up form (email + password via Supabase Auth) → wizard with 4 steps (display name, region, tier choice, primary URL) → "Done!" screen with placeholder where auto-detect status will live. Backend route `POST /api/v1/tenants` creates the tenant + admin tenant_member binding for the new user. **No auto-detection logic in this ticket** — that's Sprint 2.5. The wizard's "primary URL" step accepts a URL but only stores it; the user sees a "We'll detect your site shortly" message on the done screen.

## Context

This unblocks the user-facing surface. Once shipped, a real human can sign up, create a tenant, and see the dashboard skeleton (TICKET-027 builds the dashboard layout). The auto-onboarding pipeline (Sprint 2.5) will later replace the "Done!" screen's placeholder with live detection status.

Why a wizard now if auto-detect comes later: the wizard frame, form components, and tenant creation API are all reusable. Sprint 2.5 just hooks the auto-detect job into the "submit" handler instead of skipping it.

## Scope

### In scope
- Pages:
  - `/sign-in` — email + password form using Supabase Auth client
  - `/sign-up` — email + password form; on success redirects to `/onboarding/start`
  - `/onboarding/start` — explainer page with "Begin setup" CTA (1 step)
  - `/onboarding/wizard` — multi-step form: display_name → region → tier → primary_url; uses shadcn Form + react-hook-form + Zod
  - `/onboarding/done` — confirmation, shows tenant_id, primary_url, with placeholder card "Auto-detection coming soon" linking to dashboard
- API route: `POST /api/v1/tenants` — accepts wizard payload, validates with Zod, creates tenant row + tenant_member row (admin role) for current authenticated user; returns `{ tenantId, status }`
- Supabase client setup:
  - `src/lib/supabase-client.ts` — browser client (uses createBrowserClient from @supabase/ssr)
  - `src/lib/supabase-server.ts` — server client for Route Handlers (uses createServerClient with cookies)
- Use shared Zod schemas from `packages/shared` for validation
- Components: reusable `<WizardStep>`, `<RegionPicker>`, `<TierPicker>` in `src/components/onboarding/`

### Out of scope
- Auto-detection (Sprint 2.5)
- Magic Link / SSO / OAuth providers (just email + password for MVP)
- Subscription / billing setup (Sprint 7)
- Email verification flow (Supabase handles it; we just don't gate access on it for MVP)
- Localization (Polish, Spanish, etc.) — Sprint 11

## Acceptance criteria

- [ ] AC1: `/sign-in` page: email + password form, on submit calls Supabase `signInWithPassword`, on success redirects to `/dashboard` (placeholder for now)
- [ ] AC2: `/sign-up` page: same form, on success redirects to `/onboarding/start`
- [ ] AC3: `/onboarding/wizard`: 4-step wizard, "Back" + "Next" navigation, "Submit" on final step calls `POST /api/v1/tenants`, on success redirects to `/onboarding/done?tenantId=...`
- [ ] AC4: `/onboarding/done`: shows tenant info card, "Go to dashboard" CTA, placeholder card "Auto-detection (Sprint 2.5)"
- [ ] AC5: API route `POST /api/v1/tenants`:
  - Requires auth (uses `withAuth` from `packages/auth`)
  - Validates body via Zod (display_name 1-200 chars, region enum, tier enum, primary_url valid URL)
  - Creates `tenants` row with `onboarding_status: 'pending'`
  - Creates `tenant_members` row with `role: 'admin'` linking the new tenant to the current user
  - Returns 201 with `{ tenantId, status: 'pending' }`
  - Returns 400 on validation failure with standard error shape
  - Returns 401 if unauthenticated
- [ ] AC6: Form validation visible inline (uses shadcn Form + react-hook-form), submit button disabled when invalid
- [ ] AC7: All routes use the standard error response shape from TICKET-019
- [ ] AC8: Lighthouse a11y score ≥ 95 on each new page (manual check, document in PR)
- [ ] AC9: Tests:
  - Unit: API route handler — valid input creates tenant + member, invalid rejected, unauth rejected
  - Component: wizard navigation (forward/back) works, submit calls expected endpoint
  - At least 8 tests total
- [ ] AC10: All previous CI checks pass
- [ ] AC11: PR title `feat(control-plane): tenant signup wizard skeleton [TICKET-026]`

## Implementation guidance

```typescript
// apps/control-plane/src/lib/supabase-server.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => cookieStore.set(name, value, options as CookieOptions));
        },
      },
    },
  );
}
```

```typescript
// apps/control-plane/src/app/api/v1/tenants/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase-server';
import { createClient } from '@estalara/db';
import { tenants, tenantMembers } from '@estalara/db';

const TenantCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  region: z.enum(['eu', 'us', 'uk', 'uae']),
  tier: z.enum(['observer', 'augment', 'native']).default('observer'),
  primary_url: z.string().url(),
});

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = TenantCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Invalid input', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const db = createClient(process.env.DATABASE_URL!);

  // Use a transaction so tenant + member are created atomically
  const result = await db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({
      displayName: parsed.data.display_name,
      region: parsed.data.region,
      tier: parsed.data.tier,
      primaryUrl: parsed.data.primary_url,
      onboardingStatus: 'pending',
    }).returning({ tenantId: tenants.tenantId });

    await tx.insert(tenantMembers).values({
      userId: user.id,
      tenantId: tenant!.tenantId,
      role: 'admin',
    });

    return tenant!;
  });

  return NextResponse.json({ tenantId: result.tenantId, status: 'pending' }, { status: 201 });
}
```

For the wizard, use react-hook-form with shadcn Form components. Persist intermediate state in URL search params or React state, NOT localStorage (per artifact rules — though Next.js apps can use it freely; just avoid in shadcn artifacts).

## Test plan

- Unit: API route handler tests using mocked supabase + db
- Component: wizard step navigation, form submission triggers correct fetch
- E2E (optional in this ticket, full E2E in Sprint 11): manual click-through on local dev — sign up, complete wizard, see done screen

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-026-tenant-signup-wizard`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] No new dependencies that aren't already pulled in by shadcn / TICKET-025

## Notes

- The `/dashboard` redirect target doesn't exist yet — TICKET-027 builds it. For this ticket the user lands on a 404 after sign-in. That's acceptable; comment on PR.
- "Auto-detection coming soon" placeholder on `/onboarding/done` is intentional. Sprint 2.5 will replace it with a live status component.
- Don't build a fancy multi-step form library. shadcn Form + simple state suffices.
