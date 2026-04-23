import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests hit real databases; allow more time per test.
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
