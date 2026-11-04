import { describe, expect, it } from 'vitest';
import { staleSeedHint } from '../../bin/lib/staleSeedHint';

describe('staleSeedHint', () => {
  it('explains a dump taken before a column was dropped', () => {
    // The failure that broke `npm run setup` in 2026-11, verbatim from pg_restore.
    const detail =
      'pg_restore: error: could not execute query: ERROR:  column "pos_analysis" of relation "Segment" does not exist';
    expect(staleSeedHint(detail)).toContain('refresh-seed-dump.sh');
  });

  it('explains a dump that names a table the schema no longer has', () => {
    expect(staleSeedHint('ERROR:  relation "public.Character" does not exist')).toContain('dumped before a migration');
  });

  it('stays quiet for failures that are not schema drift', () => {
    expect(staleSeedHint('pg_restore: error: connection to server failed')).toBe('');
  });
});
