/**
 * Ranks the corpus by how morpheme-segmented its subtitles look.
 *
 * The ingest guard in `createSegmentsBatch` stops a wakati-gaki source at the
 * door, but it only sees batches arriving from now on. This is the same
 * measurement pointed backwards: at everything already stored, including any
 * media imported before the guard existed and any backfill that went round the
 * API. It answers "are there others?" -- which is the question that found One
 * Punch Man, a year after the fact, because a user noticed.
 *
 * Read-only. It prints a table and changes nothing, so it is safe to run against
 * production, and `--media` is optional here precisely because of that (unlike
 * strip-wakati-spaces.ts, where a forgotten argument would rewrite the corpus).
 *
 * The metric and its thresholds live in `@app/services/corpus/wakatiDetection`
 * and are shared with the guard on purpose: an audit that measured a media
 * differently than the door does would report a clean corpus while the door
 * turned batches away, and neither number would be worth anything.
 *
 * Usage:
 *   node --import tsx scripts/audit-wakati.ts
 *   node --import tsx scripts/audit-wakati.ts --media yVS7DdklQB0A
 *   node --import tsx scripts/audit-wakati.ts --all      # print every media
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDataSource } from '@config/database';
import { Media, Segment } from '@app/models';
import {
  emptyTally,
  tallyLine,
  summarize,
  MAX_MEAN_CHUNK_CHARS,
  MIN_SPACED_LINES,
  type WakatiTally,
} from '@app/services/corpus/wakatiDetection';

const PAGE = 5000;

/** Print this many of the lowest-scoring media when nothing is actually flagged,
 *  so a clean run still shows where the corpus floor sits rather than printing
 *  nothing and leaving "did it even look?" open. */
const FLOOR_ROWS = 5;

interface Options {
  media: string | null;
  all: boolean;
}

async function run({ media, all }: Options): Promise<void> {
  let mediaId: number | null = null;
  if (media !== null) {
    const row = await AppDataSource.getRepository(Media).findOne({ where: { publicId: media }, select: { id: true } });
    if (!row) throw new Error(`no media with publicId ${media}`);
    mediaId = row.id;
  }

  const repository = AppDataSource.getRepository(Segment);
  // Tallies rather than the lines themselves: the corpus is 1.3M segments, and
  // buffering them to hand `assessWakati` an array per media would hold the
  // whole thing in memory for a statistic that only needs three running counts.
  const tallies = new Map<number, WakatiTally>();

  let cursor = 0;
  let scanned = 0;

  for (;;) {
    // Keyset paginated on the primary key, same as the sibling scripts: OFFSET
    // makes the database rewalk everything it has already handed over.
    const rows = await repository
      .createQueryBuilder('segment')
      .select(['segment.id', 'segment.mediaId', 'segment.contentJa'])
      .where('segment.id > :cursor', { cursor })
      .andWhere(mediaId === null ? '1 = 1' : 'segment.mediaId = :mediaId', { mediaId })
      .orderBy('segment.id', 'ASC')
      .limit(PAGE)
      .getMany();
    if (rows.length === 0) break;

    for (const row of rows) {
      let tally = tallies.get(row.mediaId);
      if (!tally) {
        tally = emptyTally();
        tallies.set(row.mediaId, tally);
      }
      tallyLine(tally, row.contentJa ?? '');
    }

    scanned += rows.length;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;
    process.stderr.write(`\rscanned ${scanned} segments, last id ${cursor}   `);
  }
  process.stderr.write('\n');

  const names = new Map(
    (
      await AppDataSource.getRepository(Media).find({
        select: { id: true, publicId: true, nameRomaji: true },
      })
    ).map((row) => [row.id, { publicId: row.publicId, name: row.nameRomaji ?? row.publicId }]),
  );

  const assessed = [...tallies.entries()]
    .map(([id, tally]) => ({
      publicId: names.get(id)?.publicId ?? String(id),
      name: names.get(id)?.name ?? String(id),
      ...summarize(tally),
    }))
    // A media with too few spaced lines to judge sorts by a mean of 0, which
    // would put it above the real outliers. Rank those last.
    .filter((row) => row.spacedLines >= MIN_SPACED_LINES)
    .sort((a, b) => a.meanChunkChars - b.meanChunkChars);

  const flagged = assessed.filter((row) => row.isWakati);
  const shown = all ? assessed : flagged.length > 0 ? flagged : assessed.slice(0, FLOOR_ROWS);

  console.error(
    flagged.length > 0
      ? `\n${flagged.length} media below ${MAX_MEAN_CHUNK_CHARS} chars between spaces -- these look wakati-segmented:\n`
      : `\nno media below ${MAX_MEAN_CHUNK_CHARS} chars between spaces. Closest ${shown.length}:\n`,
  );
  console.error(['publicId'.padEnd(14), 'chars/chunk'.padStart(11), 'spaced'.padStart(8), '  name'].join(''));
  for (const row of shown) {
    console.error(
      [
        row.publicId.padEnd(14),
        row.meanChunkChars.toFixed(2).padStart(11),
        String(row.spacedLines).padStart(8),
        `  ${row.name}`,
      ].join(''),
    );
  }

  console.error(`\nscanned ${scanned} segments across ${assessed.length} media`);
  if (flagged.length > 0) {
    console.error(
      'repair with: strip-wakati-spaces.ts --media <publicId>, then parse-corpus-with-shirabe.ts, then reindex-media.ts',
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const index = args.indexOf('--media');
  const media = index === -1 ? null : (args[index + 1] ?? null);
  if (index !== -1 && (media === null || media.startsWith('--'))) {
    console.error('usage: audit-wakati.ts [--media <publicId>] [--all]');
    process.exit(2);
  }

  await AppDataSource.initialize();
  try {
    await run({ media, all: args.includes('--all') });
  } finally {
    await AppDataSource.destroy();
  }
}

// Guarded the same way the sibling scripts are, so importing from this file does
// not open a database connection and call process.exit on the way past.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
