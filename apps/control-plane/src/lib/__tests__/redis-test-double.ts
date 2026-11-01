/**
 * Redis for route tests of the buyer profile (FOLLOW-1316): an in-process stand-in for the Upstash
 * REST surface, or, when `BUYER_PROFILE_TEST_REDIS_URL` is set, the real localhost path
 * (`scripts/dev/upstash-rest-path-adapter.mjs` -> SRH -> redis:7). Both record every request, so the
 * same assertions ("no command touched this key", "the xid is in no URL") run against either.
 *
 * The fake implements only what the control plane sends: POST `/` and `/pipeline`, and the path-form
 * GET the chat-intent cache reads with. It honours NX, XX, EX, EXAT and KEEPTTL with Redis's
 * semantics, because those are what the retention requirements (R21) rest on.
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
  /** Run a callback right after this command name executes, once. Fake only. */
  afterCommand(name: string, run: () => void): void;
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
    afterCommand: () => {
      throw new Error('hook injection needs the in-process fake');
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
  const hooks = new Map<string, () => void>();
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

  const execute = (command: string[]): unknown => {
    const [nameRaw, ...args] = command;
    const name = (nameRaw ?? '').toUpperCase();
    const key = args[0] ?? '';
    let result: unknown;
    switch (name) {
      case 'SET':
        result = set(args);
        break;
      case 'GET':
        result = live(key)?.value ?? null;
        break;
      case 'DEL':
        result = live(key) ? 1 : 0;
        store.delete(key);
        break;
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
    const hook = hooks.get(name);
    if (hook) {
      hooks.delete(name);
      hook();
    }
    return result;
  };

  const reply = (command: string[]): { result: unknown } | { error: string } => {
    if ((command[0] ?? '').toUpperCase() === failingCommand) {
      return { error: 'ERR injected failure' };
    }
    try {
      return { result: execute(command) };
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
        return Promise.resolve(jsonResponse(200, commands.map(reply)));
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
    afterCommand: (name, run) => {
      hooks.set(name, run);
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
