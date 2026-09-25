/**
 * Worker-safe structured JSON logger for Estalara services.
 *
 * Replaces pino with a `console.log(JSON.stringify(...))` implementation that
 * is compatible with V8 isolates (Cloudflare Workers, Edge Runtime). Pino
 * requires Node.js `worker_threads`, `fs.createWriteStream`, and SonicBoom for
 * async fd flushing — none of which are available in Cloudflare Workers even
 * under `nodejs_compat`.
 *
 * API is a drop-in superset of the pino logger interface used across this
 * codebase: `info`, `warn`, `error`, `debug`, `child`. Both call signatures are
 * supported:
 *   logger.info({ key: 'val' }, 'message')  — object + message
 *   logger.info('message')                  — message only
 *
 * Output format:
 *   {"level":"info","msg":"...","timestamp":"2026-05-18T12:00:00.000Z","service":"apps/ingest",...}
 *
 * @module @estalara/shared/observability/logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Structured logger interface — matches the subset of the pino Logger API
 * used across ingest and control-plane.
 */
export interface Logger {
  level: string;
  info(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
  /**
   * Returns a child logger that merges `bindings` into every log line.
   * Mirrors pino's `logger.child(bindings)` signature.
   */
  child(bindings: Record<string, unknown>): Logger;
  /**
   * Returns the fixed fields bound to this logger instance.
   * Provided for test compatibility — mirrors pino's `logger.bindings()`.
   */
  bindings(): Record<string, unknown>;
}

class WorkerLogger implements Logger {
  private readonly _bindings: Record<string, unknown>;
  private readonly _minLevel: number;
  readonly level: string;

  constructor(bindings: Record<string, unknown>, level: string) {
    this._bindings = bindings;
    this.level = level;
    // Safely index into LEVEL_ORDER; unknown level strings default to 'info'.
    const levelOrder: Record<string, number> = LEVEL_ORDER;
    this._minLevel = levelOrder[level] ?? LEVEL_ORDER.info;
  }

  bindings(): Record<string, unknown> {
    return { ...this._bindings };
  }

  child(extraBindings: Record<string, unknown>): Logger {
    return new WorkerLogger({ ...this._bindings, ...extraBindings }, this.level);
  }

  info(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this._log('info', objOrMsg, msg);
  }

  warn(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this._log('warn', objOrMsg, msg);
  }

  error(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this._log('error', objOrMsg, msg);
  }

  debug(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this._log('debug', objOrMsg, msg);
  }

  private _log(
    levelName: LogLevel,
    objOrMsg: Record<string, unknown> | string,
    msg?: string,
  ): void {
    if (LEVEL_ORDER[levelName] < this._minLevel) return;

    const fields: Record<string, unknown> =
      typeof objOrMsg === 'string' ? { msg: objOrMsg } : { ...objOrMsg, msg: msg ?? '' };

    const line = JSON.stringify({
      level: levelName,
      timestamp: new Date().toISOString(),
      ...this._bindings,
      ...fields,
    });

    console.log(line);
  }
}

/**
 * Creates a structured Worker-safe logger pre-tagged with service metadata.
 *
 * @param serviceName - The service identifier, e.g. `apps/ingest`. Appears as
 *   `service.name` in every log line.
 * @returns A `Logger` instance.
 *
 * @example
 * ```ts
 * import { createLogger } from '@estalara/shared/observability';
 * const logger = createLogger('apps/ingest');
 * logger.info({ tenant_id: 'abc' }, 'event received');
 * ```
 */
export function createLogger(serviceName: string): Logger {
  // process.env is available in Node.js and in Cloudflare Workers under nodejs_compat.
  const level = process.env.LOG_LEVEL ?? 'info';

  return new WorkerLogger(
    {
      service: {
        name: serviceName,
        version: process.env.GIT_SHA ?? 'dev',
      },
    },
    level,
  );
}
