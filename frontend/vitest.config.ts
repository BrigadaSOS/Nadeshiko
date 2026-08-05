import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nuxt's `~~` (project root) and `~` (srcDir) aliases are not otherwise known to
  // vitest, so any util importing a sibling through them would fail to resolve.
  // `~~` must stay first: vite matches aliases in declaration order.
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    include: ['app/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['app/**/*.nuxt.test.ts', 'server/**/*.nuxt.test.ts'],
    environment: 'node',
  },
});
