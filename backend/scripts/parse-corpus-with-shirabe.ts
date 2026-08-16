/**
 * Reparses the corpus with Shirabe and writes each segment's `tokens`.
 *
 * Shirabe is the parser now. It groups the way a reader looks words up (食べました
 * is one word, not three), says where each word reads about, aligns the ruby, and
 * names what an inflected form is doing. This walks the corpus through
 * `parseSegments` and writes the answer into `tokens`. It ran beside the old
 * SudachiPy `pos_analysis` while the result was checked over; that column has
 * since been dropped, so `tokens` is the only tokenization the corpus has and a
 * re-run of this script is how a segment gets one.
 *
 * There is no separate file hand-off and no second parser. New episodes take the
 * same path through `parseSegments`, so the corpus cannot end up half parsed one
 * way and half the other.
 *
 * Usage:
 *   node --import tsx scripts/parse-corpus-with-shirabe.ts --dry-run --limit 200
 *   node --import tsx scripts/parse-corpus-with-shirabe.ts
 *   node --import tsx scripts/parse-corpus-with-shirabe.ts --after 483000     # resume
 *   node --import tsx scripts/parse-corpus-with-shirabe.ts --media <publicId>  # one media
 *
 * Run this, THEN reindex Elasticsearch. In that order every row already has
 * its tokens by the time anything reads them (SegmentIndexer.extractSlimTokens
 * reads `tokens` and nothing else). Reindex first and every reader sees plain
 * unlinked text until this catches up.
 *
 * Resumable by primary key: it prints the last id it wrote on every progress
 * line, and `--after <id>` picks up from one. No state file to go stale.
 *
 * WORD IDS ARE NOT WRITTEN HERE, AND THAT IS THE DESIGN. An id is Shirabe's
 * DECISION about which word a token is, derived from dictionary content, so it
 * moves whenever a headword, a commonness flag or a resolution rule moves. A
 * corpus holding a million of them holds a million rows that go stale together
 * and has to be re-exported every time the resolver improves. What does not go
 * stale is the parse.
 *
 * So a reader tapping a word resolves it live, from the token this script wrote:
 * `POST /api/v1/words/identify` takes `lemma`, `surface`, `reading` and `pos`
 * and answers a ranked list of candidates WITH their definitions. That reaches
 * what no stored slug can -- 食べました resolves to 食べる, which no slug spells,
 * and 開いた answers ひらく or あく by how the sentence read it -- and it is
 * always current.
 *
 * `pos` there is Shirabe's SHORT tag (`verb`, `prt`), which is why `pt` is
 * stored alongside the UniDic `p`: see `toSlimToken`. Rows parsed before `pt`
 * existed have only `p`, and the frontend derives from it (`shortPos` in
 * ~/utils/tokenEnrichment) until a re-run of this script fills them in.
 *
 * (Superseded, in case you remember them: `include=wordIds`, `include=meanings`,
 * `POST /api/v1/words/resolve`, `resolvedWith`, and the `?surface=` mode of
 * `GET /api/v1/words/{id}` were all deleted in Shirabe 0.8.0. `GET
 * /api/v1/words/{id}` itself is untouched and still opens a word by slug.)
 */

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
