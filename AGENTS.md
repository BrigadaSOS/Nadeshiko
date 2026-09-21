# Nadeshiko agent instructions

This checkout is shared with other agents. Use `jj` for version control when
`.jj/` exists; do not mutate the checkout with `git` or restructure its revset.

## Working on the Shirabe integration

- When changing Shirabe SDK source, confirm Nadeshiko resolves the local API
  package in both backend and frontend, and the local card package in frontend.
  Establish missing local links before testing; do not validate SDK source
  changes against published packages by accident.
- Run `npm run watch:shirabe` from the Nadeshiko root in a background session
  when editing or testing linked Shirabe SDK packages. Check for an existing
  watcher first and leave one running while integration work continues.
- The command finds the packages actually installed for Nadeshiko's backend and
  frontend. It watches locally linked Shirabe API and card packages and skips
  registry packages. Do not assume a sibling `../Shirabe` checkout.
- Start Nadeshiko's dev servers when needed. Completed API builds restart the
  backend and frontend; card builds restart the frontend. Verify the page or API after
  an SDK change; a successful TypeScript build alone does not prove the running
  app picked it up.
- If the Shirabe OpenAPI contract changes, run the API package's `codegen`
  script before verification; the source watcher compiles generated files but
  does not generate them.
- Do not ask the user to rebuild the SDK or restart the dev servers manually
  when the agent can run the watcher and check the result.
