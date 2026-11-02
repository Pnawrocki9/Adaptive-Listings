/**
 * FOLLOW-1460: `scripts/dev/localhost-up.sh` gives the local control plane a staff-token secret of
 * its own, the same way as the other generated local secrets, without ever printing it. Read from the
 * script's text: starting the stack is not a unit test.
 *
 * @module tests/e2e/follow-819/localhost-up-jwt-secret.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(resolve(__dirname, '../../../scripts/dev/localhost-up.sh'), 'utf8');

describe('localhost-up.sh local staff-token secret', () => {
  it('lives in the git-ignored state dir', () => {
    expect(SCRIPT).toContain('SUPABASE_JWT_SECRET_FILE="$STATE_DIR/local-staff-jwt-secret"');
  });

  it('is generated once, owner-only, and validated', () => {
    expect(SCRIPT).toMatch(/if \[ ! -s "\$SUPABASE_JWT_SECRET_FILE" \]; then\n\s+\(umask 077 &&/);
    expect(SCRIPT).toContain('SUPABASE_JWT_SECRET="$(cat "$SUPABASE_JWT_SECRET_FILE")"');
  });

  it('reaches the control plane', () => {
    const start = SCRIPT.slice(SCRIPT.indexOf('start_bg control-plane-3000'));
    expect(start.slice(0, start.indexOf('CP_CMD'))).toContain(
      '"SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET"',
    );
  });

  it('is never printed', () => {
    const printing = SCRIPT.split('\n').filter((line) => /^\s*(log|echo|printf|step)\b/.test(line));
    expect(printing.filter((line) => line.includes('$SUPABASE_JWT_SECRET'))).toEqual([]);
  });
});
