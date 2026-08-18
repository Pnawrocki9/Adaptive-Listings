#!/usr/bin/env node
/**
 * Estalara Adaptive Listings — LOCAL mock decision + ingest server (LLM demo).
 *
 * A dev-only test double for the decision API. For the selected archetype it generates the adapted
 * headline + long-form description by calling Claude, GROUNDED in the REAL listing data fetched from
 * a local backend (RAG), with the same factual-accuracy guardrail as production. Results are cached
 * per (listing, archetype) — each listing grounds its own copy, like the real
 * /api/adapt/description pipeline (keyed by listing_id), so content never bleeds across listings.
 *
 * It lets you watch live SDK DOM adaptation in a browser WITHOUT standing up the full stack
 * (ClickHouse / Redpanda / Modal / control-plane). The in-product equivalent is DEMO-001
 * (Archetype Simulator) on admin.estalara.com — this script is the dev/local prototype of it.
 *
 *   - serves the prebuilt SDK IIFE bundle           GET  /estalara-sdk.iife.js
 *   - returns generated adapt directives (headline) POST /adapt
 *   - returns the generated long-form description   GET  /adapt/description
 *   - accepts events + feedback (no-op 200)         POST /v1/events, /api/adapt/feedback
 *   - accepts the quiz completion ping (no-op 200)  POST /quiz/completion
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
import { execFile } from 'node:child_process';
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
// Quiz public-config proxy target (the REAL control plane) + the pilot tenant's SDK key.
// 'off' disables the proxy (SDK falls back to its built-in default tree).
const PUBLIC_CONFIG_UPSTREAM =
  process.env.PUBLIC_CONFIG_UPSTREAM ?? 'https://admin.estalara.com/api';
const PUBLIC_CONFIG_API_KEY = process.env.PUBLIC_CONFIG_API_KEY ?? '000-app-estalara';
let publicConfigCache = null; // { at, body }
const MODEL = process.env.DESCRIPTION_MODEL ?? 'claude-haiku-4-5-20251001';

// Selectable generation models (dev mirror of FOLLOW-161 — global model switch).
const MODELS = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5 — fast / cheap (default)',
  'claude-sonnet-4-6': 'Sonnet 4.6 — balanced',
  'claude-opus-4-8': 'Opus 4.8 — max quality',
};
let currentModel = MODELS[MODEL] ? MODEL : 'claude-haiku-4-5-20251001';

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
  // The five §D.6 chat-only archetypes are still QUIZ-REACHABLE leaves of the default tree
  // (e.g. Investment → commercial). Before these entries, /adapt silently substituted the
  // switcher's archetype for them — the demo showed copy for a DIFFERENT buyer than the quiz
  // resolved. Personas here keep the demo truthful for every quiz path.
  golden_visa_buyer:
    'an investor buying primarily to qualify for residency/golden-visa — focused on eligibility thresholds and low-friction ownership',
  commercial_investor:
    'a commercial property investor — cap rates, tenant covenants, lease terms and business-use potential',
  retiree_relocator:
    'a retiree relocating permanently — single-level living, healthcare access, community and a calm pace',
  diaspora_buyer:
    'a diaspora buyer purchasing in their country of origin — family ties, remote purchase logistics and trusted local contacts',
  student_parent:
    'a parent buying for a studying child — proximity to campus, safety, low upkeep and resale/rental exit',
  neutral:
    'a general buyer with no strong archetype — give balanced, factual, broadly appealing copy',
};

let currentArchetype = process.env.ARCHETYPE ?? 'yield_hunter';
// Keyed by listing id/slug so each listing grounds its OWN generation (mirrors prod,
// where the description pipeline is keyed by listing_id). Without this every listing on
// the site would show the same hardcoded sample listing's copy.
const listingCache = new Map(); // listingKey -> raw listing JSON (RAG context)
const genCache = new Map(); // `${listingKey}::${archetype}` -> { headline, description }
// In-flight dedupe: `${listingKey}::${archetype}` -> Promise<gen>. Concurrent /adapt +
// /adapt/description for the same pair await ONE generation instead of racing two.
const genInflight = new Map();

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    // X-Estalara-Signature is the HMAC the SDK sends on the quiz-completion and
    // feedback pings — without it the browser blocks those requests at preflight.
    'Content-Type, Authorization, X-Estalara-API-Key, X-Estalara-Signature, x-session-id',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, obj, origin) {
  cors(res, origin);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

/**
 * Fetch a specific listing for RAG grounding, cached per listing key. The SDK sends the
 * listing UUID (data-estalara-listing-id); the switcher preview uses DEMO_SLUG. UUIDs hit
 * the by-uuid endpoint, everything else is treated as a slug.
 */
async function fetchListing(listingKey) {
  const key = listingKey || DEMO_SLUG;
  if (listingCache.has(key)) return listingCache.get(key);
  const urlForKey = _UUID_RE.test(key)
    ? `${BACKEND}/api/v1/listing/details?listing-uuid=${encodeURIComponent(key)}&locale=EN`
    : `${BACKEND}/api/v1/listing/details/slug?slug=${encodeURIComponent(key)}&locale=EN`;
  let listing = {};
  try {
    const r = await fetch(urlForKey);
    listing = r.ok ? await r.json() : {};
  } catch {
    listing = {};
  }
  listingCache.set(key, listing);
  return listing;
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
  // Strip the ClickHouse audit block AND the v1.9 archetype-fit-gate tags
  // (<adaptation_verdict> / <neutral_reason>, ADR-0010) so neither leaks into the
  // buyer-visible copy on the FIT path.
  return text
    .replace(/<verified_facts_used>[\s\S]*?<\/verified_facts_used>/g, '')
    .replace(/<adaptation_verdict>[\s\S]*?<\/adaptation_verdict>/gi, '')
    .replace(/<neutral_reason>[\s\S]*?<\/neutral_reason>/gi, '')
    .trim();
}

/** v1.9: true when the model returned a NEUTRAL archetype-fit verdict (ADR-0010). */
function isNeutralVerdict(text) {
  const m = text.match(/<adaptation_verdict>\s*(FIT|NEUTRAL)\s*<\/adaptation_verdict>/i);
  return !!m && m[1].toUpperCase() === 'NEUTRAL';
}

/**
 * FOLLOW-188: leak/format fail-safe — mirror of Python _body_violates_contract.
 *
 * Applied to the stripped FIT body AFTER stripVerifiedFacts() removes the audit block
 * and gate tags. Returns a short reason code on violation, or null if the body is clean.
 * On violation the caller falls back to the agent's original copy (neutral path).
 *
 * Checks, in order:
 *   1. Residual control tags: <adaptation_verdict, <verified_facts_used, <neutral_reason
 *      → "residual_tag"
 *   2. Markdown/structural: ** (bold) or a line beginning with # (heading) → "formatted_body"
 *   3. Leaked reasoning markers (case-insensitive English phrases) → "leak_marker"
 *
 * Marker inclusion/exclusion rationale — kept in sync with Python _BODY_LEAK_MARKERS:
 *   INCLUDED (high-precision reasoning-leak phrases, never in legitimate listing prose):
 *     "my approach", "as an ai", "i cannot", "i will not", "i will write",
 *     "misalign", "ethically", "the facts do not support", "archetype"
 *   EXCLUDED (false-positive-prone in real estate copy):
 *     "non-negotiable" — common English price term ("the asking price is non-negotiable")
 *     "honest description" — agents naturally say they give an honest account
 *     "key family priorities" — natural lifestyle copy
 *
 * @param {string} body - stripped description text (audit block and gate tags already removed)
 * @returns {string|null} reason code, or null if clean
 */
const _LEAK_MARKERS = [
  'my approach',
  'as an ai',
  'i cannot',
  'i will not',
  'i will write',
  'misalign',
  'ethically',
  'the facts do not support',
  'archetype',
];

function bodyViolatesContract(body) {
  const lower = body.toLowerCase();

  // 1. Residual control tags
  const residualTags = ['<adaptation_verdict', '<verified_facts_used', '<neutral_reason'];
  for (const tag of residualTags) {
    if (lower.includes(tag)) return 'residual_tag';
  }

  // 2. Markdown/structural leak
  if (body.includes('**')) return 'formatted_body';
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('#')) return 'formatted_body';
  }

  // 3. Leaked reasoning markers (case-insensitive)
  for (const marker of _LEAK_MARKERS) {
    if (lower.includes(marker)) return 'leak_marker';
  }

  return null;
}

/**
 * Generate (and cache) archetype-adapted headline + description, grounded in the real listing.
 * The DESCRIPTION uses the live production system prompt from generate_description.py (so the demo
 * reflects exactly what prod would emit). The HEADLINE is a small separate call (in prod it comes
 * from the /adapt playbook directive, not this pipeline).
 */
async function generate(arche, listingKey) {
  const key = listingKey || DEMO_SLUG;
  const cacheKey = `${key}::${arche}`;
  if (genCache.has(cacheKey)) return genCache.get(cacheKey);
  // Dedupe concurrent callers onto one in-flight generation.
  if (genInflight.has(cacheKey)) return genInflight.get(cacheKey);
  const task = _generateUncached(arche, key, cacheKey).finally(() => genInflight.delete(cacheKey));
  genInflight.set(cacheKey, task);
  return task;
}

async function _generateUncached(arche, key, cacheKey) {
  const persona = PERSONAS[arche] ?? PERSONAS.neutral;
  if (!ANTHROPIC_API_KEY) {
    const fb = fallbackCopy(arche);
    genCache.set(cacheKey, fb);
    return fb;
  }
  const listing = await fetchListing(key);
  const listingJson = JSON.stringify(listing).slice(0, 4000);
  const original = typeof listing.description === 'string' ? listing.description : '';
  try {
    // DESCRIPTION — real prod system prompt + the same user-message shape as generate_description.py.
    const tmpl = await readProdPrompt();
    let description;
    let neutral = false;
    let headlinePromise = Promise.resolve('');
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
      // Fire BOTH generations in parallel — the sequential version cost desc+headline
      // (~9.5s measured); parallel costs max(desc, headline) (~6s). The fit-gate verdict
      // still comes from the description call and, on NEUTRAL, discards the headline below.
      headlinePromise = callClaude(
        `Write ONE compelling listing headline (max 90 chars, no surrounding quotes) for a ${arche} buyer (${persona}), strictly factually accurate to this listing data. Return ONLY the headline text, nothing else.\n\nListing (JSON): ${listingJson}`,
      ).catch(() => '');
      const rawDesc = await callClaude(user, system);
      // v1.9 archetype-fit gate (ADR-0010): NEUTRAL => wrong buyer => keep the DOM neutral.
      // The demo mirrors prod: show the agent's ORIGINAL copy and emit no adapted headline.
      neutral = isNeutralVerdict(rawDesc);
      if (neutral) {
        description = original || fallbackCopy(arche).description;
      } else {
        const stripped = stripVerifiedFacts(rawDesc);
        // FOLLOW-188: leak/format fail-safe. If the FIT body contains reasoning leaks,
        // markdown formatting, or residual gate tags, fall back to the agent's original
        // copy (neutral path) — same behaviour as prod _body_violates_contract guard.
        const violation = bodyViolatesContract(stripped);
        if (violation) {
          console.warn(
            `[mock] body_contract_violation archetype=${arche} reason=${violation} — serving original`,
          );
          neutral = true; // suppress headline generation too
          description = original || fallbackCopy(arche).description;
        } else {
          description = stripped || fallbackCopy(arche).description;
        }
      }
    } else {
      description = fallbackCopy(arche).description;
    }
    // HEADLINE — generated in parallel above; discarded on a NEUTRAL verdict so the
    // headline slot stays in its neutral (unmodified) state.
    let headline = '';
    if (!neutral) {
      const hRaw = await headlinePromise;
      headline =
        hRaw
          .trim()
          .split('\n')[0]
          .replace(/^["']|["']$/g, '')
          .slice(0, 120) || fallbackCopy(arche).headline;
    }
    genCache.set(cacheKey, { headline, description, archetype: arche, neutral });
  } catch (err) {
    console.warn(`[mock] generation failed for ${arche} / ${key}:`, err.message);
    genCache.set(cacheKey, fallbackCopy(arche));
  }
  return genCache.get(cacheKey);
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

function buildAdaptResponse(sessionId, gen, arche = currentArchetype) {
  const mk = (slot, value) => ({
    type: 'text',
    slot,
    value,
    archetype: arche,
    confidence: 0.92,
  });
  return {
    adapt_decision_id: randomUUID(),
    session_id: sessionId ?? 'unknown',
    archetype: arche,
    confidence: 0.92,
    similarity: 0.9,
    tier: 2,
    source: 'llm_full',
    generated_at: new Date().toISOString(),
    directives: [mk('headline', gen.headline)],
  };
}

// ─── Chat → archetype loop (FOLLOW-1024 / hops 2-6, local mirror) ────────────
//
// Production runs: SDK → ingest Worker → Modal `chat_nlp_endpoint` → Redis
// `shadow:{tenant}:{session}:chat_intent` → /api/adapt reads it → SDK folds it in. None of
// those exist locally, and `/v1/events` used to be a no-op — so the chat half of the buyer
// loop could not be exercised on localhost AT ALL. This closes it with the same contract.
//
// PARITY, and the one thing that silently breaks it: the extraction prompt is read from the
// REAL production module (`apps/intent-engine/src/nlp.py::_build_system_prompt`) by executing
// it, not by scraping it — the same "exercise the live prompt" principle the description path
// already follows, minus the regex fragility. If that import fails the loop is DISABLED and
// says so, because a locally-invented prompt would produce dimension values the SDK has no
// likelihood for, and `applyChatIntentPrior` would skip them silently — a green demo proving
// nothing.
//
// KNOWN PARITY GAP, stated because it bites the moment someone reads a null result as "chat
// does not work": the prod prompt emits 12 dimensions over their full vocabularies, but
// `CHAT_INTENT_LIKELIHOODS` in the SDK only has entries for 19 specific `dimension=value`
// pairs. Anything else (e.g. `purchase_purpose=primary_residence`, `urgency=3-6mo`,
// `geo_priority=beach`) is extracted, stored, returned — and then skipped by the fold.

/** sessionId → { dimensions, detected_at }. The local stand-in for the Redis shadow key. */
const chatIntentStore = new Map();

let chatPromptPromise = null;
/**
 * Read the production extraction prompt by RUNNING the production module.
 *
 * Returns null (and disables the loop) when the module cannot be imported, rather than
 * falling back to a hand-written prompt — see the parity note above.
 */
function loadChatPrompt() {
  chatPromptPromise ??= new Promise((resolveP) => {
    const src = resolve(REPO_ROOT, 'apps/intent-engine/src');
    execFile(
      'python3',
      [
        '-c',
        'import sys; sys.path.insert(0, sys.argv[1]); import nlp; print(nlp._build_system_prompt())',
        src,
      ],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          console.warn(
            '[mock] chat-intent loop DISABLED — could not run ' +
              'apps/intent-engine/src/nlp.py::_build_system_prompt ' +
              `(${err ? err.message : 'empty output'}). Chat will not influence the archetype.`,
          );
          resolveP(null);
          return;
        }
        console.log('[mock] chat-intent prompt loaded from the production nlp.py');
        resolveP(stdout.trim());
      },
    );
  });
  return chatPromptPromise;
}

/** Drop null/empty dims and stringify — mirrors the control plane's flattenIntentDimensions. */
function flattenDims(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'archetype_hint' || k === 'confidence') continue;
    if (v === null || v === undefined || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * Extract intent from one buyer message and store it for this session.
 *
 * ADR-0020 D3 admission rule, mirrored: a extraction with NO usable dimension must not
 * replace an existing record — otherwise "hi" would wipe the intent the conversation already
 * established, and (since FOLLOW-1024) would bump `detected_at` and burn a fold on nothing.
 */
async function ingestChatMessage(sessionId, message) {
  const systemPrompt = await loadChatPrompt();
  if (!systemPrompt || !ANTHROPIC_API_KEY) return;
  let dims = {};
  try {
    const text = await callClaude(`Conversation:\nbuyer: ${message}`, systemPrompt);
    const m = /\{[\s\S]*\}/.exec(text);
    dims = flattenDims(m ? JSON.parse(m[0]) : {});
  } catch (err) {
    console.warn(`[mock] chat-intent extraction failed: ${String(err?.message ?? err)}`);
    return;
  }
  if (Object.keys(dims).length === 0) {
    console.log(
      `[mock] chat-intent: no usable dimension in "${message.slice(0, 48)}" — record kept`,
    );
    return;
  }
  const detected_at = new Date().toISOString();
  chatIntentStore.set(sessionId, { dimensions: dims, detected_at });
  console.log(
    `[mock] chat-intent stored session=${sessionId.slice(0, 12)}… ` +
      `dims=${JSON.stringify(dims)} detected_at=${detected_at}`,
  );
}

/** The two fields `/adapt` attaches so the SDK can fold chat evidence once per message. */
function chatIntentFields(sessionId) {
  const entry = chatIntentStore.get(sessionId);
  if (!entry) return {};
  return {
    chat_intent_dimensions: entry.dimensions,
    chat_intent_detected_at: entry.detected_at,
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
      // Dev-only: never cache the SDK bundle so a rebuild is picked up on the next
      // full page load without the browser serving a stale `<script async>` copy.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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
  // Switch + (pre)generate a PREVIEW on the sample listing:  /mock/archetype/family_buyer
  // This only sets the global archetype + shows a sample. The real per-listing copy is
  // generated on demand by /adapt/description for whichever listing the SDK is on.
  if (req.method === 'GET' && path.startsWith('/mock/archetype/')) {
    const id = decodeURIComponent(path.slice('/mock/archetype/'.length));
    if (!PERSONAS[id])
      return json(res, 400, { error: 'unknown archetype', known: Object.keys(PERSONAS) }, origin);
    currentArchetype = id;
    genCache.delete(`${DEMO_SLUG}::${id}`); // fresh preview so prod-prompt edits are reflected
    const gen = await generate(id, DEMO_SLUG);
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
    genCache.clear(); // every listing's copy must regenerate with the new model
    return json(res, 200, { ok: true, model: currentModel }, origin);
  }

  // Quiz public-config PROXY — GET /quiz/public-config → the real control plane.
  // Locally the SDK's decisionApiUrl is this server, so without this route the SDK 404s and
  // falls back to its BUILT-IN default quiz tree — meaning quiz edits made on
  // admin.estalara.com never reach the local demo. Proxying the live endpoint (public route,
  // keyed by the pilot tenant's SDK key) closes the admin-edit → local-SDK loop.
  // Cached for 60s because the SDK's init fetch has a 1s timeout (quiz-config.ts) that a cold
  // upstream roundtrip can miss. Disable with PUBLIC_CONFIG_UPSTREAM=off (SDK then uses its
  // built-in tree, the pre-FOLLOW-1015 behaviour).
  if (req.method === 'GET' && path === '/quiz/public-config') {
    if (PUBLIC_CONFIG_UPSTREAM === 'off')
      return json(res, 404, { error: 'proxy disabled' }, origin);
    const now = Date.now();
    if (publicConfigCache && now - publicConfigCache.at < 60_000) {
      return json(res, 200, publicConfigCache.body, origin);
    }
    try {
      const r = await fetch(`${PUBLIC_CONFIG_UPSTREAM}/quiz/public-config`, {
        headers: { Authorization: `Bearer ${PUBLIC_CONFIG_API_KEY}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const body = await r.json();
      publicConfigCache = { at: now, body };
      console.log(
        `[mock] public-config proxied from ${PUBLIC_CONFIG_UPSTREAM} (data_source=${body.data_source ?? '?'})`,
      );
      return json(res, 200, body, origin);
    } catch (err) {
      console.warn(
        `[mock] public-config proxy failed (${err.message}) — SDK falls back to built-in tree`,
      );
      return json(res, 404, { error: 'public-config upstream unreachable' }, origin);
    }
  }

  // Long-form description — GET /adapt/description?listing_id&archetype&tier&locale
  // Grounds the generation in the REQUESTED listing (listing_id), so each listing gets its
  // own copy — not the sample listing's. This mirrors the prod pipeline (keyed by listing_id).
  if (req.method === 'GET' && path === '/adapt/description') {
    const q = url.searchParams.get('archetype');
    const arche = PERSONAS[q] ? q : currentArchetype;
    const listingKey = url.searchParams.get('listing_id') || DEMO_SLUG;
    const gen = await generate(arche, listingKey);
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
      // Ground the headline in the CURRENT listing. The SDK sends `listing_ids` (an array of
      // visible data-estalara-listing-id values); on a listing detail page that is the single
      // current listing. Fall back to a singular listing_id, then the sample listing.
      const listingKey =
        (Array.isArray(body.listing_ids) && body.listing_ids[0]) || body.listing_id || DEMO_SLUG;
      // Honour archetype_hint sent by the SDK (quiz result or intent engine signal).
      // Falls back to the manually-selected currentArchetype when the SDK sends neutral or nothing.
      // When hint is neutral, return a neutral response so cold-start doesn't immediately adapt.
      const hint = body.archetype_hint;
      if (hint === 'neutral' || !hint) {
        return json(
          res,
          200,
          {
            adapt_decision_id: randomUUID(),
            session_id: body.session_id ?? 'unknown',
            archetype: 'neutral',
            confidence: 0.1,
            similarity: 0.1,
            tier: 0,
            // PARITY BUG, fixed 2026-08-18: this said `source: 'neutral'`, which is NOT in the
            // contract's enum (`adapt-schema.ts`: playbook | llm_tweaked | llm_full | default |
            // playbook_fallback_llm_*). The SDK's Zod parse threw, `fetchDirectives` swallowed it
            // and returned `{ adaptResponse: null }` — so EVERY cold-start response was silently
            // discarded, and with it any `chat_intent_dimensions` riding on it. Production's
            // neutral path returns 'default' (adapt/route.ts); so does this now.
            source: 'default',
            generated_at: new Date().toISOString(),
            directives: [],
            // Attach on the NEUTRAL branch too — this is the branch a cold-start session takes,
            // and it is exactly where the first chat message must be able to move the archetype.
            // Omitting it here would make chat look broken for every buyer who chats before the
            // quiz, which is the case the whole loop exists for.
            ...chatIntentFields(body.session_id ?? 'unknown'),
          },
          origin,
        );
      }
      const arche = PERSONAS[hint] ? hint : currentArchetype;
      const gen = await generate(arche, listingKey);
      return json(
        res,
        200,
        {
          ...buildAdaptResponse(body.session_id, gen, arche),
          ...chatIntentFields(body.session_id ?? 'unknown'),
        },
        origin,
      );
    });
    return;
  }

  // Ingest + feedback + quiz-completion no-ops.
  // The completion ping is accepted (and logged) but NOT persisted — there is no
  // quiz_completions writer here. Read those rows on the real control plane.
  if (
    req.method === 'POST' &&
    (path === '/v1/events' || path.endsWith('/adapt/feedback') || path.endsWith('/quiz/completion'))
  ) {
    let raw = '';
    req.on('data', (ch) => (raw += ch));
    req.on('end', () => {
      // Chat → archetype, hop 2→4: pull `chat.message.sent` out of the ingest batch and run the
      // production extraction over it. Fire-and-forget so the ACK is never delayed, mirroring
      // the real Worker's waitUntil dispatch.
      if (path === '/v1/events') {
        try {
          const batch = JSON.parse(raw || '{}');
          for (const evt of batch.events ?? []) {
            if (evt?.type !== 'chat.message.sent') continue;
            const text = evt.payload?.message;
            const sid = evt.session_id;
            if (typeof text === 'string' && text.trim() && typeof sid === 'string') {
              void ingestChatMessage(sid, text.trim());
            }
          }
        } catch {
          /* a malformed batch must never break the ACK */
        }
      }
      if (path.endsWith('/quiz/completion')) {
        // The SDK sends { session_id, resolved_archetype, language } — see
        // postQuizCompletionPing in packages/sdk/src/core/adapt.ts.
        let archetype = '?';
        try {
          archetype = JSON.parse(raw || '{}').resolved_archetype ?? '?';
        } catch {
          /* ignore */
        }
        console.log(`[mock] quiz completion (not persisted) resolved_archetype=${archetype}`);
      }
      json(res, 200, { accepted: true }, origin);
    });
    return;
  }

  return json(res, 404, { error: 'not found', path }, origin);
});

// PREWARM (default on): pre-generate copy for every persona on the demo listing at boot so a
// quiz completion adapts the DOM in ~30ms instead of ~6s. Sequential with a small stagger to
// stay polite to the API; ~26 Haiku calls ≈ cents. PREWARM=off disables.
async function prewarm() {
  if ((process.env.PREWARM ?? 'on') === 'off' || !ANTHROPIC_API_KEY) return;
  const arches = Object.keys(PERSONAS).filter((a) => a !== 'neutral');
  // The SDK keys /adapt by the listing UUID (data-estalara-listing-id), NOT the slug the
  // switcher preview uses — prewarming the slug alone leaves every SDK request a cache miss.
  // Resolve slug → uuid via the backend and warm the UUID key; fall back to the slug when the
  // backend is down (then at least the switcher preview is warm).
  let key = DEMO_SLUG;
  try {
    const listing = await fetchListing(DEMO_SLUG);
    if (listing && typeof listing.uuid === 'string' && listing.uuid) {
      key = listing.uuid;
      listingCache.set(key, listing); // share the RAG context across both keys
    }
  } catch {
    /* backend down — slug fallback */
  }
  console.log(
    `[mock] prewarm: generating ${arches.length} archetypes for ${DEMO_SLUG} (key=${key}) in background…`,
  );
  for (const a of arches) {
    try {
      await generate(a, key);
      console.log(`[mock] prewarm done: ${a}`);
    } catch (err) {
      console.warn(`[mock] prewarm failed: ${a}: ${err.message}`);
    }
  }
  console.log('[mock] prewarm complete');
}

server.listen(PORT, () => {
  console.log(
    `[mock-decision] listening on http://localhost:${PORT}  archetype=${currentArchetype}`,
  );
  console.log(
    `[mock-decision] model=${currentModel}  key=${ANTHROPIC_API_KEY ? 'set' : 'MISSING (fallback copy)'}`,
  );
  console.log(`[mock-decision] switcher UI: http://localhost:${PORT}/  (→ /mock/archetype)`);
  void prewarm();
});
