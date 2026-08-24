#!/usr/bin/env node
/**
 * check-adr-0021-conditions.mjs — FOLLOW-925
 *
 * Gives the three BINDING CONDITIONS of the ADR-0021 §D5 compliance countersign
 * (PR #703, 2026-08-09) a consumer. Until this gate existed they were prose in an ADR that
 * "gates the FOLLOW-915 implementation PR" — and nothing checked them. RETRO-263 found the
 * same shape independently (its FOLLOW-923): a countersign whose gate is a paragraph someone
 * is trusted to have read is not a gate.
 *
 * WHY IT IS ARMED BY PRESENCE, NOT BY A DATE OR A TICKET STATE
 *
 * All three conditions attach to artifacts the FOLLOW-915 implementation has not created yet
 * (`consent-text.json`, the Zod schema, `CONSENT_TEXT_URL`). A gate that simply passes while
 * they are absent is the FOLLOW-918 defect wearing this control's name: green over absence.
 * So this gate ARMS the moment ANY part of the implementation appears, and then demands all
 * three. A half-landed implementation is red — you cannot satisfy it by doing half the work,
 * which is precisely how a byte-identity obligation gets dropped.
 *
 * While disarmed it is NOT silent: it prints every probe it ran and what each returned, so
 * "this gate passed" can be read as "and here is exactly what it looked at". Condition 1 is
 * enforced in BOTH states — the canonical sentences must always have a live home, whether that
 * is the SDK `COPY` constant (today) or the served document (after the move).
 *
 * THE THREE CONDITIONS (ADR-0021 §D5, verbatim intent)
 *
 *   C1  Every locale carries the DPIA §13.1 (denial-log) and §13.2 (cross-session identifier)
 *       disclosure sentences BYTE-IDENTICAL to the signed text. Canonical bytes:
 *       docs/compliance/consent-disclosures.canonical.json. A Zod schema (ADR-0021 §D7) locks
 *       the document's SHAPE and cannot express this; ESC-051 is byte pressure on exactly the
 *       file that holds these sentences, so this is the condition most likely to erode.
 *   C2  The §D3 request shape, byte-exactly: a compile-time `CONSENT_TEXT_URL` string constant,
 *       no query string, no interpolation, `credentials: 'omit'`, no `Authorization` header.
 *       §D3 is the entire compliance foundation — the countersign's lawfulness analysis
 *       collapses the moment the request carries any identifier.
 *   C3  Rule N: dpia.md §13.1/§13.2 may not keep naming the `COPY` constant as the source of
 *       record for the disclosure strings once the strings no longer live there.
 *
 * Modes:
 *   (no args)     check; exit 0 on pass, 1 on violation
 *   --self-test   prove the gate catches each condition, red-first
 *
 * Run: node scripts/check-adr-0021-conditions.mjs
 * Wired into: .github/workflows/ci.yml (adr-0021-conditions job)
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const P = {
  canonical: 'docs/compliance/consent-disclosures.canonical.json',
  banner: 'packages/sdk/src/ui/consent-banner.ts',
  served: 'apps/control-plane/public/consent-text.json',
  schema: 'packages/shared/src/schemas/consent-text.ts',
  dpia: 'docs/compliance/dpia.md',
  sdkSrc: 'packages/sdk/src',
  sharedSrc: 'packages/shared/src',
};

const MANDATED = ['disclosure13_1', 'disclosure13_2'];

// ── helpers ──────────────────────────────────────────────────────────────────

const read = (base, rel) => {
  const f = path.join(base, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

/** Every .ts file under a directory, recursively. Returns [] when absent. */
function walkTs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * The disclosure strings the SDK `COPY` constant currently holds, per locale.
 * Returns {} when the file is gone or no longer carries them — which is the
 * post-FOLLOW-915 state, not an error by itself.
 */
function copyDisclosures(bannerSrc) {
  if (!bannerSrc) return {};
  const out = {};
  const locRe = /^ {2}([a-z]{2}): \{$/gm;
  let m;
  while ((m = locRe.exec(bannerSrc))) {
    const end = bannerSrc.indexOf('\n  },', m.index);
    const seg = bannerSrc.slice(m.index, end === -1 ? undefined : end);
    const entry = {};
    for (const key of MANDATED) {
      // (?<![\w$]) so that a RENAMED key — `retired_disclosure13_1:` — does not read as
      // the mandated one still being present. Without it, retiring a key by prefixing it
      // leaves this gate believing COPY is still the source of record, which silently
      // disarms C3 and the both-homes-empty check. Caught by T9/T10 below.
      const hit = seg.match(
        new RegExp('(?<![\\w$])' + key + ":\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'"),
      );
      if (hit) entry[key] = hit[1].replace(/\\(.)/g, '$1');
    }
    if (Object.keys(entry).length) out[m[1]] = entry;
  }
  return out;
}

/** Locale -> {disclosure13_1, disclosure13_2} from the served document, or {}. */
function servedDisclosures(servedRaw, problems) {
  if (!servedRaw) return {};
  let doc;
  try {
    doc = JSON.parse(servedRaw);
  } catch (e) {
    problems.push(`C1: ${P.served} is not valid JSON (${e.message}).`);
    return {};
  }
  if (!doc || typeof doc.locales !== 'object' || doc.locales === null) {
    problems.push(`C1: ${P.served} has no \`locales\` object (ADR-0021 §D7 wire contract).`);
    return {};
  }
  return doc.locales;
}

// ── the check ────────────────────────────────────────────────────────────────

/**
 * Resolve a compile-time URL constant to its literal value.
 *
 * §D3's requirement is that the URL is **byte-identical for every tenant and every visitor** —
 * i.e. fully determined at build time. That is NOT the same as "written as one quoted string":
 * `packages/shared/src/domains.ts` composes every service URL from other `as const` constants
 * (`SDK_SERVE_URL`, `DETECT_SERVE_URL`), and ADR-0021 §D2 cites that very file as where the
 * constant belongs. The first version of this check rejected the composed form and would have
 * forced the implementation to hard-code a hostname the rest of the module derives — found by
 * building FOLLOW-915 against it.
 *
 * So: a template literal is allowed IF every `${…}` is a SCREAMING_SNAKE identifier declared as
 * a const in the same module and itself resolvable this way. Anything else — a function call, a
 * dataset read, a lower-case variable — is a runtime value and is exactly the shape §D3 forbids,
 * because that is how a tenant id or locale reaches the URL.
 *
 * @returns {{ value: string } | { problem: string }}
 */
function resolveCompileTimeUrl(src, name, depth = 0) {
  if (depth > 5) return { problem: `${name}: constant resolution exceeded 5 levels` };
  const decl = src.match(new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?);\\n`));
  if (!decl) return { problem: `${name} is not declared as a const in this module` };

  let rhs = decl[1]
    .trim()
    .replace(/\s+as\s+const$/, '')
    .trim();

  const quoted = rhs.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (quoted) return { value: quoted[1] ?? quoted[2] ?? '' };

  if (!rhs.startsWith('`') || !rhs.endsWith('`')) {
    return {
      problem:
        `${name} is neither a string literal nor a template of compile-time constants ` +
        `(found: ${rhs})`,
    };
  }

  let body = rhs.slice(1, -1);
  const refs = [...body.matchAll(/\$\{([^}]*)\}/g)];
  for (const [whole, expr] of refs) {
    const ident = expr.trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(ident)) {
      return {
        problem:
          `${name} interpolates \`${ident}\`, which is not a compile-time constant. §D3 forbids ` +
          `it — a runtime value is how a tenant id, locale or experiment arm reaches the URL.`,
      };
    }
    const inner = resolveCompileTimeUrl(src, ident, depth + 1);
    if ('problem' in inner) return inner;
    body = body.replace(whole, inner.value);
  }
  return { value: body };
}

/**
 * @param base repo root (or a fixture root, for --self-test)
 * @returns {{problems: string[], notes: string[], armed: boolean}}
 */
function check(base) {
  const problems = [];
  const notes = [];

  const canonicalRaw = read(base, P.canonical);
  if (!canonicalRaw) {
    problems.push(
      `C1: the canonical disclosure record ${P.canonical} is MISSING. It is the byte record the ` +
        `ADR-0021 §D5 countersign rests on; without it condition 1 cannot be checked at all, and ` +
        `an unenforceable condition is the thing this gate exists to prevent.`,
    );
    return { problems, notes, armed: false };
  }
  const canonical = JSON.parse(canonicalRaw).locales;

  const bannerSrc = read(base, P.banner);
  const servedRaw = read(base, P.served);
  const schemaSrc = read(base, P.schema);
  const sdkFiles = walkTs(path.join(base, P.sdkSrc));
  // ADR-0021 §D2 puts the constant in `packages/shared/src/domains.ts` and the FETCH in the SDK.
  // The first version of this gate searched the SDK only and reported "referenced but never
  // declared as a const" against a CORRECT implementation — found by building FOLLOW-915 against
  // it. Declaration and call site are located independently now.
  const urlConstFile = [...walkTs(path.join(base, P.sharedSrc)), ...sdkFiles].find((f) =>
    /const\s+CONSENT_TEXT_URL\b/.test(fs.readFileSync(f, 'utf8')),
  );
  const urlCallFile = sdkFiles.find((f) =>
    /fetch\s*\(\s*CONSENT_TEXT_URL/.test(fs.readFileSync(f, 'utf8')),
  );

  // ── arming ────────────────────────────────────────────────────────────────
  const probes = [
    [`${P.served} present`, servedRaw !== null],
    [`${P.schema} present`, schemaSrc !== null],
    ['CONSENT_TEXT_URL declared (shared or sdk)', urlConstFile !== undefined],
  ];
  const armed = probes.some(([, hit]) => hit);
  notes.push('Arming probes (ADR-0021 §D7 artifacts):');
  for (const [label, hit] of probes) notes.push(`  ${hit ? 'YES' : 'no '}  ${label}`);
  notes.push(
    `  => ${armed ? 'ARMED — all three conditions enforced.' : 'DISARMED — C1 still enforced against the SDK COPY constant.'}`,
  );

  // ── C1 — byte identity, enforced in BOTH states ───────────────────────────
  const fromCopy = copyDisclosures(bannerSrc);
  const fromServed = servedDisclosures(servedRaw, problems);
  const sources = [];
  if (Object.keys(fromCopy).length) sources.push([P.banner, fromCopy]);
  if (Object.keys(fromServed).length) sources.push([P.served, fromServed]);

  if (sources.length === 0) {
    problems.push(
      `C1: NEITHER ${P.banner} (COPY) NOR ${P.served} carries the mandated disclosure sentences. ` +
        `They are legally required text under DPIA §13.1/§13.2 — they cannot be in flight between ` +
        `two homes with no home.`,
    );
  }

  for (const [label, table] of sources) {
    for (const [loc, want] of Object.entries(canonical)) {
      const got = table[loc];
      if (!got) {
        problems.push(
          `C1: ${label} is missing locale '${loc}' entirely (canonical record has it).`,
        );
        continue;
      }
      for (const key of MANDATED) {
        if (got[key] === undefined) {
          problems.push(
            `C1: ${label} locale '${loc}' is missing '${key}' — a DPIA-mandated sentence.`,
          );
        } else if (got[key] !== want[key]) {
          problems.push(
            `C1: ${label} locale '${loc}' '${key}' is NOT byte-identical to the canonical record.\n` +
              `      canonical: ${JSON.stringify(want[key])}\n` +
              `      found    : ${JSON.stringify(got[key])}`,
          );
        }
      }
    }
    notes.push(
      `C1: ${label} — checked ${Object.keys(canonical).length} locale(s) x ${MANDATED.length} sentence(s).`,
    );
  }

  if (!armed) return { problems, notes, armed };

  // ── C2 — the §D3 request shape, byte-exact ────────────────────────────────
  if (!urlConstFile) {
    problems.push(
      `C2: the implementation is armed but no CONSENT_TEXT_URL constant was found under ` +
        `${P.sdkSrc}. ADR-0021 §D3 requires a COMPILE-TIME constant; a URL assembled at the call ` +
        `site is exactly what the identifier-free guarantee cannot survive.`,
    );
  } else {
    const src = fs.readFileSync(urlConstFile, 'utf8');
    const rel = path.relative(base, urlConstFile);
    const resolved = resolveCompileTimeUrl(src, 'CONSENT_TEXT_URL');
    if ('problem' in resolved) {
      problems.push(`C2: ${resolved.problem} (${rel}).`);
    } else if (resolved.value.includes('?')) {
      problems.push(
        `C2: CONSENT_TEXT_URL resolves to '${resolved.value}', which carries a query string; ` +
          `§D3 forbids query parameters of any kind.`,
      );
    } else {
      notes.push(`C2: CONSENT_TEXT_URL resolves at compile time to '${resolved.value}'.`);
    }
    const callSrc = urlCallFile ? fs.readFileSync(urlCallFile, 'utf8') : '';
    const callRel = urlCallFile ? path.relative(base, urlCallFile) : '(no call site)';
    const call = callSrc.match(/fetch\s*\(\s*CONSENT_TEXT_URL[\s\S]{0,400}?\)/);
    if (!call) {
      problems.push(
        `C2: no \`fetch(CONSENT_TEXT_URL…)\` call site found under ${P.sdkSrc}. The constant ` +
          `exists but nothing fetches it, so the §D3 request shape is unassertable.`,
      );
    } else {
      if (!/credentials\s*:\s*'omit'|credentials\s*:\s*"omit"/.test(call[0])) {
        problems.push(
          `C2: the fetch of CONSENT_TEXT_URL in ${callRel} does not pass \`credentials: 'omit'\` (§D3).`,
        );
      }
      if (/[Aa]uthorization/.test(call[0])) {
        problems.push(
          `C2: the fetch of CONSENT_TEXT_URL in ${callRel} sets an Authorization header; §D3 forbids it.`,
        );
      }
    }
    notes.push(`C2: URL constant in ${rel}; request shape in ${callRel}.`);
  }

  // ── C3 — Rule N: the DPIA may not name a source of record that moved ──────
  const dpia = read(base, P.dpia);
  const copyStillHolds = Object.keys(fromCopy).length > 0;
  if (dpia === null) {
    problems.push(`C3: ${P.dpia} not found.`);
  } else if (!copyStillHolds) {
    const staleClaims = [
      'are defined in the `COPY`',
      '(`COPY` constant, `renderConsentBanner` function)',
    ].filter((c) => dpia.includes(c));
    for (const c of staleClaims) {
      problems.push(
        `C3: ${P.dpia} still states the disclosure strings live in the SDK COPY constant ` +
          `("${c}"), but ${P.banner} no longer carries them. Rule N: a compliance document may ` +
          `not describe a source of record that no longer exists.`,
      );
    }
    if (!dpia.includes('consent-text.json')) {
      problems.push(
        `C3: the strings have moved out of COPY but ${P.dpia} never names \`consent-text.json\` — ` +
          `§13.1/§13.2 must cross-reference the new source of record.`,
      );
    }
    notes.push('C3: DPIA cross-references checked against the post-move state.');
  } else {
    notes.push(
      'C3: COPY still holds the strings, so the DPIA cross-references are still true — nothing to assert yet.',
    );
  }

  return { problems, notes, armed };
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'adr0021-'));
  let failures = 0;
  let passes = 0;

  const write = (base, rel, body) => {
    fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), body);
  };

  const canonicalDoc = JSON.parse(fs.readFileSync(path.join(ROOT, P.canonical), 'utf8'));
  // The DPIA fixtures are SYNTHESIZED for the same reason the banner above is: a fixture
  // describing a state must construct that state, never borrow it from HEAD. Reading the real
  // dpia.md made T9 — C3's only red-first proof — silently green the moment FOLLOW-915 corrected
  // the very cross-references T9 exists to catch: the "stale" fixture was no longer stale, so
  // C3 passed and the case reported PASS where it demanded VIOLATION. The live check still reads
  // the real dpia.md; that is where the repo's actual state belongs.
  const dpiaPreMove =
    '## 13.1\n\nThe disclosure strings for EN, PL, and ES locales are defined in the `COPY`\n' +
    'constant in that file.\n\n## 13.2\n\nThe banner copy is implemented in\n' +
    '`packages/sdk/src/ui/consent-banner.ts` (`COPY` constant, `renderConsentBanner` function).\n';

  const dpiaPostMove =
    '## 13.1\n\nThe disclosure strings are served out-of-bundle from `consent-text.json`;\n' +
    'the byte record is `docs/compliance/consent-disclosures.canonical.json`.\n\n' +
    '## 13.2\n\nThe banner is rendered by `renderConsentBanner`; the copy itself is served\n' +
    'from `consent-text.json` and passed in.\n';

  // The PRE-move banner is SYNTHESIZED, not read from disk. It used to be read from the real
  // file, which worked only while `COPY` still shipped in the bundle — FOLLOW-915 moved those
  // strings out, and every disarmed fixture went red on a repo that is perfectly correct. A
  // fixture describing a past state must construct that state, never borrow it from HEAD.
  // Single-quoted, because the real pre-move file was — and `copyDisclosures` parses the shape
  // the source actually had, not a tidied one. A double-quoted fixture silently parses as "COPY
  // carries nothing", which is a different state entirely.
  const sq = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  const bannerWithCopy = (locales) =>
    'const COPY = {\n' +
    Object.entries(locales)
      .map(
        ([loc, entry]) =>
          `  ${loc}: {\n` +
          `    disclosure13_1: ${sq(entry.disclosure13_1)},\n` +
          `    disclosure13_2: ${sq(entry.disclosure13_2)},\n` +
          '  },\n',
      )
      .join('') +
    '} as const;\n';

  const realBanner = bannerWithCopy(canonicalDoc.locales);

  /** A fixture repo in the PRE-FOLLOW-915 (disarmed) state: COPY holds the strings. */
  const fixture = (name) => {
    const base = path.join(tmp, name);
    write(base, P.canonical, JSON.stringify(canonicalDoc, null, 2) + '\n');
    write(base, P.banner, realBanner);
    write(base, P.dpia, dpiaPreMove);
    return base;
  };

  /** Moves a fixture to the ARMED (post-implementation) state. */
  const arm = (base, { served, url, dpia } = {}) => {
    const locales = served ?? canonicalDoc.locales;
    write(
      base,
      P.served,
      JSON.stringify({ schema_version: 1, text_version: '2026-08-09.1', locales }, null, 2),
    );
    write(base, P.schema, 'export const ConsentTextDocumentSchema = null;\n');
    write(
      base,
      'packages/sdk/src/ui/consent-text.ts',
      url ??
        "const CONSENT_TEXT_URL = 'https://cp.example/consent-text.json';\n" +
          "export const load = () => fetch(CONSENT_TEXT_URL, { credentials: 'omit', mode: 'cors' });\n",
    );
    // post-move: COPY no longer carries the sentences
    write(base, P.banner, realBanner.replace(/disclosure13_[12]:/g, 'retired_$&'));
    write(base, P.dpia, dpia ?? dpiaPostMove);
    return base;
  };

  const expect = (label, base, wantOk, needle) => {
    const { problems } = check(base);
    const ok = problems.length === 0;
    if (ok !== wantOk) {
      console.log(`SELF-TEST FAIL: ${label}`);
      console.log(`  expected ${wantOk ? 'PASS' : 'VIOLATION'}, got ${ok ? 'PASS' : 'VIOLATION'}`);
      for (const p of problems) console.log(`    - ${p}`);
      failures++;
      return;
    }
    if (needle && !problems.some((p) => p.includes(needle))) {
      console.log(`SELF-TEST FAIL: ${label}`);
      console.log(
        `  correct verdict, but for the wrong reason — no problem mentioned ${JSON.stringify(needle)}`,
      );
      for (const p of problems) console.log(`    - ${p}`);
      failures++;
      return;
    }
    console.log(`OK: self-test PASSED — ${label}`);
    passes++;
  };

  // T1 — today's real repo state passes, disarmed.
  expect('the PRE-move state passes (disarmed, C1 against COPY)', fixture('t1'), true);

  // T2 — C1 red-first, DISARMED: a mandated sentence edited in COPY.
  //
  // The edit is DERIVED from the canonical bytes, never hard-coded. It used to read
  // `.replace('This log is retained for 7 days', ...)`, which silently became a no-op the moment
  // FOLLOW-1118 re-rendered that sentence at 180 days: the fixture constructed NO defect, C1
  // correctly found nothing wrong, and this case reported PASS where it demanded VIOLATION —
  // the fixture-drift class PR #843 found in this repo's own harness. The `mutated === original`
  // guard below is the part that makes the drift impossible to miss next time.
  {
    const b = fixture('t2');
    const original = canonicalDoc.locales.en.disclosure13_1;
    const mutated = original.replace(/ for \d+ (day|days) /, ' for 999 days ');
    if (mutated === original) {
      throw new Error(
        'T2 fixture constructed NO defect: the canonical en disclosure13_1 no longer matches the ' +
          'mutation pattern. Fix the pattern — a red-first case that cannot go red is worthless.',
      );
    }
    write(b, P.banner, realBanner.replace(original, mutated));
    expect(
      'C1 catches a mandated sentence edited in COPY (disarmed)',
      b,
      false,
      'NOT byte-identical',
    );
  }

  // T3 — the armed happy path.
  expect(
    'a complete implementation passes when all three conditions hold',
    arm(fixture('t3')),
    true,
  );

  // T4 — C1 red-first, ARMED: one locale trimmed in the served document.
  //      This is THE ESC-051 failure mode — byte pressure dropping legal text.
  {
    const trimmed = JSON.parse(JSON.stringify(canonicalDoc.locales));
    trimmed.pl.disclosure13_2 = trimmed.pl.disclosure13_2.slice(0, 40);
    expect(
      'C1 catches ONE locale trimmed in the served document',
      arm(fixture('t4'), { served: trimmed }),
      false,
      "locale 'pl'",
    );
  }

  // T5 — C1: a locale dropped from the served document entirely.
  {
    const dropped = JSON.parse(JSON.stringify(canonicalDoc.locales));
    delete dropped.es;
    expect(
      'C1 catches a locale dropped from the served document',
      arm(fixture('t5'), { served: dropped }),
      false,
      "missing locale 'es'",
    );
  }

  // T6 — C2: a parameterized URL. The named §D3 erosion path (`?tenant=`).
  {
    const url =
      "const CONSENT_TEXT_URL = 'https://cp.example/consent-text.json?tenant=estalara';\n" +
      "export const load = () => fetch(CONSENT_TEXT_URL, { credentials: 'omit' });\n";
    expect(
      'C2 catches a query string on the consent-text URL',
      arm(fixture('t6'), { url }),
      false,
      'query string',
    );
  }

  // T7 — C2: a RUNTIME value interpolated into the URL. The §D3 erosion path one layer less
  //      obvious than `?tenant=` — the call site still looks static.
  {
    const url =
      'const base = window.location.origin;\n' +
      'const CONSENT_TEXT_URL = `${base}/consent-text.json`;\n' +
      "export const load = () => fetch(CONSENT_TEXT_URL, { credentials: 'omit' });\n";
    expect(
      'C2 catches a RUNTIME value interpolated into the URL',
      arm(fixture('t7'), { url }),
      false,
      'not a compile-time constant',
    );
  }

  // T7b — C2, the GREEN direction. Composing from other compile-time constants is how
  //       `packages/shared/src/domains.ts` writes every service URL, and ADR-0021 §D2 names that
  //       file as where this constant belongs. Rejecting it would force the implementation to
  //       hard-code a hostname the rest of the module derives — a fix worse than the defect.
  {
    const url =
      "const CONTROL_PLANE_URL = 'https://admin.example.com';\n" +
      'const CONSENT_TEXT_URL = `${CONTROL_PLANE_URL}/consent-text.json` as const;\n' +
      "export const load = () => fetch(CONSENT_TEXT_URL, { credentials: 'omit' });\n";
    expect(
      'C2 ACCEPTS a URL composed from compile-time constants',
      arm(fixture('t7b'), { url }),
      true,
    );
  }

  // T8 — C2: credentials omitted from the fetch options.
  {
    const url =
      "const CONSENT_TEXT_URL = 'https://cp.example/consent-text.json';\n" +
      'export const load = () => fetch(CONSENT_TEXT_URL, { mode: in_cors });\n'.replace(
        'in_cors',
        "'cors'",
      );
    expect(
      "C2 catches a fetch without credentials: 'omit'",
      arm(fixture('t8'), { url }),
      false,
      "credentials: 'omit'",
    );
  }

  // T9 — C3: the DPIA left pointing at the COPY constant after the move.
  expect(
    'C3 catches a DPIA cross-reference left pointing at COPY',
    arm(fixture('t9'), { dpia: dpiaPreMove }),
    false,
    'no longer carries them',
  );

  // T9b — C3's SECOND branch, which had no red-first proof of its own: the stale COPY references
  //       are gone, but the DPIA never names where the strings actually went. Deleting a wrong
  //       cross-reference is not the same as writing a right one, and Rule N wants the latter.
  expect(
    'C3 catches a DPIA that dropped COPY but never names the new source of record',
    arm(fixture('t9b'), {
      dpia: '## 13.1\n\nThe disclosure strings are defined elsewhere.\n',
    }),
    false,
    'never names',
  );

  // T10 — the both-homes-empty state: strings in flight with no home.
  {
    const b = arm(fixture('t10'));
    write(b, P.served, JSON.stringify({ schema_version: 1, locales: {} }, null, 2));
    expect('C1 catches the strings having NO home at all', b, false, 'NEITHER');
  }

  // T11 — the canonical record itself deleted.
  {
    const b = fixture('t11');
    fs.rmSync(path.join(b, P.canonical));
    expect('a deleted canonical record is a violation, not a pass', b, false, 'MISSING');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('');
  if (failures) {
    console.log(`RESULT: --self-test FAILED — ${failures} case(s) failed, ${passes} passed.`);
    process.exit(1);
  }
  console.log(`RESULT: --self-test passed — ${passes} cases.`);
}

// ── main ─────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { problems, notes, armed } = check(ROOT);
  for (const n of notes) console.log(n);
  console.log('');
  if (problems.length) {
    console.log(`RESULT: ${problems.length} ADR-0021 §D5 binding-condition violation(s).`);
    for (const p of problems) console.log(`  - ${p}`);
    console.log('');
    console.log('These conditions are the compliance countersign (PR #703). A violation is not a');
    console.log('style finding: the countersign is void if they are dropped or weakened.');
    process.exit(1);
  }
  console.log(
    `RESULT: ADR-0021 §D5 binding conditions hold (${armed ? 'ARMED — implementation present' : 'DISARMED — implementation absent; C1 enforced against the SDK COPY constant'}).`,
  );
}
