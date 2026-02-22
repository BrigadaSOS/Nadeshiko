import { client, INDEX_NAME } from '@config/elasticsearch';
import { Media, Episode, Segment, CategoryType, SegmentStatus, SegmentStorage, ContentRating } from '@app/models';
import { SegmentIndexer } from '@app/models/segmentDocument/SegmentIndexer';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';

export async function isEsAvailable(): Promise<boolean> {
  try {
    await client.indices.exists({ index: INDEX_NAME });
    return true;
  } catch {
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
      storage: SegmentStorage.R2,
      hashedId: `hash-${media.id}-${i}`,
      episode: episodeNumber,
      mediaId: media.id,
      storageBasePath: '/test',
      ...segments[i],
    });
    await seg.save();
    await SegmentIndexer.index(seg);
    savedSegments.push(seg);
  }

  await client.indices.refresh({ index: INDEX_NAME });
  Cache.invalidate(MEDIA_INFO_CACHE);

  return { media, episode, segments: savedSegments };
}
