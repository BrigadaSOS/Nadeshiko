import { CategoryType } from '@app/models/Media';
import { ActivityType } from '@app/models/UserActivity';
import { UserRoleType } from '@app/models/User';
import type { User } from '@app/models/User';
import type { Media } from '@app/models/Media';
import type { Episode } from '@app/models/Episode';
import type { UserActivity } from '@app/models/UserActivity';

export interface FixtureRef {
  __fixtureRef: string;
}

export function ref(path: string): FixtureRef {
  return { __fixtureRef: path };
}

export function isFixtureRef(value: unknown): value is FixtureRef {
  return typeof value === 'object' && value !== null && '__fixtureRef' in value;
}

export type SeedInput<TEntity> = {
  [K in keyof TEntity as TEntity[K] extends (...args: unknown[]) => unknown ? never : K]?: TEntity[K];
};

type FixtureSeed<TEntity> = {
  [K in keyof SeedInput<TEntity>]?: SeedInput<TEntity>[K] | FixtureRef;
};

type FixtureEntityPayloads = {
  users: FixtureSeed<User>;
  media: FixtureSeed<Media>;
  episodes: FixtureSeed<Episode>;
  activities: FixtureSeed<UserActivity>;
};

export type FixtureEntityKey = keyof FixtureEntityPayloads;

export type FixtureCatalog = Partial<{
  [K in FixtureEntityKey]: Record<string, FixtureEntityPayloads[K]>;
}>;

const mediaDefaults: FixtureSeed<Media> = {
  nameJa: 'テストアニメ',
  nameRomaji: 'Test Anime',
  nameEn: 'Test Anime',
  slug: 'test-anime',
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
};

export const FIXTURE_SETS = {
  core: {
    users: {
      kevin: {
        username: 'kevin',
        email: 'kevin@nadeshiko.test',
        isVerified: true,
        isActive: true,
        role: UserRoleType.ADMIN,
        preferences: {},
      },
      david: {
        username: 'david',
        email: 'david@nadeshiko.test',
        isVerified: true,
        isActive: true,
        role: UserRoleType.ADMIN,
        preferences: {},
      },
      regular: {
        username: 'regular',
        email: 'regular@nadeshiko.test',
        isVerified: true,
        isActive: true,
        role: UserRoleType.USER,
        preferences: {},
      },
    },
  },
  twoMedias: {
    media: {
      spyXFamily: {
        ...mediaDefaults,
        nameJa: 'スパイファミリー',
        nameRomaji: 'Spy x Family',
        nameEn: 'Spy x Family',
        slug: 'spy-x-family',
      },
      anotherShow: {
        ...mediaDefaults,
        nameJa: '別作品',
        nameRomaji: 'Another Show',
        nameEn: 'Another Show',
        slug: 'another-show',
      },
    },
  },
  mediaWithTwoEpisodes: {
    media: {
      episodicShow: {
        ...mediaDefaults,
        nameJa: 'エピソード作品',
        nameRomaji: 'Episodic Show',
        nameEn: 'Episodic Show',
        slug: 'episodic-show',
      },
    },
    episodes: {
      first: { mediaId: ref('media.episodicShow.id'), episodeNumber: 1, titleEn: 'First', segmentCount: 0 },
      second: { mediaId: ref('media.episodicShow.id'), episodeNumber: 2, titleEn: 'Second', segmentCount: 0 },
    },
  },
  mediaWithThreeEpisodes: {
    media: {
      episodicShow: {
        ...mediaDefaults,
        nameJa: 'エピソード作品',
        nameRomaji: 'Episodic Show',
        nameEn: 'Episodic Show',
        slug: 'episodic-show',
      },
    },
    episodes: {
      first: { mediaId: ref('media.episodicShow.id'), episodeNumber: 1, segmentCount: 0 },
      second: { mediaId: ref('media.episodicShow.id'), episodeNumber: 2, segmentCount: 0 },
      third: { mediaId: ref('media.episodicShow.id'), episodeNumber: 3, segmentCount: 0 },
    },
  },
  singleMedia: {
    media: { testShow: { ...mediaDefaults, slug: 'single-media-test-show' } },
  },
  mediaWithEpisode: {
    media: { testShow: { ...mediaDefaults, slug: 'media-with-episode-test-show' } },
    episodes: {
      pilot: { mediaId: ref('media.testShow.id'), episodeNumber: 1, titleEn: 'Pilot', segmentCount: 0 },
    },
  },
  mediaWithThirdEpisode: {
    media: { testShow: { ...mediaDefaults, slug: 'media-with-third-episode-test-show' } },
    episodes: {
      thirdOne: { mediaId: ref('media.testShow.id'), episodeNumber: 3, titleEn: 'Third One', segmentCount: 0 },
    },
  },
  kevinActivities: {
    activities: {
      kevinSearch: { userId: ref('users.kevin.id'), activityType: ActivityType.SEARCH, searchQuery: '猫' },
      kevinExport: { userId: ref('users.kevin.id'), activityType: ActivityType.ANKI_EXPORT, segmentId: 'ExportSeg001' },
      kevinPlay1: {
        userId: ref('users.kevin.id'),
        activityType: ActivityType.SEGMENT_PLAY,
        mediaPublicId: 'TestMedia001',
      },
      kevinPlay2: {
        userId: ref('users.kevin.id'),
        activityType: ActivityType.SEGMENT_PLAY,
        mediaPublicId: 'TestMedia002',
      },
    },
  },
  davidActivity: {
    activities: {
      davidSearch: { userId: ref('users.david.id'), activityType: ActivityType.SEARCH, searchQuery: 'other-user' },
    },
  },
} satisfies Record<string, FixtureCatalog>;

export type FixtureSetName = keyof typeof FIXTURE_SETS;
