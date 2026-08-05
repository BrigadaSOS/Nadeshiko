/**
 * Replaces every segment's pos_analysis with the tokens Shirabe parsed.
 *
 * Shirabe is the parser now. It reads the corpus once, groups the way a reader
 * looks words up (食べました is one word, not three), and hands back the shape we
 * serve, so this script writes it in and drops what was there: the `sudachi`
 * array, the `unidic` array, and the `_tokenizer_*` markers that existed to tell
 * them apart. One analysis, in the field names the API already publishes.
 *
 * Producing the input, on the Shirabe side:
 *
 *   bin/rails nadeshiko:parse IN=segments.jsonl OUT=tokens.jsonl
 *
 * where segments.jsonl is one {"uuid": ..., "text": ...} per segment. Export it
 * with `--dump` below, which writes exactly that.
 *
 * Usage:
 *   bun run scripts/import-shirabe-tokens.ts --dump segments.jsonl
 *   bun run scripts/import-shirabe-tokens.ts tokens.jsonl
 *   bun run scripts/import-shirabe-tokens.ts tokens.jsonl --dry-run
 *
 * SNAPSHOT pos_analysis FIRST. This overwrites a live column, and the SudachiPy
 * pipeline that filled it lives outside this repo, so putting it back would mean
 * rebuilding a thing nobody has in front of them:
 *
 *   pg_dump -t segment --data-only > segment-before-shirabe.sql
 *
 * Then import, THEN reindex Elasticsearch. In that order every row already has
 * its tokens by the time anything reads them (SegmentIndexer.extractSlimTokens
 * reads `tokens` and nothing else). Reindex first and every reader sees plain
 * unlinked text until the import catches up.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { AppDataSource } from '@config/database';
import { Segment } from '@app/models/Segment';

const BATCH_SIZE = 500;
const REPORT_EVERY_MS = 5000;

interface TokenLine {
  id: string;
  tokens: unknown[];
}

/** Write the file Shirabe expects: one segment per line, id plus its Japanese. */
async function dump(path: string): Promise<void> {
  const out = createWriteStream(path);
  const repository = AppDataSource.getRepository(Segment);
  let after = 0;
  let written = 0;
  const startedAt = Date.now();

  // Keyset paginated on the primary key rather than OFFSET: at a million rows
  // OFFSET makes the database walk everything it already handed over.
  for (;;) {
    const rows = await repository
      .createQueryBuilder('segment')
      .select(['segment.id', 'segment.uuid', 'segment.contentJa'])
      .where('segment.id > :after', { after })
      .orderBy('segment.id', 'ASC')
      .limit(BATCH_SIZE)
      .getMany();
    if (rows.length === 0) break;

    for (const row of rows) {
      out.write(`${JSON.stringify({ id: row.uuid, text: row.contentJa })}\n`);
    }
    const last = rows[rows.length - 1];
    if (!last) break;
    after = last.id;
    written += rows.length;
    report('dumped', written, startedAt);
  }

  await new Promise((resolve) => out.end(resolve));
  console.error(`\ndumped ${written} segments to ${path}`);
}

/** Read Shirabe's output and replace pos_analysis with it. */
async function importTokens(path: string, dryRun: boolean): Promise<void> {
  const repository = AppDataSource.getRepository(Segment);
  const stream = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

  let batch: TokenLine[] = [];
  let applied = 0;
  let missing = 0;
  let empty = 0;
  let lineNumber = 0;
  const startedAt = Date.now();

  const flush = async () => {
    if (batch.length === 0) return;
    if (dryRun) {
      applied += batch.length;
    } else {
      // Rows we asked to update minus rows that existed: a uuid in the file with
      // no segment behind it means the dump and the import disagree about what
      // the corpus contains, which is worth saying out loud rather than counting
      // as success.
      const updated = await writeBatch(repository, batch);
      applied += updated;
      missing += batch.length - updated;
    }
    batch = [];
    report(dryRun ? 'would apply' : 'applied', applied, startedAt);
  };

  for await (const line of stream) {
    lineNumber += 1;
    if (line.trim() === '') continue;

    let record: TokenLine;
    try {
      record = JSON.parse(line) as TokenLine;
    } catch {
      throw new Error(`line ${lineNumber}: not JSON`);
    }
    if (!record.id) throw new Error(`line ${lineNumber}: no "id"`);
    if (!Array.isArray(record.tokens)) throw new Error(`line ${lineNumber}: no "tokens" array`);

    // A line with no tokens is a real answer, not a failure: a music cue or a
    // caption with no Japanese in it parses to nothing. Store the empty array so
    // the row says "parsed, nothing there" rather than "never parsed".
    if (record.tokens.length === 0) empty += 1;

    batch.push(record);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.error(
    `\n${dryRun ? 'would apply' : 'applied'} ${applied} segments ` + `(${empty} with no tokens, ${missing} not found)`,
  );
  if (dryRun) console.error('dry run: nothing was written');
}

/** One statement per batch. A row per UPDATE would be a million round trips. */
async function writeBatch(
  repository: ReturnType<typeof AppDataSource.getRepository<Segment>>,
  batch: TokenLine[],
): Promise<number> {
  const uuids = batch.map((record) => record.id);
  const payloads = batch.map((record) => JSON.stringify({ tokens: record.tokens }));

  const result = await repository.query(
    `UPDATE segment AS s
        SET pos_analysis = incoming.payload::jsonb
       FROM (SELECT unnest($1::text[]) AS uuid, unnest($2::text[]) AS payload) AS incoming
      WHERE s.uuid = incoming.uuid`,
    [uuids, payloads],
  );

  // node-postgres reports the row count in the second element for UPDATE.
  return Array.isArray(result) && typeof result[1] === 'number' ? result[1] : batch.length;
}

function report(verb: string, count: number, startedAt: number): void {
  const elapsed = Date.now() - startedAt;
  if (elapsed % REPORT_EVERY_MS < 50 || count % (BATCH_SIZE * 20) === 0) {
    const rate = Math.round((count / elapsed) * 1000);
    process.stderr.write(`\r${verb} ${count} segments, ${rate}/s   `);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dumpIndex = args.indexOf('--dump');
  const dryRun = args.includes('--dry-run');

  await AppDataSource.initialize();
  try {
    if (dumpIndex !== -1) {
      const path = args[dumpIndex + 1];
      if (!path) throw new Error('--dump needs a path to write to');
      await dump(path);
      return;
    }

    const path = args.find((arg) => !arg.startsWith('--'));
    if (!path) throw new Error('give me the tokens.jsonl Shirabe produced, or --dump <path> first');
    await importTokens(path, dryRun);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
