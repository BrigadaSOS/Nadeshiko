import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vitest/config';

// Replace Nuxt build-time import.meta flags in both node and happy-dom tests. Vite define does not reliably
// reach happy-dom, silently leaving components in server mode. This plugin compiles the app layer as client;
// SSR-only branches require real Nuxt/Playwright verification.
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
  // Vite matches aliases in order; keep the project-root ~~ before the srcDir ~ alias.
  resolve: {
    alias: {
      // Stub #app so unit tests do not depend on generated .nuxt artifacts.
      '#app': fileURLToPath(new URL('./test/nuxt-app-stub.ts', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  plugins: [vue(), importMetaFlags()],
  test: {
    include: ['app/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    exclude: ['app/**/*.nuxt.test.ts', 'server/**/*.nuxt.test.ts'],
    // Keep non-component tests in node; component tests opt in with @vitest-environment happy-dom.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      // Measure all source, not only imported files. The global gate includes Vue; the TypeScript gate prevents
      // regressions in logic from hiding behind component volume. These thresholds are a ratchet, not a target.
      // SSR-only branches are unreachable under importMetaFlags and need Playwright coverage.
      thresholds: {
        lines: 75,
        functions: 65,
        branches: 64,
        statements: 74,
        '{app,server,shared}/**/*.ts': { lines: 82, functions: 79, branches: 76, statements: 82 },
      },
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', 'server/utils/generated/**', 'config/**', 'scripts/**', 'modules/**'],
    },
  },
});
