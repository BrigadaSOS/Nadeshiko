import { Entity, PrimaryGeneratedColumn, Column, OneToMany, DeleteDateColumn, Index, Not, BeforeInsert } from 'typeorm';
import type { FindOptionsRelations } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Episode } from './Episode';
import { MediaCharacter } from './MediaCharacter';
import { MediaExternalId } from './MediaExternalId';
import { Segment, SegmentStatus } from './Segment';
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

export enum MediaInclude {
  MEDIA = 'media',
  MEDIA_CHARACTERS = 'media.characters',
}

interface MediaRelationsOptions {
  includeCharacters?: boolean;
  includeEpisodes?: boolean;
  includeExternalIds?: boolean;
}

@Entity('Media')
export class Media extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'public_id', type: 'varchar', unique: true })
  publicId!: string;

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

  @Column({ type: 'varchar' })
  studio!: string;

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

  @Column({ type: 'varchar' })
  version!: string;

  @Column({ name: 'hash_salt', type: 'varchar', nullable: true })
  hashSalt?: string;

  @Column({ name: 'storage_base_path', type: 'varchar' })
  storageBasePath!: string;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

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
    includeCharacters = false,
    includeEpisodes = true,
    includeExternalIds = true,
  }: MediaRelationsOptions = {}): FindOptionsRelations<Media> {
    return {
      ...(includeEpisodes ? { episodes: true } : {}),
      ...(includeExternalIds ? { externalIds: true } : {}),
      ...(includeCharacters ? { characters: { character: { seiyuu: true } } } : {}),
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

  static async getPaginatedMediaInfo(
    page: number,
    pageSize: number,
  ): Promise<{
    results: Record<number, ReturnType<typeof Media.toMediaInfoData>>;
    stats: {
      totalAnimes: number;
      totalSegments: number;
      fullTotalAnimes: number;
      fullTotalSegments: number;
    };
  }> {
    const offset = (page - 1) * pageSize;

    const media = await Media.find({
      relations: ['episodes'],
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: offset,
    });

    const results: Record<number, ReturnType<typeof Media.toMediaInfoData>> = {};
    let totalSegments = 0;

    for (const m of media) {
      const info = Media.toMediaInfoData(m);
      results[m.id] = info;
      totalSegments += info.segmentCount ?? 0;
    }

    // Get global stats
    const globalStats = await Media.getGlobalStats();

    return {
      results,
      stats: {
        totalAnimes: media.length,
        totalSegments: totalSegments,
        fullTotalAnimes: globalStats.fullTotalAnimes,
        fullTotalSegments: globalStats.fullTotalSegments,
      },
    };
  }

  static async getGlobalStats(): Promise<{
    fullTotalAnimes: number;
    fullTotalSegments: number;
  }> {
    const [mediaCount, segmentCount] = await Promise.all([
      Media.count(),
      Segment.count({ where: { status: Not(SegmentStatus.DELETED) } }),
    ]);

    return {
      fullTotalAnimes: mediaCount,
      fullTotalSegments: segmentCount,
    };
  }

  private static toMediaInfoData(media: Media) {
    const externalIds: Record<string, string> = {};
    for (const ext of media.externalIds ?? []) {
      externalIds[ext.source.toLowerCase()] = ext.externalId;
    }

    return {
      mediaId: media.id,
      publicId: media.publicId,
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
      episodeCount: media.episodes?.length ?? 0,
      studio: media.studio,
      seasonName: media.seasonName,
      seasonYear: media.seasonYear,
      externalIds,
      storageBasePath: media.storageBasePath,
    };
  }
}
