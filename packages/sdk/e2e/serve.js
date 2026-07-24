#!/usr/bin/env node
/**
 * Minimal static file server for SDK e2e tests.
 * Serves dist/ and e2e/fixtures/ on port 4444.
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 4444;

const MIME = {
  '.js': 'application/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  // Mock ingest endpoint — accepts POST and returns 200
  if (req.url === '/mock-ingest' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // Mock control-plane runtime config endpoint (ADR-0011 / ADR-0019 / FOLLOW-623).
  // Returns a PresentationConfigResponse WITH a configured `brand` slice so the E2E can
  // drive the REAL init path: fetchQuizConfig → mergeQuizConfig → rendered widget brand.
  // The `brand` values here stand in for a real tenant's `tenants.brand_config` row.
  if ((req.url ?? '').endsWith('/quiz/public-config') && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        quiz_enabled: true,
        micro_polls_enabled: false,
        language: 'en',
        accent_color: '#2563EB',
        data_source: 'db',
        brand: {
          primary_color: '#1a73e8',
          logo_url: 'http://localhost:4444/e2e/fixtures/brand-logo.svg',
          white_label: true,
        },
      }),
    );
    return;
  }

  // Any other mock-decision call (intent weights, adapt directives) → 204; the SDK
  // handles a non-200 by falling back to defaults, keeping this fixture noise-free.
  if ((req.url ?? '').startsWith('/mock-decision')) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  // Map root and named fixture shortcuts to the e2e/fixtures/ directory.
  let url = req.url ?? '/';
  if (url === '/') {
    url = '/e2e/fixtures/index.html';
  } else if (/^\/[^/]+\.html$/.test(url)) {
    // Top-level .html requests (e.g. /inquiry.html) are served from e2e/fixtures/
    url = `/e2e/fixtures${url}`;
  }
  const filePath = join(ROOT, url);

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'text/plain' });
  res.end(readFileSync(filePath));
}).listen(PORT, () => {
  console.log(`SDK e2e server listening on http://localhost:${PORT}`);
});
