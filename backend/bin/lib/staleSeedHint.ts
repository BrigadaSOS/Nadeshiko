/** The seed is restored data-only into the current schema, so a dump taken before a migration that renamed or
 * dropped a column fails with "column … does not exist". That is a stale seed, not a broken setup: say so, and say
 * who can fix it. Returns '' for any other failure. */
export function staleSeedHint(detail: string): string {
  if (!/column "[^"]+" of relation "[^"]+" does not exist|relation "[^"]+" does not exist/.test(detail)) return '';
  return (
    '\n\nThe seed was dumped before a migration that changed this table, so it no longer fits the schema.' +
    '\nAsk a project admin to refresh it (nadeshiko-infra/seed-worker/scripts/refresh-seed-dump.sh).' +
    '\nThe rest of setup worked: the database is migrated and seeded, just without the sample content.'
  );
}
