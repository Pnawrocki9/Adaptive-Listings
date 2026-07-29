#!/usr/bin/env node
/**
 * check-consent-text-sync.mjs — FOLLOW-705
 *
 * Asserts that the published registration-consent disclosure in
 * `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6.1 reduces, byte-for-byte, to the
 * string the server actually shows the data subject —
 * `renderPlatformConsentText({ brandName: 'Estalara', legalEntity: 'Time2Show, Inc.' })`
 * in `apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts`.
 *
 * WHY (Rule N / Rule AH): the renderer's output is what the investor reads before clicking
 * "I agree" and what `GET /api/v1/consent/platform-registration` serves as `consent_text`;
 * the doc is what a regulator or auditor reads. If they diverge, one of the two is a false
 * statement about what the data subject agreed to. Until FOLLOW-705 they DID diverge — the
 * doc carried two unfilled editorial slots (`[agency DSR contact]`, `[agency privacy policy]`)
 * that the renderer had never emitted — and the `lib.ts` SYNC comment asserting byte-alignment
 * was simply untrue. Nothing checked it. This gate checks it.
 *
 * Same shape as the Rule N Privacy-Notice key-sync gate
 * (`scripts/check-privacy-notice-keys.sh`, CI job `privacy-notice-keys-sync`): a repo script,
 * zero dependencies, wired as a hard CI gate.
 *
 * The normalization implemented here is specified in prose in PRIVACY_NOTICE_TEMPLATE.md
 * §6.1.1 (steps N1–N8). The two MUST be kept in step; the spec is the human-readable
 * artifact, this file is its executable form. This script deliberately introduces NO third
 * canonical form: it only unwraps and de-markdowns the published block so it can be compared
 * to the served bytes.
 *
 * Modes:
 *   (no args)      check; exit 0 on match, 1 on drift
 *   --print-text   write the canonical text to stdout with NO trailing newline
 *                  (`… --print-text | sha256sum` reproduces the canonical hash)
 *   --print-hash   print the canonical SHA-256 (lowercase hex) and exit
 *   --self-test    prove the gate actually catches drift (validates the gate itself)
 *
 * Run: node scripts/check-consent-text-sync.mjs
 * Wired into: .github/workflows/ci.yml (consent-text-sync job)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DOC_PATH = 'docs/compliance/PRIVACY_NOTICE_TEMPLATE.md';
const LIB_PATH = 'apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts';
const IDENTITY_PATH = 'apps/control-plane/src/lib/brand-identity.ts';

const BEGIN_SENTINEL = '<!-- BEGIN CANONICAL CONSENT TEXT';
const END_SENTINEL = '<!-- END CANONICAL CONSENT TEXT';

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Pulls the consent-text template literal out of `renderPlatformConsentText()`.
 *
 * Fail-closed by design: if the renderer stops being "one function returning one template
 * literal", this throws rather than silently comparing against a partial string. A gate that
 * cannot see the text it is checking must fail, not pass.
 *
 * @param {string} libSrc
 * @returns {{ template: string, tosVersion: string }}
 */
function extractRendererTemplate(libSrc) {
  const fn = libSrc.match(/export function renderPlatformConsentText\([\s\S]*?\n\}\n/);
  if (!fn) {
    throw new Error(
      `Could not locate renderPlatformConsentText() in ${LIB_PATH}. ` +
        `If the renderer was renamed or restructured, update this gate in the same PR.`,
    );
  }
  const tpl = fn[0].match(/return `([\s\S]*?)`;\n/);
  if (!tpl) {
    throw new Error(
      `renderPlatformConsentText() no longer returns a single template literal. ` +
        `This gate can only compare a literal; update it in the same PR as the refactor.`,
    );
  }
  const interpolations = [...tpl[1].matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  const unknown = interpolations.filter((n) => n !== 'brandName' && n !== 'legalEntity');
  if (unknown.length > 0) {
    throw new Error(
      `The consent template interpolates unknown expression(s): ${[...new Set(unknown)].join(', ')}. ` +
        `This gate substitutes only \${brandName} and \${legalEntity}; a new substitution changes ` +
        `what the data subject reads and must be reflected here AND in §6.1.1.`,
    );
  }

  const tos = libSrc.match(/PLATFORM_REGISTRATION_TOS_VERSION\s*=\s*'([^']+)'/);
  if (!tos) {
    throw new Error(`Could not read PLATFORM_REGISTRATION_TOS_VERSION from ${LIB_PATH}.`);
  }
  return { template: tpl[1], tosVersion: tos[1] };
}

/**
 * Reads the first-party brand identity constants so the gate renders with the same values
 * production does, rather than a hardcoded copy that could drift.
 *
 * @param {string} identitySrc
 * @returns {{ brandName: string, legalEntity: string }}
 */
function extractEstalaraIdentity(identitySrc) {
  const brand = identitySrc.match(/ESTALARA_BRAND_NAME\s*=\s*'([^']*)'/);
  const legal = identitySrc.match(/ESTALARA_LEGAL_ENTITY\s*=\s*'([^']*)'/);
  if (!brand || !legal) {
    throw new Error(
      `Could not read ESTALARA_BRAND_NAME / ESTALARA_LEGAL_ENTITY from ${IDENTITY_PATH}.`,
    );
  }
  return { brandName: brand[1], legalEntity: legal[1] };
}

/**
 * N1 — the bytes strictly between the sentinel lines, excluding both.
 *
 * @param {string} docSrc
 * @returns {{ block: string, beginLine: string }}
 */
function extractDocBlock(docSrc) {
  const lines = docSrc.split('\n');
  const beginIdx = lines.findIndex((l) => l.startsWith(BEGIN_SENTINEL));
  const endIdx = lines.findIndex((l) => l.startsWith(END_SENTINEL));
  const beginCount = lines.filter((l) => l.startsWith(BEGIN_SENTINEL)).length;
  const endCount = lines.filter((l) => l.startsWith(END_SENTINEL)).length;

  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(
      `${DOC_PATH} must contain exactly one "${BEGIN_SENTINEL} …" line and one ` +
        `"${END_SENTINEL} …" line (found ${beginCount} / ${endCount}). The sentinels define ` +
        `the hashable block; without them the block boundary is a guess (§6.1.1 N1).`,
    );
  }
  if (endIdx < beginIdx) {
    throw new Error(`${DOC_PATH}: END sentinel appears before BEGIN sentinel.`);
  }
  return { block: lines.slice(beginIdx + 1, endIdx).join('\n'), beginLine: lines[beginIdx] };
}

// ── Normalization (PRIVACY_NOTICE_TEMPLATE.md §6.1.1, steps N2–N8) ────────────

/**
 * @param {string} block
 * @returns {string}
 */
function normalizeDocBlock(block) {
  // N2 — characters that must not be normalized away silently.
  if (block.includes('\r')) {
    throw new Error(`§6.1 block contains a CR. The canonical text is LF-only (§6.1.1 N2).`);
  }
  if (block.includes('\t')) {
    throw new Error(`§6.1 block contains a tab. Use spaces (§6.1.1 N2).`);
  }
  if (block.includes('[')) {
    throw new Error(
      `§6.1 block contains "[" — a bracket template slot. The served consent text contains ` +
        `none, so a slot here republishes text the data subject never saw. Resolve it to prose ` +
        `(this is the exact defect FOLLOW-705 fixed: "[agency DSR contact]").`,
    );
  }
  if (block.includes('`')) {
    throw new Error(`§6.1 block contains a backtick. Only "**" markdown is handled (§6.1.1 N6).`);
  }

  return block
    .trim() // N3
    .split(/\n[ \t]*\n+/) // N4
    .map((para) =>
      para
        .split('\n')
        .map((line) => line.trim())
        .join(' '),
    ) // N5
    .join('\n\n') // N7
    .replaceAll('**', ''); // N6
  // N8 — .trim() in N3 already guarantees no trailing newline.
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ── Check ─────────────────────────────────────────────────────────────────────

/**
 * @param {{ docSrc: string, libSrc: string, identitySrc: string }} sources
 * @returns {{ ok: boolean, errors: string[], canonicalText?: string, canonicalHash?: string }}
 */
function runCheck({ docSrc, libSrc, identitySrc }) {
  const errors = [];
  let canonicalText;
  let canonicalHash;

  try {
    const { template, tosVersion } = extractRendererTemplate(libSrc);
    const { brandName, legalEntity } = extractEstalaraIdentity(identitySrc);
    canonicalText = template
      .replaceAll('${brandName}', brandName)
      .replaceAll('${legalEntity}', legalEntity);
    canonicalHash = sha256(canonicalText);

    const { block, beginLine } = extractDocBlock(docSrc);

    if (!beginLine.includes(tosVersion)) {
      errors.push(
        `The BEGIN sentinel does not name the pinned TOS version.\n` +
          `  sentinel: ${beginLine}\n` +
          `  PLATFORM_REGISTRATION_TOS_VERSION: ${tosVersion}\n` +
          `  When the consent text changes, bump the TOS version and both sentinels in the same PR.`,
      );
    }

    const normalized = normalizeDocBlock(block);
    if (normalized !== canonicalText) {
      const docLines = normalized.split('\n');
      const renLines = canonicalText.split('\n');
      const details = [];
      for (let i = 0; i < Math.max(docLines.length, renLines.length); i++) {
        if (docLines[i] !== renLines[i]) {
          details.push(
            `  paragraph ${i + 1}:\n` +
              `    DOC (normalized §6.1): ${JSON.stringify(docLines[i] ?? '<missing>')}\n` +
              `    SERVED (renderer):     ${JSON.stringify(renLines[i] ?? '<missing>')}`,
          );
        }
      }
      errors.push(
        `The published §6.1 block and the served consent text are NOT the same bytes.\n` +
          `  SHA-256 normalized §6.1: ${sha256(normalized)}\n` +
          `  SHA-256 served text:     ${canonicalHash}\n` +
          details.join('\n'),
      );
    }
  } catch (err) {
    errors.push(err.message);
  }

  return { ok: errors.length === 0, errors, canonicalText, canonicalHash };
}

function readSources() {
  return {
    docSrc: fs.readFileSync(path.join(REPO_ROOT, DOC_PATH), 'utf8'),
    libSrc: fs.readFileSync(path.join(REPO_ROOT, LIB_PATH), 'utf8'),
    identitySrc: fs.readFileSync(path.join(REPO_ROOT, IDENTITY_PATH), 'utf8'),
  };
}

// ── Self-test fixture helpers (FOLLOW-720) ─────────────────────────────────────
//
// RETRO-230 §4c TG-1: `versionDrift` used to mutate `libSrc` via `.replace()` anchored on the
// EXACT CURRENT VALUE of `PLATFORM_REGISTRATION_TOS_VERSION` — the literal this gate exists to let
// change (FOLLOW-704/710/711). The moment that value is genuinely bumped, the anchor no longer
// matches, `.replace()` silently no-ops, the "mutated" fixture equals the original, and this
// case's `ok === false` assertion fails for the WRONG reason — the misleading
// `the gate does not detect drift` message then blames the gate instead of the stale fixture. The
// helpers below make a no-op anchor throw loudly with a message that names the fixture as stale,
// and let `versionDrift` derive its anchor from whatever the CURRENT source assigns rather than a
// hardcoded literal, so a legitimate prior bump can never make it stale.

class FixtureStaleError extends Error {
  constructor(where) {
    super(
      `SELF-TEST FIXTURE STALE — the anchor for "${where}" no longer appears verbatim in the ` +
        `current source. This does NOT mean the gate failed to detect drift; it means this ` +
        `self-test case's fixture predates a later, legitimate change and needs a new anchor. ` +
        `Update the anchor at ${where}.`,
    );
    this.name = 'FixtureStaleError';
  }
}

/**
 * `String.replace` with a literal anchor silently no-ops if the anchor is not found. This wrapper
 * makes that a loud, correctly-attributed failure instead of a silent no-op mutation.
 *
 * @param {string} str
 * @param {string} anchor
 * @param {string} replacement
 * @param {string} where - human-readable pointer to the anchor's source location
 * @returns {string}
 */
function mustReplace(str, anchor, replacement, where) {
  if (!str.includes(anchor)) throw new FixtureStaleError(where);
  return str.replace(anchor, replacement);
}

/**
 * Runs one self-test case. `fn` returns the assertion result, or throws `FixtureStaleError` if its
 * fixture mutation could not be applied to the current source — the two outcomes are reported
 * distinctly by `selfTest()` below instead of both surfacing as "the gate does not detect drift".
 *
 * @param {{ name: string, status: 'PASS' | 'FAIL' | 'STALE', detail?: string }[]} results
 * @param {string} name
 * @param {() => boolean} fn
 */
function runCase(results, name, fn) {
  try {
    results.push({ name, status: fn() ? 'PASS' : 'FAIL' });
  } catch (err) {
    if (err instanceof FixtureStaleError) {
      results.push({ name, status: 'STALE', detail: err.message });
    } else {
      throw err;
    }
  }
}

// ── Self-test (validates the gate itself) ─────────────────────────────────────

function selfTest() {
  const sources = readSources();
  /** @type {{ name: string, status: 'PASS' | 'FAIL' | 'STALE', detail?: string }[]} */
  const results = [];

  runCase(results, 'unmodified repo state PASSES', () => runCheck(sources).ok === true);

  runCase(results, 'doc retention-period drift FAILS', () => {
    const mutated = {
      ...sources,
      docSrc: mustReplace(
        sources.docSrc,
        'within 30 days',
        'within 60 days',
        `${DOC_PATH} — "within 30 days"`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  runCase(results, 'reintroduced bracket placeholder FAILS', () => {
    const mutated = {
      ...sources,
      docSrc: mustReplace(
        sources.docSrc,
        "the agency's DSR contact",
        '[agency DSR contact]',
        `${DOC_PATH} — "the agency's DSR contact"`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  runCase(results, 'renderer-side text drift FAILS', () => {
    const mutated = {
      ...sources,
      libSrc: mustReplace(
        sources.libSrc,
        'within 30 days',
        'within 60 days',
        `${LIB_PATH} — "within 30 days"`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  runCase(results, 'removed BEGIN sentinel FAILS', () => {
    const mutated = {
      ...sources,
      docSrc: mustReplace(
        sources.docSrc,
        BEGIN_SENTINEL,
        '<!-- begin consent text',
        `${DOC_PATH} — BEGIN_SENTINEL`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  // The version literal this case mutates is exactly what FOLLOW-704/710/711 bump. Anchored on
  // whatever the CURRENT source assigns — extracted dynamically via the same regex the real check
  // uses, not hardcoded to today's value — so a legitimate prior bump can never make this stale.
  runCase(results, 'TOS version bumped without sentinel update FAILS', () => {
    const versionMatch = sources.libSrc.match(/PLATFORM_REGISTRATION_TOS_VERSION\s*=\s*'([^']+)'/);
    if (!versionMatch) {
      throw new FixtureStaleError(`${LIB_PATH} — PLATFORM_REGISTRATION_TOS_VERSION assignment`);
    }
    const [currentAssignment, currentVersion] = versionMatch;
    const bumpedAssignment = currentAssignment.replace(
      currentVersion,
      `${currentVersion}-selftest-bumped`,
    );
    const mutated = {
      ...sources,
      libSrc: mustReplace(
        sources.libSrc,
        currentAssignment,
        bumpedAssignment,
        `${LIB_PATH} — PLATFORM_REGISTRATION_TOS_VERSION assignment`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  runCase(results, 'unreadable renderer FAILS CLOSED', () => {
    const mutated = {
      ...sources,
      libSrc: mustReplace(
        sources.libSrc,
        'export function renderPlatformConsentText',
        'function renderPlatformConsentTextRenamed',
        `${LIB_PATH} — "export function renderPlatformConsentText"`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  let failed = 0;
  let stale = 0;
  for (const r of results) {
    if (r.status === 'PASS') {
      console.log(`PASS  [self-test] ${r.name}`);
    } else if (r.status === 'FAIL') {
      console.log(`FAIL  [self-test] ${r.name}`);
      failed++;
    } else {
      console.log(`STALE [self-test] ${r.name}`);
      console.log(`      ${r.detail}`);
      stale++;
    }
  }
  console.log('');
  if (failed > 0) {
    console.log(
      `=== SELF-TEST FAILED (${failed}/${results.length}) — the gate does not detect drift ===`,
    );
  }
  if (stale > 0) {
    console.log(
      `=== SELF-TEST FIXTURE STALE (${stale}/${results.length}) — one or more self-test fixture ` +
        'anchors predate a later, legitimate change; the gate itself is UNPROVEN either way — ' +
        'update the named anchor(s) above to match the current source, then re-run ===',
    );
  }
  if (failed > 0 || stale > 0) {
    process.exit(1);
  }
  console.log(`=== SELF-TEST PASSED (${results.length}/${results.length}) ===`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const mode = process.argv[2] ?? '';

if (mode === '--self-test') {
  selfTest();
} else if (mode === '--print-text' || mode === '--print-hash') {
  const result = runCheck(readSources());
  if (!result.canonicalText) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  if (mode === '--print-text') {
    process.stdout.write(result.canonicalText); // no trailing newline — see §6.1.1
  } else {
    console.log(result.canonicalHash);
  }
} else {
  console.log('=== Registration Consent Text Sync Check (FOLLOW-705 / Rule N) ===');
  console.log(`Published disclosure: ${DOC_PATH} §6.1`);
  console.log(`Served text:          ${LIB_PATH} renderPlatformConsentText()`);
  console.log('');

  const result = runCheck(readSources());
  if (result.ok) {
    console.log(`PASS  §6.1 normalizes byte-for-byte to the served consent text.`);
    console.log(`      canonical SHA-256: ${result.canonicalHash}`);
    console.log('');
    console.log('=== CONSENT TEXT IN SYNC — PASS ===');
    process.exit(0);
  }

  for (const e of result.errors) console.log(`FAIL  ${e}`);
  console.log('');
  console.log('=== CONSENT TEXT OUT OF SYNC — FAIL ===');
  console.log('');
  console.log('To fix: edit BOTH artifacts in the same PR so they agree —');
  console.log(`  1. the served text: ${LIB_PATH} renderPlatformConsentText()`);
  console.log(`  2. the published text: ${DOC_PATH} §6.1 (between the sentinels)`);
  console.log('  3. if the DISCLOSED MEANING changed, bump PLATFORM_REGISTRATION_TOS_VERSION,');
  console.log('     both sentinels, and re-pin CANONICAL_CONSENT_TEXT_HASH — a data subject');
  console.log('     consented to the old text and cannot be retro-bound to the new one.');
  console.log('Normalization spec: PRIVACY_NOTICE_TEMPLATE.md §6.1.1 (N1–N8).');
  process.exit(1);
}
