import { describe, expect, it } from 'vitest';

import { createClient } from './index.js';

describe('@estalara/db', () => {
  it('exports createClient as a function', () => {
    expect(typeof createClient).toBe('function');
  });

  it('createClient returns an object with query methods when given a url', () => {
    // We do not make a real DB connection in unit tests — just verify the
    // factory signature and that the returned object looks like a Drizzle DB.
    // postgres() lazily opens connections, so construction is synchronous and safe.
    const db = createClient('postgresql://user:pass@localhost:5432/test');
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
    expect(typeof db.update).toBe('function');
    expect(typeof db.delete).toBe('function');
  });

  it('createClient accepts poolMode session option', () => {
    const db = createClient('postgresql://user:pass@localhost:6543/test', {
      poolMode: 'session',
      max: 5,
    });
    expect(db).toBeDefined();
  });

  it('createClient accepts poolMode transaction option', () => {
    const db = createClient('postgresql://user:pass@localhost:5432/test', {
      poolMode: 'transaction',
      max: 1,
    });
    expect(db).toBeDefined();
  });
});
