---
id: TICKET-027
title: Dashboard authenticated layout (sidebar + header + route guards)
sprint: 2
priority: P1
agent: backend-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-024, TICKET-025]
produces: [TICKET-028]
affects_files:
  - 'apps/control-plane/src/app/(dashboard)/layout.tsx'
  - 'apps/control-plane/src/app/(dashboard)/page.tsx'
  - 'apps/control-plane/src/components/dashboard/sidebar.tsx'
  - 'apps/control-plane/src/components/dashboard/header.tsx'
  - 'apps/control-plane/src/components/dashboard/tenant-switcher.tsx'
  - 'apps/control-plane/src/components/dashboard/user-menu.tsx'
  - 'apps/control-plane/src/middleware.ts'
context_files:
  - apps/control-plane/* (TICKET-025, TICKET-026)
  - packages/auth/* (TICKET-024)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p1, frontend, dashboard]
---

# TICKET-027: Dashboard authenticated layout

## Summary

Build the authenticated dashboard shell using Next.js App Router route groups:
`(dashboard)/layout.tsx` is the layout for all authenticated pages, with sidebar (nav: Overview,
Listings, Adaptations, Audit, Settings — only first one wired in this ticket), header (logo + tenant
switcher + user menu + theme toggle), and middleware that redirects unauthenticated users to
`/sign-in`. The body region is empty placeholder for now (TICKET-028 fills the Overview page).

## Context

The route group `(dashboard)` wraps all authenticated screens under a shared layout. Middleware
checks Supabase session cookie and redirects on missing/invalid. Tenant switcher in header lets
users switch between tenants they're members of (most users will only have one tenant in MVP, but
multi-tenant from day 1 is cheap to build later).

Sidebar nav items are placeholders except Overview — this lets TICKET-028 (overview page) plug in
immediately.

## Scope

### In scope

- Next.js middleware (`src/middleware.ts`):
  - Matcher: all routes under `/dashboard`, `/listings`, `/adaptations`, `/audit`, `/settings`
  - Reads Supabase session cookie via SSR helpers; on missing/invalid → redirect to
    `/sign-in?next=<url>`
  - On valid → continue; injects `X-User-ID` header for downstream
- Layout `src/app/(dashboard)/layout.tsx`:
  - Server component
  - Loads current user, list of tenants user is member of, currently selected tenant (from cookie
    `selected_tenant_id`)
  - Renders `<DashboardShell>` with sidebar + header + body slot
  - Provides tenant context to client components
- Components:
  - `<Sidebar>`: vertical nav with Lucide icons, active link highlighting, collapsible to icon-only
    on mobile (use shadcn `Sheet` for mobile drawer)
  - `<Header>`: Estalara logo (text+mark), tenant switcher dropdown (lists user's tenants, click →
    set cookie + reload), user menu (Avatar + dropdown: profile, sign out), theme toggle button
  - `<TenantSwitcher>` (client component): shadcn DropdownMenu with current tenant name + chevron;
    on select calls `POST /api/v1/session/tenant` (creates simple route or sets cookie via Server
    Action)
  - `<UserMenu>` (client component): shadcn Avatar + DropdownMenu with sign out (calls Supabase
    signOut + redirect to `/sign-in`)
- `(dashboard)/page.tsx` placeholder: just "Welcome to your dashboard" (will be replaced/redirect to
  `/dashboard/overview` in TICKET-028)

### Out of scope

- Real overview page content (TICKET-028)
- Listings, Adaptations, Audit, Settings pages (later sprints)
- Server Action for tenant switch — can use Route Handler instead, simpler
- Notification bell, search bar (Sprint 8)
- Onboarding banner / setup checklist (Sprint 7)

## Acceptance criteria

- [ ] AC1: `src/middleware.ts` exists, matcher set correctly, redirects unauth users to
      `/sign-in?next=<url>`
- [ ] AC2: Authenticated user accessing `/dashboard` sees sidebar + header + body shell
- [ ] AC3: Sidebar has 5 nav items with Lucide icons; only "Overview" link is active/clickable,
      others are visually disabled with "Coming soon" tooltip
- [ ] AC4: Header has Estalara logo, tenant switcher (shows current tenant), user menu with sign
      out, theme toggle (uses next-themes)
- [ ] AC5: Tenant switcher dropdown lists all tenants user is member of; selecting a tenant updates
      `selected_tenant_id` cookie + reloads
- [ ] AC6: User menu sign-out calls Supabase signOut + redirects to `/sign-in`
- [ ] AC7: Layout is mobile-responsive: sidebar collapses to icon-only ≤ md breakpoint, drawer
      pattern below md
- [ ] AC8: a11y: keyboard navigation works for sidebar + header + dropdowns, focus rings visible,
      contrast OK
- [ ] AC9: Tests:
  - Unit: middleware redirects on missing session, allows on valid
  - Component: sidebar renders all items, only Overview clickable
  - Component: tenant switcher lists all user tenants
  - At least 6 tests
- [ ] AC10: PR title `feat(control-plane): dashboard layout + auth guards [TICKET-027]`

## Implementation guidance

```typescript
// src/middleware.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = ['/dashboard', '/listings', '/adaptations', '/audit', '/settings'].some((p) =>
    req.nextUrl.pathname.startsWith(p),
  );

  if (isProtected && !user) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/listings/:path*',
    '/adaptations/:path*',
    '/audit/:path*',
    '/settings/:path*',
  ],
};
```

For sidebar, mobile responsiveness uses shadcn Sheet:

```tsx
// src/components/dashboard/sidebar.tsx (client component)
'use client';

import { LayoutDashboard, Building2, Sparkles, ScrollText, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, enabled: true },
  { href: '/listings', label: 'Listings', icon: Building2, enabled: false },
  { href: '/adaptations', label: 'Adaptations', icon: Sparkles, enabled: false },
  { href: '/audit', label: 'Audit', icon: ScrollText, enabled: false },
  { href: '/settings', label: 'Settings', icon: Settings, enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="hidden md:flex w-56 shrink-0 flex-col gap-1 border-r p-3">
      {items.map((item) => (
        <SidebarItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
      ))}
    </nav>
  );
}

function SidebarItem({
  href,
  label,
  icon: Icon,
  enabled,
  active,
}: {
  href: string;
  label: string;
  icon: any;
  enabled: boolean;
  active: boolean;
}) {
  const className = cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    enabled ? 'hover:bg-accent' : 'cursor-not-allowed opacity-50',
    active && 'bg-accent text-accent-foreground',
  );

  if (!enabled) {
    return (
      <div className={className} title="Coming soon">
        <Icon className="h-4 w-4" /> {label}
      </div>
    );
  }
  return (
    <Link href={href} className={className}>
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}
```

## Test plan

- Unit: middleware test with mock Supabase session
- Component tests using @testing-library/react: sidebar renders, tenant switcher lists tenants,
  sign-out calls supabase.auth.signOut
- Manual: log in via /sign-in, see dashboard shell, switch tenant, sign out

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-027-dashboard-layout`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-027 → TICKET-028 (overview page plugs into this layout)

## Notes

- "Selected tenant" cookie persistence is intentionally simple. Real session storage with security
  can come later. For MVP a httpOnly cookie set via Route Handler is fine.
- If the user is a member of zero tenants (edge case if they signed up but never completed
  onboarding), redirect to `/onboarding/start`. Add this case in middleware.
