import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index, BeforeInsert } from 'typeorm';
import type { FindOptionsRelations } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { MediaExternalId } from './MediaExternalId';
import type { Segment } from './Segment';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';
import { SegmentStorage } from './Segment';
import { Cache, createCacheNamespace } from '@lib/cache';
import { nanoid } from 'nanoid';

export const MEDIA_INFO_CACHE = createCacheNamespace('mediaInfo');
const MEDIA_INFO_TTL_MS = 24 * 60 * 60 * 1000;

export enum CategoryType {
  ANIME = 'ANIME',
  JDRAMA = 'JDRAMA',
  YOUTUBE = 'YOUTUBE',
}

export const ALL_CATEGORIES: CategoryType[] = Object.values(CategoryType);

interface MediaRelationsOptions {
  includeEpisodes?: boolean;
  includeExternalIds?: boolean;
}

@Entity('Media')
export class Media extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'public_id', type: 'varchar', unique: true })
  publicId!: string;

  @Column({ name: 'slug', type: 'varchar', unique: true })
  slug!: string;

  @BeforeInsert()
  generatePublicId() {
    this.publicId = nanoid(12);
  }

  @Column({ name: 'japanese_name', type: 'varchar' })
  nameJa!: string;

  @Column({ name: 'romaji_name', type: 'varchar' })
  nameRomaji!: string;

  @Column({ name: 'english_name', type: 'varchar' })
  nameEn!: string;

  @Column({ name: 'airing_format', type: 'varchar' })
  airingFormat!: string;

  @Column({ name: 'airing_status', type: 'varchar' })
  airingStatus!: string;

  @Column({ type: 'text', array: true })
  genres!: string[];

  @Column({ name: 'storage', type: 'enum', enum: SegmentStorage, default: SegmentStorage.R2 })
  storage!: SegmentStorage;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string; // Format: YYYY-MM-DD

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate?: string; // Format: YYYY-MM-DD

  @Column({ type: 'varchar', nullable: true })
  studio?: string | null;

  @Column({ name: 'season_name', type: 'varchar' })
  seasonName!: string;

  @Index()
  @Column({ name: 'season_year', type: 'int' })
  seasonYear!: number;

  @Column({
    type: 'enum',
    enum: CategoryType,
    default: CategoryType.ANIME,
  })
  category!: CategoryType;

  @Column({ name: 'num_segments', type: 'int', default: 0 })
  segmentCount!: number;

  @Column({ name: 'episode_count', type: 'int', default: 0 })
  episodeCount!: number;

  @Column({ name: 'dialogue_duration_ms', type: 'bigint', default: 0 })
  dialogueDurationMs!: number;

  @Column({ name: 'en_human_count', type: 'int', default: 0 })
  enHumanCount!: number;

  @Column({ name: 'en_machine_count', type: 'int', default: 0 })
  enMachineCount!: number;

  @Column({ name: 'es_human_count', type: 'int', default: 0 })
  esHumanCount!: number;

  @Column({ name: 'es_machine_count', type: 'int', default: 0 })
  esMachineCount!: number;

  @Column({ type: 'varchar' })
  version!: string;

  @Column({ name: 'hash_salt', type: 'varchar', nullable: true })
  hashSalt?: string;

  @Column({ name: 'storage_base_path', type: 'varchar' })
  storageBasePath!: string;

  @OneToMany('Segment', 'media')
  segments!: Segment[];

  @OneToMany('Episode', 'media', { cascade: true })
  episodes!: Episode[];

  @OneToMany('MediaExternalId', 'media', { cascade: true })
  externalIds!: MediaExternalId[];

  static buildRelations({
    includeEpisodes = true,
    includeExternalIds = true,
  }: MediaRelationsOptions = {}): FindOptionsRelations<Media> {
    return {
      ...(includeEpisodes ? { episodes: true } : {}),
      ...(includeExternalIds ? { externalIds: true } : {}),
    };
  }

  /**
   * Shared while the map is being built. A cache miss is not one query, it is a `Media.find`
   * across two relations, and every concurrent search wants the same answer -- without this
   * the moment the entry expires is the moment every in-flight request runs that query for
   * itself. The promise is dropped once settled so a failure does not stick.
   */
  private static inFlightInfoMap: Promise<MediaInfoMapResult> | null = null;
  private static inFlightGlobalStats: Promise<MediaGlobalStats> | null = null;

  static async getMediaInfoMap(): Promise<MediaInfoMapResult> {
    const cached = Cache.get<MediaInfoMapResult>(MEDIA_INFO_CACHE, 'all');
    if (cached) {
      return cached;
    }
    if (Media.inFlightInfoMap) {
      return Media.inFlightInfoMap;
    }

    Media.inFlightInfoMap = Cache.getOrCompute(MEDIA_INFO_CACHE, 'all', MEDIA_INFO_TTL_MS, async () => {
      const allMedia = await Media.find({
        relations: {
          episodes: true,
          externalIds: true,
        },
        order: { createdAt: 'DESC' },
      });

      const mediaMap = new Map<number, ReturnType<typeof Media.toMediaInfoData>>();
      let totalSegments = 0;

      for (const media of allMedia) {
        const info = Media.toMediaInfoData(media);
        mediaMap.set(media.id, info);
        totalSegments += info.segmentCount ?? 0;
      }

      const stats = await Media.getGlobalStats();

      return {
        results: mediaMap,
        stats: {
          totalAnimes: mediaMap.size,
          totalSegments,
          ...stats,
        },
      };
    }).finally(() => {
      Media.inFlightInfoMap = null;
    });

    return Media.inFlightInfoMap;
  }

  static async getGlobalStats(): Promise<MediaGlobalStats> {
    const cached = Cache.get<MediaGlobalStats>(MEDIA_INFO_CACHE, 'globalStats');
    if (cached) return cached;
    if (Media.inFlightGlobalStats) return Media.inFlightGlobalStats;

    Media.inFlightGlobalStats = Cache.getOrCompute(MEDIA_INFO_CACHE, 'globalStats', MEDIA_INFO_TTL_MS, async () => {
      const [mediaCount, segmentCountResult, episodeCount] = await Promise.all([
        Media.count(),
        Episode.createQueryBuilder('e')
          .select('COALESCE(SUM(e.segmentCount), 0)', 'total')
          .getRawOne<{ total: string }>(),
        Episode.count(),
      ]);

      return {
        fullTotalAnimes: mediaCount,
        fullTotalSegments: Number(segmentCountResult?.total ?? 0),
        fullTotalEpisodes: episodeCount,
      };
    }).finally(() => {
      Media.inFlightGlobalStats = null;
    });

    return Media.inFlightGlobalStats;
  }

  static toMediaInfoData(media: Media) {
    const externalIds: Record<string, string> = {};
    for (const ext of media.externalIds ?? []) {
      externalIds[ext.source.toLowerCase()] = ext.externalId;
    }

    return {
      mediaId: media.id,
      publicId: media.publicId,
      slug: media.slug,
      category: media.category, // "ANIME", "JDRAMA"
      categoryName: media.category, // Same as category - for backwards compatibility
      createdAt: media.createdAt.toISOString(),
      updatedAt: media.updatedAt ? media.updatedAt.getTime() : undefined,
      nameRomaji: media.nameRomaji,
      nameEn: media.nameEn,
      nameJa: media.nameJa,
      airingFormat: media.airingFormat,
      airingStatus: media.airingStatus,
      genres: media.genres,
      cover: getMediaCoverUrl(media),
      banner: getMediaBannerUrl(media),
      startDate: media.startDate as string, // YYYY-MM-DD format
      endDate: media.endDate as string | undefined, // YYYY-MM-DD format
      version: media.version,
      segmentCount: media.segmentCount,
      episodeCount: media.episodeCount,
      studio: media.studio,
      seasonName: media.seasonName,
      seasonYear: media.seasonYear,
      externalIds,
      storageBasePath: media.storageBasePath,
    };
  }
}

type MediaInfoData = ReturnType<typeof Media.toMediaInfoData>;

interface MediaGlobalStats {
  fullTotalAnimes: number;
  fullTotalSegments: number;
  fullTotalEpisodes: number;
}

export interface MediaInfoMapResult {
  results: Map<number, MediaInfoData>;
  stats: {
    totalAnimes: number;
    totalSegments: number;
    fullTotalAnimes: number;
    fullTotalSegments: number;
  };
}
