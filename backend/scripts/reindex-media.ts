/**
 * Reindexes one media into the live Elasticsearch index.
 *
 * `bin/es.ts reindex` rebuilds the whole corpus into a fresh versioned index and
 * swaps the alias. That is the right tool when the mapping changed or the index
 * is being rebuilt from scratch, and the wrong one when a single media's rows
 * moved underneath it -- it re-reads every segment we already have a correct
 * document for, to fix a few thousand.
 *
 * This is the narrow version, and it exists because the wakati-space repair
 * (strip-wakati-spaces.ts) needs exactly this as its third step. It writes into
 * the index the alias currently points at, so there is no swap and no window
 * where searches are served from a half-built index -- documents are replaced by
 * id as they are rebuilt.
 *
 * The trade against the zero-downtime path, stated plainly: between the first
 * document written and the last, that media's results are a mix of old and new.
 * For a text repair that is invisible in practice. For anything touching the
 * mapping it is not good enough, and `bin/es.ts reindex` is the tool.
 *
 * Usage:
 *   node --import tsx scripts/reindex-media.ts --media <publicId>
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDataSource } from '@config/database';
import { Media } from '@app/models';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';

async function run(mediaPublicId: string): Promise<void> {
  const media = await AppDataSource.getRepository(Media).findOne({
    where: { publicId: mediaPublicId },
    select: {
      id: true,
      publicId: true,
      nameRomaji: true,
    },
  });
  if (!media) throw new Error(`no media with publicId ${mediaPublicId}`);

  console.error(`reindexing ${media.nameRomaji ?? media.publicId} (media id ${media.id})`);
  const result = await SegmentIndexer.reindex([{ mediaId: media.id }]);
  console.error(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const index = args.indexOf('--media');
  const mediaPublicId = index === -1 ? null : args[index + 1];
  if (!mediaPublicId || mediaPublicId.startsWith('--')) {
    console.error('usage: reindex-media.ts --media <publicId>');
    process.exit(2);
  }

  await AppDataSource.initialize();
  try {
    await run(mediaPublicId);
  } finally {
    await AppDataSource.destroy();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
