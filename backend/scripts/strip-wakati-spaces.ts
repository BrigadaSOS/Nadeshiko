/** Repair one media's U+0020 spaces, preserving U+3000; clear tokens atomically because offsets become invalid.
 * Require `--media` and preview with `--dry-run`: edits have no revision history. Then run
 * `parse-corpus-with-shirabe.ts --media <id>` and `reindex-media.ts --media <id>`, in that order. */

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
    select: {
      id: true,
      publicId: true,
      nameRomaji: true,
    },
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
