#!/usr/bin/env node
/**
 * Estalara Adaptive Listings — LOCAL mock decision + ingest server (LLM demo).
 *
 * A dev-only test double for the decision API. For the selected archetype it generates the adapted
 * headline + long-form description by calling Claude, GROUNDED in the REAL listing data fetched from
 * a local backend (RAG), with the same factual-accuracy guardrail as production. Results are cached
 * per archetype (one generation per archetype, like the real /api/adapt/description pipeline).
 *
 * It lets you watch live SDK DOM adaptation in a browser WITHOUT standing up the full stack
 * (ClickHouse / Redpanda / Modal / control-plane). The in-product equivalent is DEMO-001
 * (Archetype Simulator) on admin.estalara.com — this script is the dev/local prototype of it.
 *
 *   - serves the prebuilt SDK IIFE bundle           GET  /estalara-sdk.iife.js
 *   - returns generated adapt directives (headline) POST /adapt
 *   - returns the generated long-form description   GET  /adapt/description
 *   - accepts events + feedback (no-op 200)         POST /v1/events, /api/adapt/feedback
 *   - archetype + model switcher UI (dropdowns)     GET  /  ·  /mock/archetype
 *                                                   (+ /mock/archetype/<id>, /mock/model/<id>, /mock/status)
 *
 * Run from the repo root (needs ANTHROPIC_API_KEY in env via Doppler):
 *   doppler run -p estalara-adaptive-listings -c dev -- node scripts/dev/mock-decision-server.mjs
 * Without the key it falls back to a minimal generic copy so the demo still renders.
 *
 * Env overrides: PORT (9100), SDK_BUNDLE, PROMPT_FILE, BACKEND_URL (http://localhost:8081),
 * DEMO_SLUG, LISTING_BASE_URL (http://localhost:5173), DESCRIPTION_MODEL, ARCHETYPE.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Paths are resolved relative to this file (scripts/dev/) so the script is portable across
// machines and CI — no hardcoded absolute home directory. REPO_ROOT = two levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PORT = Number(process.env.PORT ?? 9100);
const SDK_BUNDLE =
  process.env.SDK_BUNDLE ?? resolve(REPO_ROOT, 'packages/sdk/dist/estalara-sdk.iife.js');
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8081';
const LISTING_BASE_URL = process.env.LISTING_BASE_URL ?? 'http://localhost:5173';
const DEMO_SLUG = process.env.DEMO_SLUG ?? '9-blackberry-pl-palm-coast-fl-32137';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.DESCRIPTION_MODEL ?? 'claude-sonnet-4-6';

// Selectable generation models (dev mirror of FOLLOW-161 — global model switch).
const MODELS = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5 — fast / cheap',
  'claude-sonnet-4-6': 'Sonnet 4.6 — balanced (default)',
  'claude-opus-4-8': 'Opus 4.8 — max quality',
};
let currentModel = MODELS[MODEL] ? MODEL : 'claude-sonnet-4-6';

// 13 reachable archetypes on residential app.estalara.com (Master Design §D.6: 18 − 5 chat-only).
// Each carries a short persona used to frame the LLM generation.
const PERSONAS = {
  yield_hunter: 'a buy-to-let investor focused on rental yield, cash flow, occupancy and ROI',
  vacation_rental_investor:
    'a short-term / holiday-rental investor focused on nightly rates, seasonal demand and tourist appeal',
  flip_investor:
    'a renovate-and-resell investor focused on value-add potential and short-term appreciation',
  portfolio_builder:
    'an investor scaling a multi-property portfolio, focused on diversification and repeatable returns',
  family_buyer:
    'a family seeking a safe, spacious home — bedrooms, schools, a yard and a quiet neighbourhood',
  first_time_buyer:
    'a first-time buyer focused on affordability, move-in readiness and low maintenance',
  upsizer:
    'a growing family needing more space — extra rooms and a bigger lot than their current home',
  downsizer:
    'an empty-nester downsizing — low maintenance, single-level comfort, lock-up-and-leave ease',
  luxury_buyer: 'a high-end buyer focused on design, premium finishes, privacy and exclusivity',
  remote_worker: 'a remote worker needing a home office, connectivity, quiet and work-life balance',
  lifestyle_expat:
    'someone relocating for lifestyle — relaxed coastal/sun living, community and easy relocation',
  second_home_buyer:
    'a second-home / holiday-home buyer — a low-upkeep getaway with lifestyle appeal',
  neutral:
    'a general buyer with no strong archetype — give balanced, factual, broadly appealing copy',
};

let currentArchetype = process.env.ARCHETYPE ?? 'yield_hunter';
let listingCache = null; // raw listing JSON from backend (RAG context)
const genCache = {}; // archetype -> { headline, description }

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Estalara-API-Key, x-session-id',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, obj, origin) {
  cors(res, origin);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

/** Fetch the real listing once (RAG grounding context). */
async function fetchListing() {
  if (listingCache) return listingCache;
  try {
    const r = await fetch(
      `${BACKEND}/api/v1/listing/details/slug?slug=${encodeURIComponent(DEMO_SLUG)}&locale=EN`,
    );
    listingCache = r.ok ? await r.json() : {};
  } catch {
    listingCache = {};
  }
  return listingCache;
}

function fallbackCopy(arche) {
  return {
    headline: 'Discover what makes this property a standout opportunity.',
    description:
      'A well-located property presented with its key facts. (LLM generation unavailable — set ANTHROPIC_API_KEY to see archetype-adapted copy.)',
    archetype: arche,
  };
}

async function callClaude(userContent, systemContent) {
  const body = {
    model: currentModel,
    // Generous budget so the body + the <verified_facts_used> audit block are not truncated
    // (truncation leaves the block unclosed → it cannot be stripped). Prod scales max_tokens with
    // the original length and discards truncated generations (FOLLOW-162, resolved 2026-06-02);
    // this demo just uses a flat generous cap.
    max_tokens: 2000,
    messages: [{ role: 'user', content: userContent }],
  };
  if (systemContent) body.system = systemContent;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d.content ?? []).map((b) => b.text ?? '').join('');
}

// Read the LIVE production description system prompt so the demo exercises the REAL prompt.
// Edit the prod file → the next (re)generation uses the updated prompt — tight iterate loop.
// NOTE (FOLLOW-165): this regex-scrapes the template literal; it assumes the assignment stays
// `_SONNET_SYSTEM_PROMPT_TEMPLATE = """..."""` with no `"""` inside the body.
const PROD_PROMPT_FILE =
  process.env.PROMPT_FILE ??
  resolve(REPO_ROOT, 'apps/llm-gateway/src/jobs/generate_description.py');
async function readProdPrompt() {
  try {
    const src = await readFile(PROD_PROMPT_FILE, 'utf8');
    const m = src.match(/_SONNET_SYSTEM_PROMPT_TEMPLATE[^=]*=\s*"""\\?\r?\n?([\s\S]*?)"""/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
function stripVerifiedFacts(text) {
  return text.replace(/<verified_facts_used>[\s\S]*?<\/verified_facts_used>/g, '').trim();
}

/**
 * Generate (and cache) archetype-adapted headline + description, grounded in the real listing.
 * The DESCRIPTION uses the live production system prompt from generate_description.py (so the demo
 * reflects exactly what prod would emit). The HEADLINE is a small separate call (in prod it comes
 * from the /adapt playbook directive, not this pipeline).
 */
async function generate(arche) {
  if (genCache[arche]) return genCache[arche];
  const persona = PERSONAS[arche] ?? PERSONAS.neutral;
  if (!ANTHROPIC_API_KEY) {
    genCache[arche] = fallbackCopy(arche);
    return genCache[arche];
  }
  const listing = await fetchListing();
  const listingJson = JSON.stringify(listing).slice(0, 4000);
  const original = typeof listing.description === 'string' ? listing.description : '';
  try {
    // DESCRIPTION — real prod system prompt + the same user-message shape as generate_description.py.
    const tmpl = await readProdPrompt();
    let description;
    if (tmpl) {
      const system = tmpl.replace(/\{archetype\}/g, arche).replace(/\{locale\}/g, 'en');
      const user = [
        `archetype: ${arche}`,
        `locale: en`,
        '',
        'archetype_voice_pattern:',
        persona,
        '',
        'archetype_hard_rules:',
        '(none provided)',
        '',
        'original_description:',
        original || '(empty)',
        '',
        'listing_context (JSON):',
        listingJson,
      ].join('\n');
      description =
        stripVerifiedFacts(await callClaude(user, system)) || fallbackCopy(arche).description;
    } else {
      description = fallbackCopy(arche).description;
    }
    // HEADLINE — small separate generation (factual, archetype-framed).
    const hRaw = await callClaude(
      `Write ONE compelling listing headline (max 90 chars, no surrounding quotes) for a ${arche} buyer (${persona}), strictly factually accurate to this listing data. Return ONLY the headline text, nothing else.\n\nListing (JSON): ${listingJson}`,
    );
    const headline =
      hRaw
        .trim()
        .split('\n')[0]
        .replace(/^["']|["']$/g, '')
        .slice(0, 120) || fallbackCopy(arche).headline;
    genCache[arche] = { headline, description, archetype: arche };
  } catch (err) {
    console.warn(`[mock] generation failed for ${arche}:`, err.message);
    genCache[arche] = fallbackCopy(arche);
  }
  return genCache[arche];
}

function archetypePageHtml() {
  const opts = Object.keys(PERSONAS)
    .map((a) => `<option value="${a}"${a === currentArchetype ? ' selected' : ''}>${a}</option>`)
    .join('');
  const modelOpts = Object.entries(MODELS)
    .map(
      ([id, label]) =>
        `<option value="${id}"${id === currentModel ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Estalara mock — archetype + model</title>
<style>body{font:16px system-ui;margin:40px;max-width:680px}select{font:16px system-ui;padding:8px;min-width:280px}
.row{margin:16px 0}#status{color:#666}#out{white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px;margin-top:12px}label{display:inline-block;min-width:120px}</style></head>
<body><h1>Estalara — demo switcher</h1>
<div class="row">Current: archetype <b id="cur">${currentArchetype}</b> · model <b id="curm">${currentModel}</b></div>
<div class="row"><label>LLM model:</label><select id="model">${modelOpts}</select></div>
<div class="row"><label>Archetype:</label><select id="sel">${opts}</select> <button id="go">Switch + generate</button></div>
<div class="row" id="status"></div>
<pre id="out"></pre>
<div class="row">Then reload the listing tab: <a href="${LISTING_BASE_URL}/en/listing/${DEMO_SLUG}" target="_blank">open listing</a></div>
<script>
const sel=document.getElementById('sel'),mdl=document.getElementById('model'),st=document.getElementById('status'),out=document.getElementById('out'),cur=document.getElementById('cur'),curm=document.getElementById('curm');
mdl.onchange=async()=>{st.textContent='Switching model (clears cached copy)…';const r=await fetch('/mock/model/'+mdl.value);const j=await r.json();curm.textContent=j.model;st.textContent='Model set to '+j.model+' — pick an archetype and Switch + generate.';};
document.getElementById('go').onclick=async()=>{const a=sel.value;st.textContent='Generating with '+mdl.value+' (grounded in the real listing)…';out.textContent='';
const r=await fetch('/mock/archetype/'+a);const j=await r.json();cur.textContent=j.archetype;st.textContent='Done — reload the listing tab to see it.';
out.textContent='headline: '+(j.generated?.headline||'')+'\\n\\ndescription: '+(j.generated?.description||'');};
</script></body></html>`;
}

function buildAdaptResponse(sessionId, gen) {
  const mk = (slot, value) => ({
    type: 'text',
    slot,
    value,
    archetype: currentArchetype,
    confidence: 0.92,
  });
  return {
    adapt_decision_id: randomUUID(),
    session_id: sessionId ?? 'unknown',
    archetype: currentArchetype,
    confidence: 0.92,
    similarity: 0.9,
    tier: 2,
    source: 'llm_full',
    generated_at: new Date().toISOString(),
    directives: [mk('headline', gen.headline)],
  };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`[mock] ${req.method} ${path}`);

  if (req.method === 'OPTIONS') {
    cors(res, origin);
    res.statusCode = 204;
    return res.end();
  }

  // Bare-URL convenience: send / and /mock to the switcher UI so http://localhost:9100
  // lands directly on the archetype + model dropdowns instead of a 404.
  if (req.method === 'GET' && (path === '/' || path === '/mock')) {
    res.writeHead(302, { Location: '/mock/archetype' });
    return res.end();
  }

  if (req.method === 'GET' && path === '/estalara-sdk.iife.js') {
    try {
      const js = await readFile(SDK_BUNDLE);
      cors(res, origin);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.statusCode = 200;
      return res.end(js);
    } catch {
      return json(res, 500, { error: `SDK bundle not found at ${SDK_BUNDLE}` }, origin);
    }
  }

  // Archetype switcher UI (dropdown)
  if (req.method === 'GET' && path === '/mock/archetype') {
    cors(res, origin);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(archetypePageHtml());
  }
  // Switch + (pre)generate:  /mock/archetype/family_buyer
  if (req.method === 'GET' && path.startsWith('/mock/archetype/')) {
    const id = decodeURIComponent(path.slice('/mock/archetype/'.length));
    if (!PERSONAS[id])
      return json(res, 400, { error: 'unknown archetype', known: Object.keys(PERSONAS) }, origin);
    currentArchetype = id;
    delete genCache[id]; // force a fresh generation so edits to the prod prompt are reflected
    const gen = await generate(id);
    return json(res, 200, { ok: true, archetype: id, generated: gen }, origin);
  }
  if (req.method === 'GET' && path === '/mock/status') {
    return json(
      res,
      200,
      { archetype: currentArchetype, model: currentModel, known: Object.keys(PERSONAS) },
      origin,
    );
  }
  // Switch generation model (clears cache so copy regenerates with the new model):  /mock/model/<id>
  if (req.method === 'GET' && path.startsWith('/mock/model/')) {
    const id = decodeURIComponent(path.slice('/mock/model/'.length));
    if (!MODELS[id])
      return json(res, 400, { error: 'unknown model', known: Object.keys(MODELS) }, origin);
    currentModel = id;
    for (const k of Object.keys(genCache)) delete genCache[k];
    return json(res, 200, { ok: true, model: currentModel }, origin);
  }

  // Long-form description — GET /adapt/description?listing_id&archetype&tier&locale
  if (req.method === 'GET' && path === '/adapt/description') {
    const q = url.searchParams.get('archetype');
    const arche = PERSONAS[q] ? q : currentArchetype;
    const gen = await generate(arche);
    return json(
      res,
      200,
      {
        description: gen.description,
        source: 'ai_cached',
        locale: url.searchParams.get('locale') ?? 'en',
        generated_at: new Date().toISOString(),
      },
      origin,
    );
  }

  // Decision API — POST /adapt (headline directive, LLM-generated)
  if (req.method === 'POST' && path === '/adapt') {
    let raw = '';
    req.on('data', (ch) => (raw += ch));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* ignore */
      }
      const gen = await generate(currentArchetype);
      return json(res, 200, buildAdaptResponse(body.session_id, gen), origin);
    });
    return;
  }

  // Ingest + feedback no-ops
  if (req.method === 'POST' && (path === '/v1/events' || path.endsWith('/adapt/feedback'))) {
    let raw = '';
    req.on('data', (ch) => (raw += ch));
    req.on('end', () => json(res, 200, { accepted: true }, origin));
    return;
  }

  return json(res, 404, { error: 'not found', path }, origin);
});

server.listen(PORT, () => {
  console.log(
    `[mock-decision] listening on http://localhost:${PORT}  archetype=${currentArchetype}`,
  );
  console.log(
    `[mock-decision] model=${currentModel}  key=${ANTHROPIC_API_KEY ? 'set' : 'MISSING (fallback copy)'}`,
  );
  console.log(`[mock-decision] switcher UI: http://localhost:${PORT}/  (→ /mock/archetype)`);
});
