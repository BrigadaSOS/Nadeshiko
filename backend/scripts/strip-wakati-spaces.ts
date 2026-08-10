/**
 * Removes the half-width spaces from a media whose subtitles arrived already
 * morpheme-segmented, and drops its now-meaningless tokens.
 *
 * WHY THIS EXISTS. One Punch Man was ingested from a subtitle source that had
 * been run through a morphological analyzer before it ever reached us --
 * wakati-gaki, one space per morpheme boundary -- and we stored it verbatim:
 *
 *     近い ぞ ! !　誰か い ない の か ! ?
 *     現在 協会側 で 災害 レベル を 判別 中 と の ・・・ー
 *
 * No subtitle writes a space around の. Roughly 65% of that media's 3,149 lines
 * carry them, evenly across all twelve episodes, while every other media in the
 * corpus sits at 0.0-0.3% -- which is the rate of real spacing, the kind a
 * writer puts in for a pause. So this is one bad ingest, not a pipeline fault,
 * and the repair is scoped to one media rather than swept over the corpus.
 *
 * WHAT IT TOUCHES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Half-width U+0020 only. Full-width U+3000 stays: it is real Japanese
 * typography, it appears in clean media throughout the corpus, and the same
 * lines being repaired here use it correctly (`! !　誰か`) alongside the noise.
 * Removing it would be a second corruption on top of the first.
 *
 * Stripping every U+0020 rather than only the ones between two Japanese
 * characters is the right call even where Latin runs are involved. Four lines
 * in this media have a space between Latin/digit characters, and Japanese
 * closes all of them anyway:
 *
 *     スクワット 100 回      ->  スクワット100回
 *     身長 2 m 15 cm         ->  身長2m15cm
 *
 * TOKENS ARE CLEARED, NOT REWRITTEN. `tokens` holds character offsets into
 * `content`, so deleting characters invalidates every offset after the first
 * one. They cannot be shifted into place either, because the spaces did not
 * merely pad the tokenization -- they *forced* it. Shirabe groups the way a
 * reader looks a word up, but it cannot group across a space, so `でしょう`
 * came back as `でしょ` + `う`. Only a reparse of the repaired text recovers
 * the grouping the rest of the corpus has.
 *
 * Clearing them in the same statement that rewrites the content is what makes
 * this safe to interrupt: a row is never left holding tokens that disagree with
 * its text. A segment with no tokens renders as plain unlinked text, which is
 * the same degraded state a not-yet-parsed segment is already in.
 *
 * Usage -- all three steps, in this order:
 *
 *   node --import tsx scripts/strip-wakati-spaces.ts --media <publicId> --dry-run
 *   node --import tsx scripts/strip-wakati-spaces.ts --media <publicId>
 *   node --import tsx scripts/parse-corpus-with-shirabe.ts --media <publicId>
 *   node --import tsx scripts/reindex-media.ts --media <publicId>
 *
 * `--media` is required and has no default. This edits subtitle text in place
 * with no revision trail, and the one thing it must never do is run corpus-wide
 * because someone forgot an argument.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDataSource } from '@config/database';
import { Media, Segment } from '@app/models';

const PAGE = 500;

interface Options {
  mediaPublicId: string;
  dryRun: boolean;
}

/**
 * The whole transformation, kept separate from the database so the interesting
 * part is testable and so `--dry-run` and the real run cannot diverge.
 */
export function stripHalfWidthSpaces(content: string): string {
  return content.replace(/ /g, '');
}

async function run({ mediaPublicId, dryRun }: Options): Promise<void> {
  const media = await AppDataSource.getRepository(Media).findOne({
    where: { publicId: mediaPublicId },
    select: ['id', 'publicId', 'nameRomaji'],
  });
  if (!media) throw new Error(`no media with publicId ${mediaPublicId}`);

  const repository = AppDataSource.getRepository(Segment);
  console.error(`${dryRun ? 'DRY RUN: ' : ''}${media.nameRomaji ?? media.publicId} (media id ${media.id})`);

  let cursor = 0;
  let scanned = 0;
  let changed = 0;
  const samples: string[] = [];

  for (;;) {
    // Keyset paginated on the primary key, same as the parse script: OFFSET
    // makes the database rewalk everything it has already handed over.
    const rows = await repository
      .createQueryBuilder('segment')
      .select(['segment.id', 'segment.uuid', 'segment.contentJa'])
      .where('segment.id > :cursor', { cursor })
      .andWhere('segment.mediaId = :mediaId', { mediaId: media.id })
      .orderBy('segment.id', 'ASC')
      .limit(PAGE)
      .getMany();
    if (rows.length === 0) break;

    const edits = rows
      .map((row) => ({ uuid: row.uuid, before: row.contentJa ?? '', after: stripHalfWidthSpaces(row.contentJa ?? '') }))
      .filter((edit) => edit.after !== edit.before);

    for (const edit of edits) {
      if (samples.length < 5) samples.push(`  ${edit.before}\n  -> ${edit.after}`);
    }

    if (!dryRun && edits.length > 0) {
      // One statement per page, and `tokens` goes to NULL in the same UPDATE as
      // the content it no longer describes -- see the header.
      await repository.query(
        `UPDATE "Segment" AS s
            SET content = incoming.content,
                tokens = NULL
           FROM (SELECT unnest($1::text[]) AS uuid, unnest($2::text[]) AS content) AS incoming
          WHERE s.uuid = incoming.uuid`,
        [edits.map((edit) => edit.uuid), edits.map((edit) => edit.after)],
      );
    }

    scanned += rows.length;
    changed += edits.length;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;
  }

  if (samples.length > 0) console.error(`\nsample:\n${samples.join('\n')}\n`);
  console.error(`scanned ${scanned} segments, ${dryRun ? 'would rewrite' : 'rewrote'} ${changed}`);
  if (dryRun) console.error('dry run: nothing was written');
  else
    console.error(`now: parse-corpus-with-shirabe.ts --media ${mediaPublicId}, then reindex-media.ts, in that order`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const index = args.indexOf('--media');
  const mediaPublicId = index === -1 ? null : args[index + 1];
  if (!mediaPublicId || mediaPublicId.startsWith('--')) {
    console.error('usage: strip-wakati-spaces.ts --media <publicId> [--dry-run]');
    process.exit(2);
  }

  await AppDataSource.initialize();
  try {
    await run({ mediaPublicId, dryRun: args.includes('--dry-run') });
  } finally {
    await AppDataSource.destroy();
  }
}

// Guarded so that importing `stripHalfWidthSpaces` -- which its test does -- does
// not open a database connection and call process.exit on the way past.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
