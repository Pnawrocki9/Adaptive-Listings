/**
 * GET /api/sdk — serves the Estalara SDK IIFE bundle.
 *
 * In development: reads from packages/sdk/dist/estalara-sdk.iife.js
 * In production: would be served from CDN (this route is dev-only)
 */
import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export function GET(): NextResponse {
  try {
    const sdkPath = join(process.cwd(), '../../packages/sdk/dist/estalara-sdk.iife.js');
    const content = readFileSync(sdkPath, 'utf-8');
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('// SDK not built yet', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript' },
    });
  }
}
