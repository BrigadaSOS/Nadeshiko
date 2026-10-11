/** Read-only corpus audit for morpheme-segmented subtitles; it shares the ingest guard’s metric/thresholds and
 * accepts optional `--media`/`--all`. Unlike the repair script, it never writes. Usage: `node --import tsx
 * scripts/audit-wakati.ts [--media <id>|--all]`. */

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

/** Print this many lowest-scoring media even on a clean run, so the corpus floor is visible. */
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
  // Keep running counts instead of 1.3M segment rows; the statistic needs only three counters.
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
