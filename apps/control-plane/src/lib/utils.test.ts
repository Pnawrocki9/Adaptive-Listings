import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles conditional classes via ternary', () => {
    const classA = 'active';
    const classB = undefined;
    expect(cn('base', classA, 'added')).toBe('base active added');
    expect(cn('base', classB, 'added')).toBe('base added');
  });

  it('handles undefined gracefully', () => {
    expect(cn('base', undefined)).toBe('base');
  });

  it('handles array inputs', () => {
    expect(cn(['px-2', 'py-1'])).toBe('px-2 py-1');
  });

  it('handles object inputs (conditional map)', () => {
    expect(cn({ 'text-red-500': true, 'text-blue-500': false })).toBe('text-red-500');
  });

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('');
  });

  it('resolves Tailwind text color conflicts', () => {
    const result = cn('text-red-500', 'text-blue-700');
    expect(result).toBe('text-blue-700');
  });
});
