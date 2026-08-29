import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // `text-summary` is what CI prints; `html` is how you find the uncovered
      // lines locally. Dropped clover and json from the defaults -- nothing reads
      // them, and they were writing two more files into an ignored directory.
      reporter: ['text-summary', 'html'],
      // See the note in backend/vitest.config.ts: a ratchet at what the suite
      // measured, not an aspiration. It was 39/35/36/38 when first switched on;
      // the gap it described was real -- an off-by-one in a four-line
      // `truncate`, and a `NaN% human` in /stats, both lived here undetected
      // because nothing exercised them. The suite now reaches the whole bot
      // except the composition root in `bot.ts`, whose routing was lifted into
      // `events.ts` precisely so it could be.
      thresholds: { lines: 91, functions: 94, branches: 83, statements: 89 },
      // See the note on `include` in backend/vitest.config.ts -- without it this
      // read 58%, counting only the files the tests already import.
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/test/**', 'src/register.ts'],
    },
  },
});
