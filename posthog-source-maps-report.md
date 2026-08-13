# PostHog Source Map Upload — Setup Report

## What was configured

Source map upload is wired into the `@posthog/nuxt` module (already installed at `^1.7.81`). The module injects chunk IDs and uploads maps during every production build.

## Files changed

| File | Change |
|------|--------|
| `frontend/nuxt.config.ts` | Added `posthogConfig.sourcemaps` block; changed `sourcemap.client` from `true` to `'hidden'`; added `nitro.rollupConfig.output.sourcemapExcludeSources: false` |
| `frontend/Dockerfile` | Added `ARG POSTHOG_CLI_API_KEY` + `ENV POSTHOG_CLI_API_KEY=...` in the `build` stage, before `RUN npm run build` |
| `.github/workflows/release.yml` | Added `POSTHOG_CLI_API_KEY=${{ secrets.POSTHOG_CLI_API_KEY }}` to the `build-args` of the "Build and push frontend image" step |
| `frontend/.env` | Added `POSTHOG_CLI_API_KEY`, `POSTHOG_CLI_PROJECT_ID`, `POSTHOG_CLI_HOST` |

## Credentials written to `frontend/.env`

```
POSTHOG_CLI_API_KEY=<your personal API key>
POSTHOG_CLI_PROJECT_ID=372788
POSTHOG_CLI_HOST=https://us.posthog.com
```

**Never commit `.env`.** It is gitignored.

## Build and upload commands

| | Command |
|-|---------|
| **Build (uploads maps)** | `npm run build` (from `frontend/`) |
| **Run production build** | `npm run preview` (from `frontend/`) |

Source maps are injected and uploaded automatically during `npm run build` when `POSTHOG_CLI_API_KEY` is set. If the key is absent the build succeeds silently with no upload.

## CI secret you must create before the next release

The production deploy (`release.yml`) now reads `POSTHOG_CLI_API_KEY` from a GitHub Actions secret. You need to create it before the next tag push, or maps won't upload from CI.

**GitHub Actions → Settings → Secrets and variables → Actions → New repository secret:**

| Secret name | Value |
|-------------|-------|
| `POSTHOG_CLI_API_KEY` | Your personal PostHog API key (same value as in `frontend/.env`) |

Staging deploys (`staging-release.yml`) are unaffected — the PostHog module is disabled when `NUXT_PUBLIC_ENVIRONMENT != 'production'`, so staging builds never upload source maps.

## Important: proxy and CLI host

The `@posthog/nuxt` module uses `posthogConfig.host` (`https://t.nadeshiko.co`) as the PostHog CLI host for source map uploads. The PostHog CLI source map upload API calls (`/api/projects/...`) will be routed through this proxy.

If source maps do not appear in PostHog after a production build, verify that `https://t.nadeshiko.co` forwards `/api/...` paths to PostHog's API (`https://us.posthog.com`). If the proxy only handles event ingestion paths, the upload will fail silently.

## How to verify the upload

After the next production build (locally with `npm run build`, or via a release tag push):

1. Open [Symbol sets in PostHog](https://us.posthog.com/project/372788/error_tracking/configuration)
2. A new symbol set should appear within a minute of the build completing
3. New errors captured from that build will show source-resolved stack traces (real file names and line numbers, not minified bundle paths)
