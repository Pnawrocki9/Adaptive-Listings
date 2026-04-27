---
id: TICKET-028
title: Tenant overview page (empty state, placeholder for live metrics)
sprint: 2
priority: P2
agent: backend-engineer
status: BLOCKED
estimated_hours: 3
depends_on: [TICKET-027]
produces: []
affects_files:
  - 'apps/control-plane/src/app/(dashboard)/dashboard/page.tsx'
  - 'apps/control-plane/src/app/(dashboard)/dashboard/loading.tsx'
  - 'apps/control-plane/src/components/dashboard/overview/**'
  - 'apps/control-plane/src/app/api/v1/tenants/me/route.ts'
context_files:
  - apps/control-plane/* (TICKET-025, 026, 027)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p2, frontend, dashboard]
---

# TICKET-028: Tenant overview page

## Summary

Build the dashboard overview page (`/dashboard`): tenant info card (display name, region, tier,
primary URL, onboarding status, schema health score), quick stats row (placeholder values: events
today, sessions today, active adaptations — all 0 for now since no real data flowing), recent
activity timeline (empty state with helpful copy), and integration snippet card showing the script
tag the user will embed (templated with their tenant's public API key — though we don't generate
that automatically yet, just show the placeholder format).

## Context

This is the screen the user lands on after sign-in / completing onboarding. It needs to look
polished even with zero data — empty states matter for first impression. Real metrics will plug in
when:

- Auto-detect runs (Sprint 2.5) → populates schema health
- Events ingest at scale (Sprint 4+) → populates event counts
- Adaptations ship (Sprint 7) → populates "active adaptations"

For TICKET-028 we show the skeleton with "0" or empty-state copy, plus a setup checklist that nudges
the user toward next steps (install snippet, configure brand voice, invite team — all stubs).

## Scope

### In scope

- Server component `(dashboard)/dashboard/page.tsx`:
  - Reads selected tenant from cookie via TICKET-024 helpers
  - Fetches tenant data from API or directly from db (server-side, with RLS context)
  - Renders overview layout
- Components:
  - `<TenantInfoCard>`: display_name, region badge, tier badge, primary_url with copy button,
    onboarding_status badge, schema_health_score progress bar
  - `<QuickStatsRow>`: 4 stat cards (Events today, Sessions today, Active adaptations, Avg
    conversion lift) — all show 0 / "—" with subtle "no data yet" hint
  - `<ActivityTimeline>`: empty state with icon + "No activity yet. Events will appear here once
    your SDK is installed."
  - `<SetupChecklist>`: 4 items with checkboxes (Site detected, Brand voice configured, SDK
    installed, Team invited) — first one shows pending if onboarding_status != 'ready', others
    always pending in MVP
  - `<IntegrationSnippet>`: copy-pasteable `<script>` tag template; shows placeholder API key like
    `pk_live_<your-key>` with a note "API key generation in Sprint 3"
- API route: `GET /api/v1/tenants/me` — returns current tenant data (display_name, region, tier,
  primary_url, onboarding_status, schema_health_score) for the selected tenant; uses TICKET-024
  auth + tenant middleware
- Loading state via `loading.tsx` (Skeleton from shadcn)

### Out of scope

- Real metrics from ClickHouse (Sprint 8 builds analytics dashboard)
- API key generation UI (Sprint 3)
- Team invitation UI (Sprint 7)
- Brand voice configuration UI (Sprint 4)
- Editable tenant settings (Sprint 4 for non-billing fields, Sprint 7 for billing)

## Acceptance criteria

- [ ] AC1: `/dashboard` renders within the (dashboard) layout from TICKET-027
- [ ] AC2: TenantInfoCard shows: display_name (h1), region (badge), tier (badge), primary_url (with
      copy-to-clipboard button), onboarding_status (colored badge: pending=yellow,
      auto_detecting=blue, ready=green, needs_review=red), schema_health_score (progress bar 0-100%)
- [ ] AC3: QuickStatsRow has 4 cards each with: icon, label, value (placeholder 0 or "—"), subtle
      muted "no data yet" microcopy
- [ ] AC4: ActivityTimeline empty state: centered icon + heading + descriptive paragraph + CTA
      button "View installation guide" (link to placeholder /docs)
- [ ] AC5: SetupChecklist with 4 items, each row: checkbox (disabled), label, sub-label, status pill
      (pending / done)
- [ ] AC6: IntegrationSnippet with code block (monospace, syntax highlighted using a lightweight
      highlighter or just `<code>` with bg color), copy button, "API keys coming Sprint 3" note
- [ ] AC7: API route `GET /api/v1/tenants/me`: requires auth + selected tenant; returns 200 with
      tenant data; returns 404 if tenant not found or user not member; uses RLS-enforced query
      (transaction with SET LOCAL)
- [ ] AC8: Loading skeleton renders during data fetch (shadcn Skeleton)
- [ ] AC9: Mobile-responsive: stat row collapses to 2x2 grid below md, cards stack
- [ ] AC10: Tests:
  - Unit: API route — happy path, unauth, no tenant selected, tenant not in user's memberships
  - Component: empty state renders, stats render with 0
  - At least 6 tests
- [ ] AC11: PR title `feat(control-plane): dashboard overview page [TICKET-028]`

## Implementation guidance

```tsx
// apps/control-plane/src/app/(dashboard)/dashboard/page.tsx
import { Suspense } from 'react';
import { TenantInfoCard } from '@/components/dashboard/overview/tenant-info';
import { QuickStatsRow } from '@/components/dashboard/overview/quick-stats';
import { ActivityTimeline } from '@/components/dashboard/overview/activity-timeline';
import { SetupChecklist } from '@/components/dashboard/overview/setup-checklist';
import { IntegrationSnippet } from '@/components/dashboard/overview/integration-snippet';
import { fetchCurrentTenant } from '@/lib/server/tenants';

export default async function DashboardPage() {
  const tenant = await fetchCurrentTenant();
  if (!tenant) {
    // shouldn't happen — middleware redirects, but safeguard
    return null;
  }

  return (
    <div className="space-y-6 p-6">
      <TenantInfoCard tenant={tenant} />
      <QuickStatsRow />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SetupChecklist tenant={tenant} />
        <IntegrationSnippet tenant={tenant} />
      </div>
      <ActivityTimeline />
    </div>
  );
}
```

For the API route:

```typescript
// apps/control-plane/src/app/api/v1/tenants/me/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerSupabase } from '@/lib/supabase-server';
import { createClient, tenants, tenantMembers } from '@estalara/db';
import { eq, and, isNull, sql } from 'drizzle-orm';

export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });

  const cookieStore = await cookies();
  const selectedTenantId = cookieStore.get('selected_tenant_id')?.value;
  if (!selectedTenantId)
    return NextResponse.json({ error: { code: 'no_tenant_selected' } }, { status: 400 });

  const db = createClient(process.env.DATABASE_URL!);

  // Verify membership
  const membership = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.tenantId, selectedTenantId),
        isNull(tenantMembers.deletedAt),
      ),
    )
    .limit(1);
  if (membership.length === 0)
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Use transaction to set RLS context, then query
  const tenant = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SET LOCAL request.jwt.claims = ${JSON.stringify({ sub: user.id, tenant_id: selectedTenantId })}::jsonb::text`,
    );
    const [t] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.tenantId, selectedTenantId))
      .limit(1);
    return t;
  });

  return NextResponse.json({
    tenant_id: tenant!.tenantId,
    display_name: tenant!.displayName,
    region: tenant!.region,
    tier: tenant!.tier,
    primary_url: tenant!.primaryUrl,
    onboarding_status: tenant!.onboardingStatus,
    schema_health_score: tenant!.schemaHealthScore,
  });
}
```

Stats placeholder component:

```tsx
// apps/control-plane/src/components/dashboard/overview/quick-stats.tsx
import { Activity, BarChart, Sparkles, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';

const stats = [
  { label: 'Events today', value: 0, icon: Activity, hint: 'No data yet' },
  { label: 'Sessions today', value: 0, icon: BarChart, hint: 'No data yet' },
  { label: 'Active adaptations', value: 0, icon: Sparkles, hint: 'Sprint 7+' },
  { label: 'Avg conversion lift', value: '—', icon: TrendingUp, hint: 'Need 7d data' },
];

export function QuickStatsRow() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-4">
          <div className="flex items-start justify-between">
            <div className="text-muted-foreground text-sm">{s.label}</div>
            <s.icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold mt-2">{s.value}</div>
          <div className="text-xs text-muted-foreground mt-1">{s.hint}</div>
        </Card>
      ))}
    </div>
  );
}
```

## Test plan

- Unit: API route tests
- Component: empty state renders, stats render, integration snippet copies on click
- Manual: navigate to /dashboard while signed in, see polished overview

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-028-dashboard-overview`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean

## Notes

- This page is intentionally polished even with zero data. Empty states are first impressions.
- Don't add charts here. Charts come when real data exists (Sprint 8).
