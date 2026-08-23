import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the denormalized title names out of `preferences.hiddenMedia` and
 * `preferences.favoriteMedia`.
 *
 * Both lists stored `{ mediaPublicId, nameEn, nameJa, nameRomaji }` -- ~141
 * bytes an entry where the id alone costs 34 -- and the whole preferences blob
 * rides `get-session` into the `__NUXT_DATA__` of every page the reader loads.
 * Nothing read those names: the two list endpoints resolve them from `Media`,
 * and the search filter and the hidden-result notice need only ids. A reader who
 * hid 200 of the ~320 titles was carrying ~21KB of stale catalogue on every
 * render.
 *
 * Rewritten here rather than left to a tolerant reader because tolerance alone
 * shrinks nothing -- the bytes are in the column, and an account whose
 * preferences nobody writes to would carry them forever.
 *
 * SAFE TO RUN WHILE THE OLD CODE IS STILL SERVING, which is the constraint that
 * shaped the target shape. Kamal keeps old and new containers up together, so
 * for a window both are reading these rows and writing them back. The entries
 * this leaves behind are exactly what the *old* schema called a valid entry with
 * its optional names omitted, so an old container reads them, filters on them
 * and validates them unchanged; the only thing it loses is the names in its own
 * Manage Media table, which falls back to `Media #{id}`. Rewriting to bare id
 * strings would have saved another 19 bytes an entry and broken all of that.
 *
 * `favoritedAt` stays: it is server-set and recorded nowhere else, and it is
 * what orders the settings list newest-first.
 */
export class SlimMediaPreferences1787200000000 implements MigrationInterface {
  name = 'SlimMediaPreferences1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `||` on two objects replaces just the keys present, so a row with only one
    // of the two lists keeps every other preference untouched. Entries already
    // slim (a re-run, or a row an old container refattened and a newer write
    // healed again) pass through, and the `CASE` also reads a bare string as the
    // id it is, so this survives a later move to that shape.
    await queryRunner.query(`
      UPDATE "User"
      SET preferences = preferences
        || CASE WHEN jsonb_typeof(preferences->'hiddenMedia') = 'array' THEN jsonb_build_object('hiddenMedia', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaPublicId', s.id) ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(preferences->'hiddenMedia') WITH ORDINALITY AS e(item, ord),
                  LATERAL (SELECT CASE WHEN jsonb_typeof(item) = 'string' THEN item #>> '{}' ELSE item->>'mediaPublicId' END) AS s(id)
             WHERE s.id IS NOT NULL
           )) ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(preferences->'favoriteMedia') = 'array' THEN jsonb_build_object('favoriteMedia', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'mediaPublicId', item->>'mediaPublicId',
                      -- Every stored favourite has one; the fallback is for a row
                      -- hand-written past the schema, and sorts it last.
                      'favoritedAt', COALESCE(item->>'favoritedAt', '1970-01-01T00:00:00.000Z')
                    ) ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(preferences->'favoriteMedia') WITH ORDINALITY AS e(item, ord)
             WHERE item->>'mediaPublicId' IS NOT NULL
           )) ELSE '{}'::jsonb END
      WHERE preferences ?| array['hiddenMedia', 'favoriteMedia']
    `);
  }

  /**
   * Reversible because the names were only ever a copy: they are read back off
   * `Media`, which is where a rename lands anyway. A title deleted from the
   * catalogue since keeps its id and comes back nameless, which is what the old
   * shape's optional name fields always allowed.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "User"
      SET preferences = preferences
        || CASE WHEN jsonb_typeof(preferences->'hiddenMedia') = 'array' THEN jsonb_build_object('hiddenMedia', (
             SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                      'mediaPublicId', s.id,
                      'nameEn', m.english_name,
                      'nameJa', m.japanese_name,
                      'nameRomaji', m.romaji_name
                    )) ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(preferences->'hiddenMedia') WITH ORDINALITY AS e(item, ord),
                  LATERAL (SELECT CASE WHEN jsonb_typeof(item) = 'string' THEN item #>> '{}' ELSE item->>'mediaPublicId' END) AS s(id)
             LEFT JOIN "Media" m ON m.public_id = s.id
             WHERE s.id IS NOT NULL
           )) ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(preferences->'favoriteMedia') = 'array' THEN jsonb_build_object('favoriteMedia', (
             SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                      'mediaPublicId', item->>'mediaPublicId',
                      'nameEn', m.english_name,
                      'nameJa', m.japanese_name,
                      'nameRomaji', m.romaji_name,
                      'favoritedAt', item->>'favoritedAt'
                    )) ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(preferences->'favoriteMedia') WITH ORDINALITY AS e(item, ord)
             LEFT JOIN "Media" m ON m.public_id = e.item->>'mediaPublicId'
             WHERE item->>'mediaPublicId' IS NOT NULL
           )) ELSE '{}'::jsonb END
      WHERE preferences ?| array['hiddenMedia', 'favoriteMedia']
    `);
  }
}
