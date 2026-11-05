/**
 * Redis for route tests of the buyer profile (FOLLOW-1316): an in-process stand-in for the Upstash
 * REST surface, or, when `BUYER_PROFILE_TEST_REDIS_URL` is set, the real localhost path
 * (`scripts/dev/upstash-rest-path-adapter.mjs` -> SRH -> redis:7). Both record every request, so the
 * same assertions ("no command touched this key", "the xid is in no URL") run against either.
 *
 * The fake implements only what the control plane sends: POST `/` and `/pipeline`, and the path-form
 * GET the chat-intent cache reads with. It honours NX, XX, EX, EXAT and KEEPTTL with Redis's
 * semantics, because those are what the retention requirements (R21) rest on.
 *
 * LIMIT: the fake cannot run Lua. It recognises the store's two scripts by their first-line marker and
 * runs a JavaScript mirror of them, so on the fake the scripts' text is NOT under test. Only a run
 * with `BUYER_PROFILE_TEST_REDIS_URL` executes the real scripts, and CI has no such run.
 */

interface Entry {
  value: string;
  expiresAtMs: number | null;
}

export interface RecordedRedisRequest {
  url: string;
  method: string;
  body: string;
}

export interface RedisTestDouble {
  /** Base URL to put in `UPSTASH_REDIS_URL`. */
  readonly url: string;
  /** True when the requests reach a real Redis through the localhost adapter. */
  readonly real: boolean;
  /** Every request the code under test sent. */
  readonly requests: RecordedRedisRequest[];
  /** The `fetch` handler for URLs under {@link url}. */
  handle(url: string, init?: RequestInit): Promise<Response>;
  /** Run a command directly, unrecorded, as a test's own look at the store. */
  raw(command: string[]): Promise<unknown>;
  /** Answer every recorded request with this HTTP status. Fake only; `null` restores. */
  failHttp(status: number | null): void;
  /** Answer `{ error }` for this command name. Fake only; `null` restores. */
  failCommand(name: string | null): void;
  /** Run a callback once, right before the next command that writes a profile. Fake only. */
  onceBeforeProfileWrite(run: () => void): void;
  /** Run a callback once, right after the next command that writes a profile. Fake only. */
  onceAfterProfileWrite(run: () => void): void;
  /** Answer the next profile write with this reply instead of its real one. Fake only. */
  replaceNextProfileWriteReply(reply: unknown): void;
  /** Execute the next request, then fail its response as a lost connection does. Fake only. */
  loseNextResponse(): void;
  /** Delete every key this test created; a no-op on the fake beyond clearing it. */
  cleanup(keys: string[]): Promise<void>;
}

const REAL_URL = process.env.BUYER_PROFILE_TEST_REDIS_URL;
const REAL_TOKEN = process.env.BUYER_PROFILE_TEST_REDIS_TOKEN ?? 'local-dev-token';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function realDouble(realFetch: typeof fetch, base: string): RedisTestDouble {
  const requests: RecordedRedisRequest[] = [];
  const raw = async (command: string[]): Promise<unknown> => {
    const res = await realFetch(`${base}/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${REAL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    return ((await res.json()) as { result?: unknown }).result ?? null;
  };
  return {
    url: base,
    real: true,
    requests,
    handle: (url, init) => {
      requests.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return realFetch(url, init);
    },
    raw,
    failHttp: () => {
      throw new Error('failure injection needs the in-process fake');
    },
    failCommand: () => {
      throw new Error('failure injection needs the in-process fake');
    },
    onceBeforeProfileWrite: () => {
      throw new Error('hook injection needs the in-process fake');
    },
    onceAfterProfileWrite: () => {
      throw new Error('hook injection needs the in-process fake');
    },
    replaceNextProfileWriteReply: () => {
      throw new Error('failure injection needs the in-process fake');
    },
    loseNextResponse: () => {
      throw new Error('failure injection needs the in-process fake');
    },
    cleanup: async (keys) => {
      for (const key of keys) await raw(['DEL', key]);
    },
  };
}

function fakeDouble(): RedisTestDouble {
  const base = 'http://redis.test';
  const store = new Map<string, Entry>();
  const requests: RecordedRedisRequest[] = [];
  let beforeWrite: (() => void) | null = null;
  let afterWrite: (() => void) | null = null;
  let losingNextResponse = false;
  let replacementReply: { value: unknown } | null = null;
  let httpFailure: number | null = null;
  let failingCommand: string | null = null;

  const live = (key: string): Entry | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const set = (args: string[]): unknown => {
    const [key, value, ...rest] = args;
    if (key === undefined || value === undefined) throw new Error('ERR wrong number of arguments');
    const options = rest.map((o) => o.toUpperCase());
    const existing = live(key);
    if (options.includes('NX') && existing) return null;
    if (options.includes('XX') && !existing) return null;
    let expiresAtMs: number | null = null;
    const exat = options.indexOf('EXAT');
    const ex = options.indexOf('EX');
    if (exat !== -1) expiresAtMs = Number(options[exat + 1]) * 1000;
    else if (ex !== -1) expiresAtMs = Date.now() + Number(options[ex + 1]) * 1000;
    else if (options.includes('KEEPTTL')) expiresAtMs = existing?.expiresAtMs ?? null;
    store.set(key, { value, expiresAtMs });
    return 'OK';
  };

  /** The JavaScript mirror of the store's write script; see the LIMIT note at the top. */
  const evalWrite = (keys: string[], args: string[]): string => {
    const [key = '', tombstone = ''] = keys;
    const [value = '', expiresAt = '', source = ''] = args;
    if (live(tombstone)) return 'tombstoned';
    const current = live(key);
    if (current) {
      if (source === 'behavior' && current.value.includes('"source":"quiz"')) return 'outranked';
      current.value = value;
      return 'overwritten';
    }
    store.set(key, { value, expiresAtMs: Number(expiresAt) * 1000 });
    return 'created';
  };

  /** The JavaScript mirror of the store's delete script; see the LIMIT note at the top. */
  const evalDelete = (keys: string[], args: string[]): number => {
    const [key = '', tombstone = ''] = keys;
    const ttlSeconds = Number(args[0]);
    const existing = live(tombstone);
    const left = existing?.expiresAtMs ? (existing.expiresAtMs - Date.now()) / 1000 : -2;
    if (left < ttlSeconds) {
      store.set(tombstone, { value: '1', expiresAtMs: Date.now() + ttlSeconds * 1000 });
    }
    const had = live(key) ? 1 : 0;
    store.delete(key);
    return had;
  };

  const runScript = (args: string[]): unknown => {
    const [script = '', keyCount = '0', ...rest] = args;
    const count = Number(keyCount);
    const keys = rest.slice(0, count);
    const argv = rest.slice(count);
    if (script.startsWith('-- buyer_profile_write')) return evalWrite(keys, argv);
    if (script.startsWith('-- buyer_profile_delete')) return evalDelete(keys, argv);
    throw new Error('ERR the fake runs only the store scripts it mirrors');
  };

  const execute = (command: string[]): unknown => {
    const [nameRaw, ...args] = command;
    const name = (nameRaw ?? '').toUpperCase();
    const key = args[0] ?? '';
    let result: unknown;
    switch (name) {
      case 'EVAL':
        result = runScript(args);
        break;
      case 'SET':
        result = set(args);
        break;
      case 'GET':
        result = live(key)?.value ?? null;
        break;
      case 'DEL': {
        // Multi-key, as Redis: the DSR erase deletes a SCAN page in one command (FOLLOW-1308).
        let removed = 0;
        for (const k of args) {
          if (live(k)) removed += 1;
          store.delete(k);
        }
        result = removed;
        break;
      }
      case 'SCAN': {
        // One page holds every match and the cursor ends at '0'; only `*` globs are supported.
        const at = args.findIndex((a) => a.toUpperCase() === 'MATCH');
        const glob = at === -1 ? '*' : (args[at + 1] ?? '*');
        const re = new RegExp(
          `^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
        );
        result = ['0', [...store.keys()].filter((k) => live(k) && re.test(k))];
        break;
      }
      case 'EXISTS':
        result = live(key) ? 1 : 0;
        break;
      case 'PTTL': {
        const entry = live(key);
        if (!entry) result = -2;
        else result = entry.expiresAtMs === null ? -1 : entry.expiresAtMs - Date.now();
        break;
      }
      case 'PEXPIRE': {
        const entry = live(key);
        if (entry) entry.expiresAtMs = Date.now() + Number(args[1]);
        result = entry ? 1 : 0;
        break;
      }
      case 'INCR': {
        const entry = live(key);
        const next = Number(entry?.value ?? '0') + 1;
        store.set(key, { value: String(next), expiresAtMs: entry?.expiresAtMs ?? null });
        result = next;
        break;
      }
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
    return result;
  };

  const reply = (command: string[]): { result: unknown } | { error: string } => {
    const name = (command[0] ?? '').toUpperCase();
    if (name === failingCommand) {
      return { error: 'ERR injected failure' };
    }
    const writesProfile =
      (name === 'EVAL' && (command[1] ?? '').startsWith('-- buyer_profile_write')) ||
      (name === 'SET' && (command[1] ?? '').startsWith('buyer_profile:'));
    try {
      if (writesProfile && beforeWrite) {
        const run = beforeWrite;
        beforeWrite = null;
        run();
      }
      const result = execute(command);
      if (writesProfile && afterWrite) {
        const run = afterWrite;
        afterWrite = null;
        run();
      }
      if (writesProfile && replacementReply) {
        const { value } = replacementReply;
        replacementReply = null;
        return { result: value };
      }
      return { result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  return {
    url: base,
    real: false,
    requests,
    handle: (url, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      requests.push({ url, method: init?.method ?? 'GET', body });
      if (httpFailure !== null) {
        return Promise.resolve(jsonResponse(httpFailure, { error: 'injected' }));
      }
      const { pathname } = new URL(url);
      if (pathname === '/pipeline') {
        const commands = JSON.parse(body) as string[][];
        const replies = commands.map(reply);
        if (losingNextResponse) {
          losingNextResponse = false;
          return Promise.reject(new Error('injected: connection lost after the command ran'));
        }
        return Promise.resolve(jsonResponse(200, replies));
      }
      if (pathname === '/') {
        const out = reply(JSON.parse(body) as string[]);
        return Promise.resolve(jsonResponse('error' in out ? 400 : 200, out));
      }
      const args = pathname.split('/').filter(Boolean).map(decodeURIComponent);
      return Promise.resolve(jsonResponse(200, reply(args)));
    },
    raw: (command) => Promise.resolve(execute(command)),
    failHttp: (status) => {
      httpFailure = status;
    },
    failCommand: (name) => {
      failingCommand = name;
    },
    onceBeforeProfileWrite: (run) => {
      beforeWrite = run;
    },
    onceAfterProfileWrite: (run) => {
      afterWrite = run;
    },
    replaceNextProfileWriteReply: (reply) => {
      replacementReply = { value: reply };
    },
    loseNextResponse: () => {
      losingNextResponse = true;
    },
    cleanup: () => {
      store.clear();
      return Promise.resolve();
    },
  };
}

/**
 * Build the double for one test file.
 *
 * @param realFetch - The unstubbed `fetch`, taken before the test stubs the global.
 */
export function createRedisTestDouble(realFetch: typeof fetch): RedisTestDouble {
  return REAL_URL ? realDouble(realFetch, REAL_URL.replace(/\/$/, '')) : fakeDouble();
}
