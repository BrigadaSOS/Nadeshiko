import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors `compilerOptions.paths` in tsconfig.json. Kept as explicit
    // entries rather than a tsconfig-paths plugin so there is one obvious place
    // to look when an import fails to resolve. `config/` is matched after
    // `@config/` because an alias list is applied in order.
    alias: [
      { find: /^@app\//, replacement: resolveFromRoot('./app/') },
      { find: /^@config\//, replacement: resolveFromRoot('./config/') },
      { find: /^@db\//, replacement: resolveFromRoot('./db/') },
      { find: /^@lib\//, replacement: resolveFromRoot('./lib/') },
      { find: /^generated\//, replacement: resolveFromRoot('./generated/') },
      { find: /^config\//, replacement: resolveFromRoot('./config/') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Load `.env.test`/matchers before test imports, because config validates environment at import time.
    setupFiles: ['./tests/helpers/preflight.ts', './tests/helpers/matchers.ts'],
    // Run one fork: tests share Postgres/Elasticsearch fixtures, and Vitest 4 uses `maxWorkers: 1` rather than the
    // removed `poolOptions.forks.singleFork`.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    // Do not set `bail` globally: it hides unrelated failures as skips. Use `vitest --bail=1` only while iterating on
    // one failure.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Keep `text-summary` for CI and `html` for local inspection; unused coverage formats only add ignored files.
      reporter: ['text-summary', 'html'],
      // Coverage thresholds are a ratchet below the measured baseline, not a target; `include` makes unimported source
      // part of the denominator. Raise thresholds deliberately.
      thresholds: { lines: 89, functions: 89, branches: 78, statements: 88 },
      // Explicit `include` prevents Vitest from reporting only imported files, which would flatter coverage.
      include: ['app/**/*.ts', 'lib/**/*.ts', 'config/**/*.ts'],
      exclude: ['**/*.test.ts', 'db/migrations/**', 'generated/**', 'tests/fixtures/**', 'tests/helpers/**'],
    },
  },
});
