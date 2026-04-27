---
id: TICKET-025
title: apps/control-plane Next.js skeleton + Tailwind + shadcn/ui setup
sprint: 2
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-001, TICKET-002]
produces: [TICKET-026, TICKET-027, TICKET-028]
affects_files:
  - "apps/control-plane/package.json"
  - "apps/control-plane/next.config.mjs"
  - "apps/control-plane/tailwind.config.ts"
  - "apps/control-plane/postcss.config.mjs"
  - "apps/control-plane/components.json"
  - "apps/control-plane/src/app/layout.tsx"
  - "apps/control-plane/src/app/page.tsx"
  - "apps/control-plane/src/app/globals.css"
  - "apps/control-plane/src/lib/utils.ts"
  - "apps/control-plane/src/components/ui/**"
context_files:
  - apps/control-plane/* (existing skeleton from TICKET-001)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p0, backend, frontend, nextjs]
---

# TICKET-025: Next.js skeleton + Tailwind + shadcn/ui

## Summary

Build out the `apps/control-plane` Next.js 15 App Router app from the bare TICKET-001 skeleton: install Tailwind v4, install shadcn/ui CLI + initial components (Button, Input, Card, Toast, Dialog, Form, Sheet, Avatar, Badge), set up dark/light theme, configure metadata, install Inter font, create a landing page that says "Estalara Dashboard" with a sign-in CTA. No real auth or data yet — just a beautiful empty shell.

## Context

shadcn/ui chosen over Radix-only or MUI: vendored components (we own the source), built on Radix primitives (a11y solid), Tailwind-styled (matches our system), zero runtime dependency overhead. Industry standard for SaaS dashboards.

Tailwind v4 (released late 2025) — uses CSS-first config with `@theme` directive. Faster build, smaller output. Worth adopting now.

## Scope

### In scope
- `apps/control-plane/package.json`: add Next.js 15+, React 19, Tailwind v4, shadcn deps
- Configure `next.config.mjs`: experimental App Router, transpilePackages for monorepo deps, Turbopack settings
- `tailwind.config.ts` + `postcss.config.mjs` — Tailwind v4 setup with `@tailwindcss/postcss`
- `components.json` — shadcn config (style: default, base color: slate, css variables)
- Install initial shadcn components (~10 components): Button, Input, Card, Toast, Dialog, Form, Sheet, Avatar, Badge, Skeleton
- `src/lib/utils.ts` — `cn` helper (clsx + tailwind-merge)
- `src/app/layout.tsx` — root layout with Inter font, theme provider, metadata
- `src/app/globals.css` — Tailwind imports, CSS variables for shadcn theming
- `src/app/page.tsx` — landing page with "Estalara Dashboard" headline, "Sign in" button (links to `/sign-in` placeholder)
- Theme: support dark/light, default system
- Build produces optimized output; dev server starts with `pnpm --filter control-plane dev`

### Out of scope
- Real authentication (TICKET-024 already implemented; integration in TICKET-026)
- Sign-in form (TICKET-026)
- Dashboard pages (TICKET-027, 028)
- API routes (per-feature tickets)

## Acceptance criteria

- [ ] AC1: `apps/control-plane/package.json` lists: `next@15`, `react@19`, `react-dom@19`, `tailwindcss@4`, `@tailwindcss/postcss`, `clsx`, `tailwind-merge`, `lucide-react`, shadcn-related deps
- [ ] AC2: `next.config.mjs` has `transpilePackages: ['@estalara/shared', '@estalara/auth', '@estalara/db']`
- [ ] AC3: Tailwind v4 configured: `globals.css` has `@import 'tailwindcss';` and CSS variables block for shadcn theme
- [ ] AC4: `components.json` valid; shadcn CLI usable for adding more components later
- [ ] AC5: 10+ initial shadcn components installed under `src/components/ui/` (vendored, own source)
- [ ] AC6: `src/app/layout.tsx` includes Inter font, theme provider (next-themes), proper metadata (title: "Estalara — Adaptive Listings", description, og tags)
- [ ] AC7: `src/app/page.tsx` renders a polished landing: hero with headline, subheading, prominent "Sign in" CTA button, footer with copyright. Mobile responsive.
- [ ] AC8: `pnpm --filter control-plane dev` starts dev server on port 3000, page accessible
- [ ] AC9: `pnpm --filter control-plane build` produces production build successfully
- [ ] AC10: Lighthouse score (Performance / A11y / Best Practices) ≥ 90 on landing page (manual check, document in PR)
- [ ] AC11: PR title `feat(control-plane): nextjs + tailwind + shadcn skeleton [TICKET-025]`

## Implementation guidance

For shadcn init:

```bash
cd apps/control-plane
pnpm dlx shadcn@latest init
# Follow prompts: default style, slate base color, CSS variables, App Router
pnpm dlx shadcn@latest add button input card toast dialog form sheet avatar badge skeleton
```

For Tailwind v4 (note: different from v3):

```css
/* src/app/globals.css */
@import 'tailwindcss';

@theme {
  --color-background: 0 0% 100%;
  --color-foreground: 222 47% 11%;
  --color-primary: 222 47% 11%;
  --color-primary-foreground: 210 40% 98%;
  /* ... shadcn CSS variables ... */
  --font-sans: 'Inter', system-ui, sans-serif;
}

@layer base {
  * {
    border-color: hsl(var(--border));
  }
  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-sans);
  }
}
```

For layout:

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toast';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Estalara — Adaptive Listings',
  description: 'AI-powered personalization for real estate websites',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

For landing:

```tsx
// src/app/page.tsx
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Landing() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="max-w-3xl text-center space-y-8">
        <h1 className="text-5xl font-bold tracking-tight md:text-7xl">
          Estalara <span className="text-muted-foreground">Adaptive Listings</span>
        </h1>
        <p className="text-xl text-muted-foreground">
          AI-powered personalization for real estate websites. Boost conversion. Embed in 60 seconds.
        </p>
        <div className="flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/onboarding">Try demo</Link>
          </Button>
        </div>
      </div>
      <footer className="absolute bottom-8 text-sm text-muted-foreground">
        © 2026 Time2Show Inc.
      </footer>
    </main>
  );
}
```

## Test plan

- Build succeeds, types check
- Dev server runs without errors
- Manual: open http://localhost:3000, see landing, click sign-in, see 404 (expected — page not built yet)
- Lighthouse: run on landing, document scores in PR

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-025-control-plane-nextjs-skeleton`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-025 → TICKET-026, 027, 028

## Notes

- Tailwind v4 syntax differs from v3 — no `tailwind.config.js` JS config in same way. Use CSS-first config or minimal TS config. Read v4 docs.
- shadcn components are MIT-licensed, vendored; we own + can modify them. Don't treat as external dep.
- The "Try demo" link goes to `/onboarding` (also will 404 until Sprint 2.5). That's fine for this ticket.
