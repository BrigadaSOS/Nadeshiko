# @brigadasos/nadeshiko-sdk (internal copy)

The typed client the frontend and the Discord bot import. Generated from the
API's OpenAPI spec, consumed straight from `generated/internal` as a workspace
dependency — there is no build step and no version to bump.

```bash
npm run sdk:codegen          # from the repository root, after a spec change
```

`generated/` is committed and CI fails if it drifts from
`backend/docs/generated/openapi.yaml`.

## Relationship to the published package

The npm package that external users install is built and published by
[nadeshiko-sdk-ts](https://github.com/BrigadaSOS/nadeshiko-sdk-ts), which
regenerates from the same spec when a production release dispatches it. That
repository carries its own copy of the generator and of the hand-written
helpers in `src/`, so **a change intended for npm users has to be made there as
well** — this copy only reaches the site and the bot. Usage documentation for
external consumers lives in that repository and on npm.
