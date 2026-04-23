import { ConnectionError } from '../errors.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ConnectionError && attempt < maxRetries) {
        await sleep(delayMs * 2 ** attempt);
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
