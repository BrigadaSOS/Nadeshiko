import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['app/**/*.nuxt.test.ts', 'server/**/*.nuxt.test.ts'],
    environment: 'node',
  },
});
