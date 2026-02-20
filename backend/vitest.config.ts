import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    env: {
      POSTGRES_DB: 'nadeshiko_test',
      LOG_LEVEL: 'silent',
      BASE_URL: 'http://localhost:3000',
    },
  },
});
