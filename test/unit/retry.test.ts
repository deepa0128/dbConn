import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/driver/retry.js';
import { ConnectionError, DbError } from '../../src/errors.js';

// Use delay=0 throughout so tests don't need fake timers.

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, 3, 0)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on ConnectionError up to maxRetries', async () => {
    const err = new ConnectionError('refused');
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');
    expect(await withRetry(fn, 3, 0)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new ConnectionError('refused'));
    await expect(withRetry(fn, 2, 0)).rejects.toBeInstanceOf(ConnectionError);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry on non-ConnectionError', async () => {
    const fn = vi.fn().mockRejectedValue(new DbError('syntax error'));
    await expect(withRetry(fn, 3, 0)).rejects.toBeInstanceOf(DbError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
