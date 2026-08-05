import { client, INDEX_NAME } from '@config/elasticsearch';
import { config } from '@config/config';
import { Media, Episode, Segment, CategoryType, SegmentStatus, SegmentStorage, ContentRating } from '@app/models';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';

let mediaSeq = 0;
let warnedEsUnavailable = false;

function describeEsError(error: unknown): string {
  const statusCode = (error as { meta?: { statusCode?: number } })?.meta?.statusCode;
  const message = error instanceof Error ? error.message : String(error);
  return statusCode ? `HTTP ${statusCode} - ${message}` : message;
}

export async function isEsAvailable(): Promise<boolean> {
  try {
    await client.indices.exists({ index: INDEX_NAME });
    return true;
  } catch (error) {
    // Silently returning false here used to skip the whole integration suite
    // with no trace of why -- a 401 from an unprovisioned test user looked
    // exactly like a green run. console.warn survives LOG_LEVEL=silent.
    if (!warnedEsUnavailable) {
      warnedEsUnavailable = true;
      console.warn(`[esFixtures] Elasticsearch unavailable: ${describeEsError(error)}`);
      console.warn(
        `[esFixtures] Target: ${config.ELASTICSEARCH_HOST} index '${INDEX_NAME}' as user '${config.ELASTICSEARCH_USER}'`,
      );
      console.warn('[esFixtures] Elasticsearch-backed tests will be SKIPPED.');
      console.warn("[esFixtures] A 401/403 means the test user is not provisioned yet -- run 'npm run setup'.");
    }
    return false;
  }
}

export async function seedSegmentsIntoEs(
  mediaOverrides: Partial<Media>,
  segments: Array<Partial<Segment>>,
): Promise<{ media: Media; episode: Episode; segments: Segment[] }> {
  const media = Media.create({
    nameJa: 'テストアニメ',
    nameRomaji: 'Test Anime',
    nameEn: 'Test Anime EN',
    slug: `test-anime-${++mediaSeq}`,
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    storage: SegmentStorage.R2,
    startDate: '2024-01-01',
    studio: 'Studio A',
    seasonName: 'WINTER',
    seasonYear: 2024,
    category: CategoryType.ANIME,
    segmentCount: segments.length,
    version: '1',
    storageBasePath: '/test',
    hashSalt: 'salt',
    ...mediaOverrides,
  });
  await media.save();

  const episodeNumber = segments[0]?.episode ?? 1;
  const episode = Episode.create({
    mediaId: media.id,
    episodeNumber,
    segmentCount: segments.length,
  });
  await episode.save();

  const savedSegments: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = Segment.create({
      uuid: `test-uuid-${media.id}-${i}`,
      position: i + 1,
      status: SegmentStatus.ACTIVE,
      startTimeMs: i * 5000,
      endTimeMs: (i + 1) * 5000,
      contentJa: 'テスト',
      contentEn: 'test',
      contentEnMt: false,
      contentEs: 'prueba',
      contentEsMt: true,
      contentRating: ContentRating.SAFE,
      ratingAnalysis: { scores: {}, tags: {} },
      storage: SegmentStorage.R2,
      hashedId: `hash-${media.id}-${i}`,
      episode: episodeNumber,
      mediaId: media.id,
      storageBasePath: '/test',
      ...segments[i],
    });
    await seg.save();
    await SegmentIndexer.index(seg as Segment);
    savedSegments.push(seg as Segment);
  }

  await client.indices.refresh({ index: INDEX_NAME });
  Cache.invalidate(MEDIA_INFO_CACHE);

  return { media, episode, segments: savedSegments };
}
