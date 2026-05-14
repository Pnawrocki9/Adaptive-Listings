# TICKET-031 — SDK Tier 1 Core (Config, Session, Events, Observer)

**Sprint:** 3 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 8 **Status:** DONE
**Completed:** 2026-05-05T01:25:00Z **PR:** #50 **Depends on:** TICKET-011

## Context

First installable version of the Estalara SDK — the `@estalara/sdk` npm package. Implements the Tier
1 Observer foundation: configuration reading, anonymous session management, event dispatch to the
ingest worker, and behavioral observer setup (scroll, click, intersection).

## What was built (shipped)

- `packages/sdk/src/core/config.ts` — reads `data-*` attributes from the script tag
- `packages/sdk/src/core/session.ts` — SHA-256 session fingerprint (canvas + UA + IP hash),
  `getOrCreateSession()`, page count increment
- `packages/sdk/src/core/events.ts` — `CollectedEvent` type, `dispatchEvents()` (batch + keepalive),
  `collectPageView()`
- `packages/sdk/src/core/observer.ts` — `setupObservers()` — scroll depth, listing intersection
  (IntersectionObserver), click tracking
- `packages/sdk/src/index.ts` — auto-initialization on DOMContentLoaded, batch flushing every 5s,
  visibilitychange + beforeunload flush
- `packages/sdk/package.json` — tsup build configured (IIFE + ESM)
- Fixed `.gitleaks.toml` — moved false-positive paths from invalid `files` key to `paths`

## Unblocks

TICKET-037 (sidebar widget), TICKET-038 (tsup gate) — both are now READY.
