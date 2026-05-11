/**
 * pgvector custom column type for Drizzle ORM.
 *
 * Maps `vector(N)` columns to `number[]` in TypeScript. Uses the
 * pgvector textual format `[1.0,2.0,...]` over the wire.
 *
 * The pgvector extension must be enabled in the database:
 *   CREATE EXTENSION IF NOT EXISTS vector;
 *
 * @module @estalara/db/schema/_pgvector
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * Build a Drizzle column for `vector(N)`.
 *
 * Closure captures the dimension count; each call creates a new typed column.
 *
 * @example
 * const myCol = vector('embedding', 1024);
 */
export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${String(dimensions)})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: unknown): number[] {
      if (typeof value !== 'string') return [];
      // pgvector textual format: "[1,2,3]"
      const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
      if (inner.length === 0) return [];
      return inner.split(',').map(Number);
    },
  })(name, {});
