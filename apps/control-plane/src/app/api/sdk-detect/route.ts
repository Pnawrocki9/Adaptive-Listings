/**
 * GET /api/sdk-detect — serves the Estalara auto-detect companion IIFE bundle. [FOLLOW-325]
 *
 * In development: reads from packages/sdk/dist/estalara-detect.iife.js
 * In production: served as a static asset from public/estalara-detect.iife.js
 *   (Vercel serves `public/` files directly — this route is dev/fallback only).
 *
 * The companion IIFE sets `window.__EStalaraDetect = { detectSiteSchema, extractArchetypeHints }`.
 * It MUST be loaded before the main SDK IIFE so `init()` can read `window.__EStalaraDetect`
 * on cold start.  The snippet generator (`buildSnippet()` in DetectionPreview.tsx) emits
 * the companion tag first, without `async`/`defer`, to guarantee ordered execution.
 *
 * Depends on PR #308 (sdk-engineer/FOLLOW-324-sdk-bundle-size) — the companion artifact
 * `packages/sdk/dist/estalara-detect.iife.js` does not exist until that PR is merged.
 * Before #308 merges, this route returns an empty-but-valid JS comment so page loads
 * do not 500 in development.
 */
import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export function GET(): NextResponse {
  try {
    const detectPath = join(process.cwd(), '../../packages/sdk/dist/estalara-detect.iife.js');
    const content = readFileSync(detectPath, 'utf-8');
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    // Companion bundle not yet built (PR #308 not merged).
    // Return an empty valid JS comment so the browser does not 500.
    // window.__EStalaraDetect will be absent; the main SDK init() handles
    // its absence gracefully (cold-start archetype hints skipped silently).
    return new NextResponse(
      '// estalara-detect: companion bundle not yet built (awaiting PR #308)',
      {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }
}
