import { describe, expect, it } from 'vitest';

import { ErrorCode, errorBody } from '../errors.js';

describe('errorBody helper', () => {
  it('returns correct ErrorResponseBody shape', () => {
    const result = errorBody({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid payload',
      requestId: 'req-123',
      details: { field: 'events' },
    });

    expect(result).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload',
        request_id: 'req-123',
        details: { field: 'events' },
      },
    });
  });

  it('includes request_id in error object', () => {
    const result = errorBody({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'Authentication required',
      requestId: 'req-abc-xyz',
    });

    expect(result.error.request_id).toBe('req-abc-xyz');
  });

  it('details field is optional', () => {
    const result = errorBody({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
      requestId: 'req-456',
    });

    expect(result.error.details).toBeUndefined();
    expect('details' in result.error).toBe(false);
  });

  it('all ErrorCode values are strings', () => {
    for (const value of Object.values(ErrorCode)) {
      expect(typeof value).toBe('string');
    }
  });
});
