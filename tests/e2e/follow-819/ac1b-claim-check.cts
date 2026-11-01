/**
 * FOLLOW-1345 AC(1b): the control plane's own claim check, run on the served texts.
 *
 * `differentiator-e2e.mjs` is plain ESM under bare `node`: it cannot import `typed-claims.ts`, which
 * is TypeScript and resolves `@/`. It runs this file through `tsx --tsconfig
 * apps/control-plane/tsconfig.json` instead (`runAc1bClaimCheck()`), the way `package.json` runs the
 * control plane's own scripts. No check and no field mapping is copied into the harness, and `tsx`,
 * its hooks and `@sentry/nextjs` stay out of the harness's process.
 *
 * Everything below is what `GET /api/adapt/description` and the generator do, in the same order:
 *   - `fetchDescriptionGrounding()`, the route's reader of the listing-details API
 *     (`ESTALARA_BACKEND_URL`, `:8081` on localhost);
 *   - `buildGrounding([original], fields, …)`, the generator's `checkUnsupportedClaimsPy`. Its
 *     dialect is private to `grounding-check.ts` (and importing `claim-containment.ts`'s pulls in
 *     the whole generator). Of a dialect `sources` reads only `strip`, which decides whether a field
 *     value says "no"; `SOURCES_DIALECT` below serves that and nothing else reads the rest;
 *   - `checkTypedClaims()`, on each text.
 *
 * stdin: `{listingId, locale, texts: string[]}`. stdout: one JSON line,
 * `{original, fields, claims: TypedClaimCheck[][]}`, `claims[i]` being `texts[i]`'s. A listing the
 * reader cannot read is `original: ''`, as for the route; the verdict decides what that means.
 *
 * @module tests/e2e/follow-819/ac1b-claim-check
 */

import { areaNumberPattern, buildGrounding } from '@/lib/claim-rules';
import { fetchDescriptionGrounding } from '@/lib/listing-facts-context';
import { checkTypedClaims } from '@/lib/typed-claims';

interface Input {
  listingId: string;
  locale: 'en' | 'pl' | 'es';
  texts: string[];
}

const SOURCES_DIALECT = {
  digit: /\d+/g,
  areaNumber: areaNumberPattern('\\d', '\\s', 'gi'),
  strip: (value: string): string => value.trim(),
  areaFromNegativeFields: false,
};

async function main(): Promise<void> {
  let raw = '';
  for await (const chunk of process.stdin) raw += String(chunk);
  const { listingId, locale, texts } = JSON.parse(raw) as Input;

  const { originalDescription, fields } = await fetchDescriptionGrounding(listingId, locale);
  const { sources } = buildGrounding([originalDescription], fields, SOURCES_DIALECT);

  process.stdout.write(
    `${JSON.stringify({
      original: originalDescription,
      fields,
      claims: texts.map((text) => checkTypedClaims(text, sources)),
    })}\n`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
