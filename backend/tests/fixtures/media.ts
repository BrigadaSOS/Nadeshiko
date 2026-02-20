import { Media, CategoryType } from '@app/models/Media';
import { Episode } from '@app/models/Episode';

export async function seedMedia(overrides: Record<string, unknown> = {}) {
  const media = Media.create({
    nameJa: 'テストアニメ',
    nameRomaji: 'Test Anime',
    nameEn: 'Test Anime',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    startDate: '2024-01-01',
    studio: 'Test Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
    category: CategoryType.ANIME,
    segmentCount: 0,
    version: '1.0',
    storageBasePath: '/test',
    ...overrides,
  });
  await media.save();
  return media;
}

export async function seedEpisode(mediaId: number, overrides: Record<string, unknown> = {}) {
  const episode = Episode.create({
    mediaId,
    episodeNumber: 1,
    titleEn: 'Pilot',
    segmentCount: 0,
    ...overrides,
  });
  await episode.save();
  return episode;
}
