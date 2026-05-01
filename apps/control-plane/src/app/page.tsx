import Link from 'next/link';
import type React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Landing page for the Estalara control plane.
 *
 * Displays a hero section with headline, subheading, and two CTAs:
 * - Sign in → /sign-in (implemented in TICKET-026)
 * - Try demo → /onboarding (implemented in Sprint 2.5)
 */
export default function Landing(): React.JSX.Element {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Navigation */}
      <header className="flex h-16 items-center justify-between px-6 md:px-12">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">Estalara</span>
          <Badge variant="secondary" className="hidden sm:flex">
            v1.1
          </Badge>
        </div>
        <nav className="flex items-center gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/onboarding">Get started</Link>
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="max-w-3xl space-y-8">
          <Badge variant="outline" className="mb-4 text-sm">
            AI-powered real estate personalization
          </Badge>

          <h1 className="text-5xl font-bold tracking-tight md:text-7xl">
            Estalara <span className="text-muted-foreground">Adaptive Listings</span>
          </h1>

          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            Serve listings tailored to each anonymous buyer in real time — based on chat, behavior,
            questions, and cross-listing journey. Embed in 60 seconds.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="min-w-[160px]">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-w-[160px]">
              <Link href="/onboarding">Try demo</Link>
            </Button>
          </div>
        </div>

        {/* Feature highlights */}
        <div className="mt-24 grid max-w-4xl gap-6 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
            <div className="mb-3 text-2xl font-bold">60s</div>
            <p className="text-sm font-medium">Time to embed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Drop a script tag. No backend changes required.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
            <div className="mb-3 text-2xl font-bold">3</div>
            <p className="text-sm font-medium">Integration tiers</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Observer, Augment, or Native — pick your level of control.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
            <div className="mb-3 text-2xl font-bold">&lt;80ms</div>
            <p className="text-sm font-medium">Decision latency</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Edge-served adaptation. Invisible to the end user.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex flex-col items-center gap-2 px-6 py-8 text-center text-sm text-muted-foreground sm:flex-row sm:justify-between md:px-12">
        <span>© 2026 Time2Show Inc. All rights reserved.</span>
        <span>
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          {' · '}
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms
          </Link>
        </span>
      </footer>
    </div>
  );
}
