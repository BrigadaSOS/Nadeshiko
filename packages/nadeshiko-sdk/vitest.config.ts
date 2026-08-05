import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `generated/` and `build/` are codegen output; only hand-written tests run.
    include: ['src/**/*.test.ts'],
  },
});
