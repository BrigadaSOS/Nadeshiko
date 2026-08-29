import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Replaces Nuxt's build-time `import.meta.client` / `import.meta.server` flags.
 *
 * Nuxt substitutes these when it builds; vitest does not, so without them every
 * `if (!import.meta.client) return` in the app layer reads as false and the whole
 * client path is unreachable from a test -- the Anki store, the player, the
 * YouTube embed and the analytics plugins are each guarded by exactly that line.
 *
 * DONE AS A PLUGIN RATHER THAN WITH `define`, which is the obvious way and is
 * quietly wrong here: Vite's `define` reaches files in the `node` environment but
 * NOT files running under `happy-dom`, which is every component test. The result
 * is not a failure -- it is a component silently exercised in its SERVER
 * configuration while the suite goes green, which is the one outcome a coverage
 * number cannot show you. Measured on 2026-08-31: `node` saw `true`, `happy-dom`
 * saw `undefined`, from the same config.
 *
 * Safe to apply everywhere: nothing under `server/` or `shared/` reads either
 * flag, so only the app layer's compilation changes.
 */
function importMetaFlags(): Plugin {
  return {
    name: 'nadeshiko:import-meta-flags',
    enforce: 'pre',
    transform(code) {
      if (!code.includes('import.meta.client') && !code.includes('import.meta.server')) return null;
      return code.replaceAll('import.meta.client', 'true').replaceAll('import.meta.server', 'false');
    },
  };
}

export default defineConfig({
  // Nuxt's `~~` (project root), `~` (srcDir) and `#shared` aliases are not
  // otherwise known to vitest, so any util importing a sibling through them
  // would fail to resolve. `~~` must stay first: vite matches aliases in
  // declaration order.
  resolve: {
    alias: {
      // `#app` is generated into `.nuxt/` by `nuxt prepare`. Aliasing it to a
      // small stub keeps the suite from depending on a build artifact -- see
      // the file for what it does and does not provide.
      '#app': fileURLToPath(new URL('./test/nuxt-app-stub.ts', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      // `@` is the same place as `~` and a handful of components reach for the
      // stores through it; without this they fail to resolve at import time,
      // which surfaces as "the whole test file has no tests" rather than as a
      // missing module in any one of them.
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  // `vue()` lets a test import a `.vue` SFC. Without it the whole component
  // layer is untestable and, just as importantly, uncoverable -- v8 can only
  // instrument what the transform pipeline produced.
  plugins: [vue(), importMetaFlags()],
  test: {
    include: ['app/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    exclude: ['app/**/*.nuxt.test.ts', 'server/**/*.nuxt.test.ts'],
    // `node` stays the default so the ~1000 non-component tests keep starting
    // instantly. A component test opts into a DOM with a docblock on line one:
    //   // @vitest-environment happy-dom
    environment: 'node',
    // Provides the handful of Nuxt-injected globals that app modules touch as
    // they are imported, and gives every test an active Pinia. See the file.
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      // `text-summary` is what CI prints; `html` is how you find the uncovered
      // lines locally. Dropped clover and json from the defaults -- nothing reads
      // them, and they were writing two more files into an ignored directory.
      reporter: ['text-summary', 'html'],
      // Two gates, because one number cannot say both things.
      //
      // The GLOBAL figure covers the whole frontend, `.vue` components
      // included. It used to be held down by the component layer -- ~110 SFCs
      // at about 3% -- and that layer is now at 68% statements, which is what
      // moved the headline from 16% to the high sixties.
      //
      // WHAT IS AND IS NOT COVERED. Every component carrying a decision has
      // been walked: the ones whose correctness nobody can eyeball
      // (`ActivityHeatmap`'s year of date arithmetic, `BaseModal`'s focus trap
      // and Escape ordering, `FilterPanelShell`'s measured scrollbar gutter),
      // the orchestrators whose races only appear under a fast typist
      // (`UsersManager`, `ModalAnkiNotes`, `ModalSegmentEdit`), and the admin
      // and settings surfaces where a wrong emit is a wrong write. Doing that
      // found sixteen production bugs, which is the argument for the exercise;
      // the coverage number is the side effect.
      //
      // What is left at zero is ~47 presentational SFCs totalling ~275
      // statements, where the only available assertion is on markup. Those are
      // not worth a unit test and the Playwright suite already walks them.
      //
      // WITHIN the TypeScript group the picture is uneven and worth knowing
      // before reading its number as one thing: utils ~92%, stores ~86%,
      // composables ~85%, server ~76%, and app plugins ~45%. The plugins are
      // the remaining drag and what is left of them is the awkward part --
      // `rum.client` and `posthog.client` are third-party SDK wiring whose
      // behaviour is the SDK's rather than ours, so a test there asserts that
      // we passed our own config to someone else's function. The plugins that
      // make decisions of their own are done: `canonical`, `chunkReload`,
      // `engagedPageview`, `auth-callback`, and the client half of
      // `identity-auth`.
      //
      // ONE STRUCTURAL LIMIT, which explains a chunk of what is left: the
      // `importMetaFlags` plugin above compiles the app layer in its CLIENT
      // configuration, so `if (import.meta.server)` bodies are unreachable from
      // a unit test by construction. `identity-auth`'s SSR bootstrap is the
      // biggest of those. They are covered by the Playwright suite, which is
      // the only place they actually run.
      //
      // The GROUP gate on `**/*.ts` holds the line on the layer that IS tested
      // -- composables, utils, stores, server handlers. Without it a real
      // regression there could hide behind the component layer's sheer size.
      //
      // See the note on `include` in backend/vitest.config.ts for why both of
      // these are so much lower than the 74% first measured here.
      //
      // A RATCHET, not a target: these are what the suite measured, floored a
      // point below so ordinary work does not trip them. Moving them up is a
      // deliberate edit. They started at 16/16/17/16 global and 36/39/38/36 on
      // the TypeScript group.
      thresholds: {
        lines: 75, functions: 65, branches: 64, statements: 74,
        '{app,server,shared}/**/*.ts': { lines: 82, functions: 79, branches: 76, statements: 82 },
      },
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', 'server/utils/generated/**', 'config/**', 'scripts/**', 'modules/**'],
    },
  },
});
