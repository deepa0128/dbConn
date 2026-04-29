import { ConnectionError } from '../errors.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
  shouldRetry?: (err: unknown) => boolean,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const retryable = shouldRetry ? shouldRetry(err) : err instanceof ConnectionError;
      if (retryable && attempt < maxRetries) {
        await sleep(delayMs * 2 ** attempt);
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  // ±25% jitter to spread retry storms
  const jitter = ms * 0.25 * (Math.random() * 2 - 1);
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms + jitter)));
}
