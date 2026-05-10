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
};

createServer((req, res) => {
  // Mock ingest endpoint — accepts POST and returns 200
  if (req.url === '/mock-ingest' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  const url = req.url === '/' ? '/e2e/fixtures/index.html' : req.url;
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
