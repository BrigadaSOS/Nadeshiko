import { CategoryType } from '@app/models/Media';
import { CharacterRole } from '@app/models/MediaCharacter';
import { ActivityType } from '@app/models/UserActivity';
import { UserRoleType } from '@app/models/User';
import type { User } from '@app/models/User';
import type { Media } from '@app/models/Media';
import type { Episode } from '@app/models/Episode';
import type { Series } from '@app/models/Series';
import type { SeriesMedia } from '@app/models/SeriesMedia';
import type { Seiyuu } from '@app/models/Seiyuu';
import type { Character } from '@app/models/Character';
import type { MediaCharacter } from '@app/models/MediaCharacter';
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
  series: FixtureSeed<Series>;
  seriesMedia: FixtureSeed<SeriesMedia>;
  seiyuu: FixtureSeed<Seiyuu>;
  characters: FixtureSeed<Character>;
  mediaCharacters: FixtureSeed<MediaCharacter>;
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
      jz: {
        username: 'jz',
        email: 'jz@nadeshiko.test',
        isVerified: true,
        isActive: true,
        role: UserRoleType.ADMIN,
        preferences: {},
      },
      mike: {
        username: 'mike',
        email: 'mike@nadeshiko.test',
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
  seiyuuWithRoles: {
    media: {
      spyXFamily: {
        ...mediaDefaults,
        nameJa: 'スパイファミリー',
        nameRomaji: 'Spy x Family',
        nameEn: 'Spy x Family',
      },
      anotherShow: {
        ...mediaDefaults,
        nameJa: '別作品',
        nameRomaji: 'Another Show',
        nameEn: 'Another Show',
      },
    },
    seiyuu: {
      saori: {
        nameJapanese: '早見沙織',
        nameEnglish: 'Saori Hayami',
        externalIds: { anilist: '95991' },
        imageUrl: 'https://example.com/saori.jpg',
      },
    },
    characters: {
      yor: {
        nameJapanese: 'ヨル',
        nameEnglish: 'Yor',
        externalIds: { anilist: '14545' },
        imageUrl: 'https://example.com/yor.jpg',
        seiyuu: ref('seiyuu.saori'),
      },
    },
    mediaCharacters: {
      yorMainSpy: {
        mediaId: ref('media.spyXFamily.id'),
        characterId: ref('characters.yor.id'),
        role: CharacterRole.MAIN,
      },
      yorSupportingAnother: {
        mediaId: ref('media.anotherShow.id'),
        characterId: ref('characters.yor.id'),
        role: CharacterRole.SUPPORTING,
      },
    },
  },
  seriesWithOrderedMedia: {
    media: {
      mediaA: { ...mediaDefaults, nameJa: 'Media A', nameRomaji: 'Media A', nameEn: 'Media A' },
      mediaB: { ...mediaDefaults, nameJa: 'Media B', nameRomaji: 'Media B', nameEn: 'Media B' },
    },
    series: {
      testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' },
    },
    seriesMedia: {
      mediaAAtTwo: { seriesId: ref('series.testSeries.id'), mediaId: ref('media.mediaA.id'), position: 2 },
      mediaBAtOne: { seriesId: ref('series.testSeries.id'), mediaId: ref('media.mediaB.id'), position: 1 },
    },
  },
  mediaWithTwoEpisodes: {
    media: {
      episodicShow: { ...mediaDefaults, nameJa: 'エピソード作品', nameRomaji: 'Episodic Show', nameEn: 'Episodic Show' },
    },
    episodes: {
      first: { mediaId: ref('media.episodicShow.id'), episodeNumber: 1, titleEn: 'First', segmentCount: 0 },
      second: { mediaId: ref('media.episodicShow.id'), episodeNumber: 2, titleEn: 'Second', segmentCount: 0 },
    },
  },
  mediaWithThreeEpisodes: {
    media: {
      episodicShow: { ...mediaDefaults, nameJa: 'エピソード作品', nameRomaji: 'Episodic Show', nameEn: 'Episodic Show' },
    },
    episodes: {
      first: { mediaId: ref('media.episodicShow.id'), episodeNumber: 1, segmentCount: 0 },
      second: { mediaId: ref('media.episodicShow.id'), episodeNumber: 2, segmentCount: 0 },
      third: { mediaId: ref('media.episodicShow.id'), episodeNumber: 3, segmentCount: 0 },
    },
  },
  seiyuuNoCharacters: {
    seiyuu: {
      kana: {
        nameJapanese: '花澤香菜',
        nameEnglish: 'Kana Hanazawa',
        externalIds: { anilist: '72854' },
        imageUrl: 'https://example.com/kana.jpg',
      },
    },
  },
  characterNoAppearances: {
    seiyuu: {
      kana: {
        nameJapanese: '花澤香菜',
        nameEnglish: 'Kana Hanazawa',
        externalIds: { anilist: '72855' },
        imageUrl: 'https://example.com/kana.jpg',
      },
    },
    characters: {
      alice: {
        nameJapanese: 'アリス',
        nameEnglish: 'Alice',
        externalIds: { anilist: '99001' },
        imageUrl: 'https://example.com/alice.jpg',
        seiyuu: ref('seiyuu.kana'),
      },
    },
  },
  twoSeriesAlphabetical: {
    series: {
      bSeries: { nameJa: 'B', nameRomaji: 'B', nameEn: 'B Series' },
      aSeries: { nameJa: 'A', nameRomaji: 'A', nameEn: 'A Series' },
    },
  },
  twoSeriesForSearch: {
    series: {
      naruto: { nameJa: 'ナルト', nameRomaji: 'Naruto', nameEn: 'Naruto' },
      bleach: { nameJa: 'ブリーチ', nameRomaji: 'Bleach', nameEn: 'Bleach' },
    },
  },
  threeSeriesForPagination: {
    series: {
      aSeries: { nameJa: 'A', nameRomaji: 'A', nameEn: 'A' },
      bSeries: { nameJa: 'B', nameRomaji: 'B', nameEn: 'B' },
      cSeries: { nameJa: 'C', nameRomaji: 'C', nameEn: 'C' },
    },
  },
  singleMedia: {
    media: { testShow: { ...mediaDefaults } },
  },
  singleSeries: {
    series: { testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' } },
  },
  seriesAndMedia: {
    media: { testShow: { ...mediaDefaults } },
    series: { testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' } },
  },
  seriesWithLinkedMedia: {
    media: { testShow: { ...mediaDefaults } },
    series: { testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' } },
    seriesMedia: {
      testLink: { seriesId: ref('series.testSeries.id'), mediaId: ref('media.testShow.id'), position: 1 },
    },
  },
  mediaWithEpisode: {
    media: { testShow: { ...mediaDefaults } },
    episodes: {
      pilot: { mediaId: ref('media.testShow.id'), episodeNumber: 1, titleEn: 'Pilot', segmentCount: 0 },
    },
  },
  mediaWithThirdEpisode: {
    media: { testShow: { ...mediaDefaults } },
    episodes: {
      thirdOne: { mediaId: ref('media.testShow.id'), episodeNumber: 3, titleEn: 'Third One', segmentCount: 0 },
    },
  },
  kevinActivities: {
    activities: {
      kevinSearch: { userId: ref('users.kevin.id'), activityType: ActivityType.SEARCH, searchQuery: '猫' },
      kevinExport: { userId: ref('users.kevin.id'), activityType: ActivityType.ANKI_EXPORT, segmentUuid: 'seg-1' },
      kevinPlay1: { userId: ref('users.kevin.id'), activityType: ActivityType.SEGMENT_PLAY, mediaId: 42 },
      kevinPlay2: { userId: ref('users.kevin.id'), activityType: ActivityType.SEGMENT_PLAY, mediaId: 99 },
      kevinListAdd: { userId: ref('users.kevin.id'), activityType: ActivityType.LIST_ADD_SEGMENT, mediaId: 42 },
    },
  },
  davidActivity: {
    activities: {
      davidSearch: { userId: ref('users.david.id'), activityType: ActivityType.SEARCH, searchQuery: 'other-user' },
    },
  },
} satisfies Record<string, FixtureCatalog>;

export type FixtureSetName = keyof typeof FIXTURE_SETS;
