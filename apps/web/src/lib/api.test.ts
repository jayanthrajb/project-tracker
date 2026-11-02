import { describe, expect, it } from 'vitest';

import { ApiError, apiErrorMessage } from './api';

describe('apiErrorMessage', () => {
  it('surfaces unique per-item reasons from a rejected bulk update', () => {
    const error = new ApiError('Bulk update rejected', 400, {
      perItem: { a: 'Cannot close APP-1: open child items APP-2. Close them first.', b: 'Cannot close APP-1: open child items APP-2. Close them first.' },
    });
    expect(apiErrorMessage(error)).toBe('Cannot close APP-1: open child items APP-2. Close them first.');
  });

  it('falls back to the error message, then the fallback', () => {
    expect(apiErrorMessage(new ApiError('Cannot close APP-1', 400, null))).toBe('Cannot close APP-1');
    expect(apiErrorMessage('oops', 'Could not update status')).toBe('Could not update status');
  });
});
