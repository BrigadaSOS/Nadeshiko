import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index, BeforeInsert } from 'typeorm';
import type { FindOptionsRelations } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { MediaCharacter } from './MediaCharacter';
import { MediaExternalId } from './MediaExternalId';
import type { Segment } from './Segment';
import type { SeriesMedia } from './SeriesMedia';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';
import { SegmentStorage } from './Segment';
import { Cache, createCacheNamespace } from '@lib/cache';
import { nanoid } from 'nanoid';

export const MEDIA_INFO_CACHE = createCacheNamespace('mediaInfo');
const MEDIA_INFO_TTL_MS = 24 * 60 * 60 * 1000;

export enum CategoryType {
  ANIME = 'ANIME',
  JDRAMA = 'JDRAMA',
}

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

  @OneToMany('MediaCharacter', 'media', { cascade: true })
  characters!: MediaCharacter[];

  @OneToMany('SeriesMedia', 'media')
  seriesEntries!: SeriesMedia[];

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

  static async getMediaInfoMap(): Promise<{
    results: Map<number, ReturnType<typeof Media.toMediaInfoData>>;
    stats: {
      totalAnimes: number;
      totalSegments: number;
      fullTotalAnimes: number;
      fullTotalSegments: number;
    };
  }> {
    const cached = Cache.get<{
      results: Map<number, ReturnType<typeof Media.toMediaInfoData>>;
      stats: {
        totalAnimes: number;
        totalSegments: number;
        fullTotalAnimes: number;
        fullTotalSegments: number;
      };
    }>(MEDIA_INFO_CACHE, 'all');
    if (cached) {
      return cached;
    }

    const allMedia = await Media.find({
      relations: ['episodes', 'externalIds'],
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

    const result = {
      results: mediaMap,
      stats: {
        totalAnimes: mediaMap.size,
        totalSegments,
        ...stats,
      },
    };

    Cache.set(MEDIA_INFO_CACHE, 'all', result, MEDIA_INFO_TTL_MS);
    return result;
  }

  static async getGlobalStats(): Promise<{
    fullTotalAnimes: number;
    fullTotalSegments: number;
    fullTotalEpisodes: number;
  }> {
    const cached = Cache.get<{
      fullTotalAnimes: number;
      fullTotalSegments: number;
      fullTotalEpisodes: number;
    }>(MEDIA_INFO_CACHE, 'globalStats');
    if (cached) return cached;

    const [mediaCount, segmentCountResult, episodeCount] = await Promise.all([
      Media.count(),
      Episode.createQueryBuilder('e')
        .select('COALESCE(SUM(e.segmentCount), 0)', 'total')
        .getRawOne<{ total: string }>(),
      Episode.count(),
    ]);
    const segmentCount = Number(segmentCountResult?.total ?? 0);

    const stats = {
      fullTotalAnimes: mediaCount,
      fullTotalSegments: segmentCount,
      fullTotalEpisodes: episodeCount,
    };

    Cache.set(MEDIA_INFO_CACHE, 'globalStats', stats, MEDIA_INFO_TTL_MS);
    return stats;
  }

  private static toMediaInfoData(media: Media) {
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
