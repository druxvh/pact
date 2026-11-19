import { describe, expect, it } from 'vitest';
import { isExpectedAsyncError } from './asyncErrors';

const named = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('isExpectedAsyncError', () => {
  it('treats offline, aborted and expired-session failures as expected', () => {
    expect(isExpectedAsyncError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isExpectedAsyncError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isExpectedAsyncError(named('AbortError', 'The operation was aborted'))).toBe(true);
    expect(isExpectedAsyncError(named('TimeoutError'))).toBe(true);
    expect(isExpectedAsyncError(named('AuthRetryableFetchError', 'fetch failed'))).toBe(true);
    expect(isExpectedAsyncError(named('AuthSessionMissingError'))).toBe(true);
  });

  it('knows the Communities store already surfaced its own errors', () => {
    expect(isExpectedAsyncError(named('CommunityError', 'not_allowed'))).toBe(true);
  });

  it('leaves genuine bugs alone', () => {
    expect(isExpectedAsyncError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isExpectedAsyncError(new RangeError('Invalid array length'))).toBe(false);
    expect(isExpectedAsyncError(new Error('boom'))).toBe(false);
    expect(isExpectedAsyncError(undefined)).toBe(false);
    expect(isExpectedAsyncError(null)).toBe(false);
    expect(isExpectedAsyncError('something odd')).toBe(false);
  });
});
