/** Reindex one media in the current live index after a text repair; it avoids a whole-corpus alias swap but
 * intentionally exposes a temporary mix of old/new documents. Use full `bin/es.ts reindex` for mapping changes.
 * Usage: `node --import tsx scripts/reindex-media.ts --media <publicId>`. */

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
