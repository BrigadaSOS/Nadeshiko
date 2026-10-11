/** Parse segments through Shirabe into `tokens`, using the same path as new episodes. Run this before Elasticsearch
 * reindex; ordered primary-key progress makes `--after` resumable. Word IDs remain live dictionary decisions, so
 * only parse data is stored. Usage: `node --import tsx scripts/parse-corpus-with-shirabe.ts [--dry-run --limit
 * N|--after <id>|--media <publicId>]`. */

import { AppDataSource } from '@config/database';
import { Media, Segment } from '@app/models';
import { parseSegments } from '@app/services/shirabe/parseSegments';

const PAGE = 500; // rows per database round trip; parseSegments batches its own HTTP
const REPORT_EVERY_MS = 5000;

interface Options {
  dryRun: boolean;
  after: number;
  limit: number | null;
  // Scopes the run to one media. Added for the wakati-space repair
  // (strip-wakati-spaces.ts), which leaves one media's segments with no tokens
  // and needs exactly those reparsed -- a corpus-wide re-run would work but
  // costs a Shirabe pass over every segment we already have an answer for.
  media: string | null;
}

async function run({ dryRun, after, limit, media }: Options): Promise<void> {
  const repository = AppDataSource.getRepository(Segment);

  let mediaId: number | null = null;
  if (media !== null) {
    const row = await AppDataSource.getRepository(Media).findOne({
      where: { publicId: media },
      select: {
        id: true,
      },
    });
    if (!row) throw new Error(`no media with publicId ${media}`);
    mediaId = row.id;
  }
  const startedAt = Date.now();
  let cursor = after;
  let parsed = 0;
  let empty = 0;
  let reportedAt = 0;

  for (;;) {
    const take = limit === null ? PAGE : Math.min(PAGE, limit - parsed);
    if (take <= 0) break;

    // Keyset paginated on the primary key: at a million rows OFFSET makes the
    // database rewalk everything it has already handed over.
    const rows = await repository
      .createQueryBuilder('segment')
      .select(['segment.id', 'segment.uuid', 'segment.contentJa'])
      .where('segment.id > :cursor', { cursor })
      .andWhere(mediaId === null ? '1 = 1' : 'segment.mediaId = :mediaId', { mediaId })
      .orderBy('segment.id', 'ASC')
      .limit(take)
      .getMany();
    if (rows.length === 0) break;

    const tokenLists = await parseSegments(rows.map((row) => row.contentJa ?? ''));

    if (!dryRun) {
      const uuids = rows.map((row) => row.uuid);
      const payloads = tokenLists.map((tokens) => JSON.stringify(tokens));
      // One statement per page. A row per UPDATE would be a million round trips.
      await repository.query(
        `UPDATE "Segment" AS s
            SET tokens = incoming.payload::jsonb
           FROM (SELECT unnest($1::text[]) AS uuid, unnest($2::text[]) AS payload) AS incoming
          WHERE s.uuid = incoming.uuid`,
        [uuids, payloads],
      );
    }

    parsed += rows.length;
    empty += tokenLists.filter((tokens) => tokens.length === 0).length;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;

    const elapsed = Date.now() - startedAt;
    if (elapsed - reportedAt >= REPORT_EVERY_MS) {
      reportedAt = elapsed;
      const rate = Math.round((parsed / elapsed) * 1000);
      process.stderr.write(`\r${dryRun ? 'would write' : 'wrote'} ${parsed} segments, ${rate}/s, last id ${cursor}   `);
    }
  }

  console.error(
    `\n${dryRun ? 'would have written' : 'wrote'} ${parsed} segments ` +
      `(${empty} with no Japanese in them), last id ${cursor}`,
  );
  if (dryRun) console.error('dry run: nothing was written');
  else console.error('now reindex Elasticsearch, in that order');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const numericFlag = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? null : Number(args[index + 1]);
  };
  const stringFlag = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? null : (args[index + 1] ?? null);
  };

  const options: Options = {
    dryRun: args.includes('--dry-run'),
    after: numericFlag('--after') ?? 0,
    limit: numericFlag('--limit'),
    media: stringFlag('--media'),
  };

  await AppDataSource.initialize();
  try {
    await run(options);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
