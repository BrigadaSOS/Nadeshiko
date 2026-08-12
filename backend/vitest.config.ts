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
    // preflight loads .env.test over .env and fails fast when Postgres is
    // unreachable; matchers registers `toEqualUnordered`. Both must run before
    // a test file's imports pull in @config/config, which validates env.
    setupFiles: ['./tests/helpers/preflight.ts', './tests/helpers/matchers.ts'],
    // The suite shares one local Postgres and one Elasticsearch index, and
    // files truncate each other's fixtures. A single fork running files one at
    // a time is a correctness requirement, not a tidiness preference.
    //
    // `maxWorkers: 1` is vitest 4's spelling of what was
    // `poolOptions: { forks: { singleFork: true } }`. That key was removed in v4
    // and is now a type error rather than a silent no-op -- worth knowing,
    // because a config that merely stopped being READ would have left the suite
    // sharing a database across parallel forks and failing at random.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    // No `bail`. The old bunfig set `bail = 1` to keep a broken shared fixture
    // from producing hundreds of derived failures, but stopping at the first
    // failing file reports the rest of the suite as "skipped" — which reads as
    // "fine" and hides unrelated regressions. Skimming a cascade is cheaper
    // than missing a real failure; run `vitest --bail=1` when iterating on one.
    // Integration tests wait on Postgres and Elasticsearch refreshes.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    coverage: {
      // Requires @vitest/coverage-v8, which is only installed when someone
      // actually runs `vitest run --coverage`.
      provider: 'v8',
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
      exclude: ['db/migrations/**', 'generated/**', 'tests/fixtures/**', 'tests/helpers/**'],
    },
  },
});
