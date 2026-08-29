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
      provider: 'v8',
      // `text-summary` is what CI prints; `html` is how you find the uncovered
      // lines locally. Dropped clover and json from the defaults -- nothing reads
      // them, and they were writing two more files into an ignored directory.
      reporter: ['text-summary', 'html'],
      // A RATCHET, not a target. These are what the suite measured on
      // 2026-08-30, floored to the integer below; CI fails when coverage drops
      // under them, so the number can only be moved up and moving it up is a
      // deliberate edit. Set a point or so BELOW the measurement rather than
      // level with it: floored to the integer, backend tolerated 20 new
      // uncovered lines and discord just 4, which is not a regression gate but
      // a tripwire on ordinary work. The margin is about one change's worth.
      //
      // They replaced a hand-written 90 across the board that
      // had never once been run -- the suite was 83/82/73/86 against it, so
      // wiring the gate to that number would have failed every build on the
      // day it was switched on, which is how a coverage gate gets turned back
      // off and never returns.
      thresholds: { lines: 89, functions: 89, branches: 78, statements: 88 },
      // `include` is what makes this a real denominator. Without it vitest only
      // reports files a test already imported, so a module nobody tests is not
      // 0% covered -- it is absent, and the percentage is "of the code we
      // touch", which flatters every number it produces. The backend barely
      // moved (83.3% -> 81.8%, its tests do reach nearly everything); the
      // frontend went 74% -> 38% and discord 58% -> 42% on the same change.
      include: ['app/**/*.ts', 'lib/**/*.ts', 'config/**/*.ts'],
      exclude: ['**/*.test.ts', 'db/migrations/**', 'generated/**', 'tests/fixtures/**', 'tests/helpers/**'],
    },
  },
});
