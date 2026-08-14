/**
 * The post-ACK ClickHouse write must be REGISTERED with `executionCtx.waitUntil`, and the
 * registration must survive the way the real runtime defines that method. [FOLLOW-986]
 *
 * ## Why this file exists rather than another case in `index.test.ts`
 *
 * `index.test.ts`'s `mockExecutionCtx()` defines `waitUntil` as an own ARROW PROPERTY:
 *
 *     ctx: { waitUntil: (p) => { tasks.push(p); } }
 *
 * An arrow property carries no `this`, so it works when invoked detached. workerd's real
 * `ExecutionContext` defines `waitUntil` as a PROTOTYPE METHOD, which throws when invoked
 * detached. `getWaitUntil` used to return `ctx.waitUntil` detached — so **314 tests passed while
 * the write was never registered in production**, and the only thing exercising the real runtime,
 * the nightly E2E, had been dead at step 6 for 102 days and could not report it.
 *
 * The defect was not in the handler and not in the assertion. It was in the SHAPE OF THE MOCK:
 * it was structurally incapable of failing. So the fixture here mirrors the runtime's shape
 * instead of a convenient one.
 */
import { describe, it, expect } from 'vitest';
// The SHIPPED function, not a copy. A test that re-implements its subject cannot fail when
// the subject changes (FOLLOW-980's shape), so this imports across the module boundary.
import { getWaitUntil } from './handlers/events.js';

/** Mirrors workerd: `waitUntil` lives on the PROTOTYPE and needs its receiver. */
class RuntimeShapedExecutionContext {
  readonly registered: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>): void {
    // Throws if `this` is lost — exactly as the native implementation does.
    this.registered.push(promise);
  }
  passThroughOnException(): void {
    // Part of the ExecutionContext shape; unused here.
  }
}

/** The shape `index.test.ts` uses — kept here to document why it cannot catch this. */
function arrowShapedCtx() {
  const registered: Promise<unknown>[] = [];
  return {
    registered,
    waitUntil: (p: Promise<unknown>) => {
      registered.push(p);
    },
  };
}

describe('FOLLOW-986 — post-ACK work survives a runtime-shaped ExecutionContext', () => {
  it('registers the promise when waitUntil is a PROTOTYPE method (the runtime shape)', () => {
    const ctx = new RuntimeShapedExecutionContext();
    const register = getWaitUntil({ executionCtx: ctx });
    expect(register, 'getWaitUntil returned nothing for a valid ExecutionContext').toBeTypeOf(
      'function',
    );
    const p = Promise.resolve('ch-write');
    expect(() => {
      register?.(p);
    }).not.toThrow();
    expect(ctx.registered, 'the promise reached waitUntil').toEqual([p]);
  });

  it('the DETACHED form — what shipped — throws against the runtime shape', () => {
    // Red-first, pinned: this is the exact expression `getWaitUntil` used to return.
    const ctx = new RuntimeShapedExecutionContext();
    // Detaching it IS the subject here: this pins the failure mode the linter now blocks in
    // source, so the rule firing on this line is the point rather than an inconvenience.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberate: see above
    const detached = ctx.waitUntil;
    expect(() => {
      detached(Promise.resolve());
    }).toThrow();
    expect(ctx.registered, 'nothing was registered, and nothing said so').toEqual([]);
  });

  it('the arrow-shaped mock survives detachment — which is WHY the bug was invisible', () => {
    const ctx = arrowShapedCtx();
    const detached = ctx.waitUntil;
    // No eslint-disable needed here, and that asymmetry is the finding: an arrow-typed property
    // does not trip `unbound-method` at all — which is precisely why the real declaration being
    // property-typed kept the rule silent on shipped code.
    expect(() => {
      detached(Promise.resolve());
    }).not.toThrow();
    expect(ctx.registered).toHaveLength(1);
  });

  it('returns undefined — not a throwing stub — when there is no executionCtx', () => {
    expect(getWaitUntil({})).toBeUndefined();
    expect(
      getWaitUntil({
        get executionCtx(): never {
          throw new Error('Hono throws when executionCtx is unavailable');
        },
      }),
    ).toBeUndefined();
  });
});
