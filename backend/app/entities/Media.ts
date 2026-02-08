import { Entity, PrimaryColumn, Column, OneToMany, DeleteDateColumn, Index, Not } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { MediaCharacter } from './MediaCharacter';
import { Segment, SegmentStatus } from './Segment';
import type { MediaInfoData } from '@lib/types/queryMediaInfoResponse';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

export enum CategoryType {
  ANIME = 'ANIME',
  JDRAMA = 'JDRAMA',
}

@Entity('Media')
export class Media extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'anilist_id', type: 'int', unique: true })
  anilistId!: number;

  @Column({ name: 'japanese_name', type: 'varchar' })
  japaneseName!: string;

  @Column({ name: 'romaji_name', type: 'varchar' })
  romajiName!: string;

  @Column({ name: 'english_name', type: 'varchar' })
  englishName!: string;

  @Column({ name: 'airing_format', type: 'varchar' })
  airingFormat!: string;

  @Column({ name: 'airing_status', type: 'varchar' })
  airingStatus!: string;

  @Column({ type: 'text', array: true })
  genres!: string[];

  @Column({ name: 'storage', type: 'varchar' })
  storage!: 'local' | 'r2';

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
  numSegments!: number;

  @Column({ type: 'varchar' })
  version!: string;

  @Column({ name: 'hash_salt', type: 'varchar', nullable: true })
  hashSalt?: string;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  @OneToMany('Segment', 'media')
  segments!: any[];

  @OneToMany('Episode', 'media', { cascade: true })
  episodes!: Episode[];

  @OneToMany('MediaCharacter', 'media', { cascade: true })
  characters!: MediaCharacter[];

  @OneToMany('ListItem', 'media')
  listItems!: any[];

  private static MEDIA_INFO_CACHE: Map<number, MediaInfoData> | null = null;
  private static TOTAL_STATS_CACHE: { fullTotalAnimes: number; fullTotalSegments: number } | null = null;

  static async getMediaInfoMap(): Promise<{
    results: Map<number, MediaInfoData>;
    stats: {
      totalAnimes: number;
      totalSegments: number;
      fullTotalAnimes: number;
      fullTotalSegments: number;
    };
  }> {
    // Return cache if available
    if (Media.MEDIA_INFO_CACHE && Media.TOTAL_STATS_CACHE) {
      const totalSegments = Array.from(Media.MEDIA_INFO_CACHE.values()).reduce(
        (sum, m) => sum + (m.numSegments ?? 0),
        0,
      );
      return {
        results: Media.MEDIA_INFO_CACHE,
        stats: {
          totalAnimes: Media.MEDIA_INFO_CACHE.size,
          totalSegments,
          fullTotalAnimes: Media.TOTAL_STATS_CACHE.fullTotalAnimes,
          fullTotalSegments: Media.TOTAL_STATS_CACHE.fullTotalSegments,
        },
      };
    }

    // Fetch all media with episodes relation
    const allMedia = await Media.find({
      relations: ['episodes'],
      order: { createdAt: 'DESC' },
    });

    // Build map keyed by media_id
    const mediaMap = new Map<number, MediaInfoData>();
    let totalSegments = 0;

    for (const media of allMedia) {
      const info = Media.toMediaInfoData(media);
      mediaMap.set(media.id, info);
      totalSegments += info.numSegments ?? 0;
    }

    // Get global counts
    const stats = await Media.getGlobalStats();

    // Cache the results
    Media.MEDIA_INFO_CACHE = mediaMap;
    Media.TOTAL_STATS_CACHE = stats;

    return {
      results: mediaMap,
      stats: {
        totalAnimes: mediaMap.size,
        totalSegments,
        ...stats,
      },
    };
  }

  /**
   * Get paginated media info with stats (for searchController)
   */
  static async getPaginatedMediaInfo(
    page: number,
    pageSize: number,
  ): Promise<{
    results: { [key: number]: MediaInfoData };
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

    const results: { [key: number]: MediaInfoData } = {};
    let totalSegments = 0;

    for (const m of media) {
      const info = Media.toMediaInfoData(m);
      results[m.id] = info;
      totalSegments += info.numSegments ?? 0;
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

  /**
   * Get global stats (total media count, total segment count)
   */
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

  /**
   * Invalidate the media cache
   * Call this when media/segments are added/updated
   */
  static invalidateCache(): void {
    Media.MEDIA_INFO_CACHE = null;
    Media.TOTAL_STATS_CACHE = null;
  }

  /**
   * Convert Media entity to MediaInfoData format
   * Includes computed fields: cover, banner, num_episodes, num_seasons, folder_media_name
   */
  private static toMediaInfoData(media: Media): MediaInfoData {
    return {
      mediaId: media.id,
      category: media.category, // "ANIME", "JDRAMA"
      categoryName: media.category, // Same as category - for backwards compatibility
      createdAt: media.createdAt.toISOString(),
      updatedAt: media.updatedAt ? media.updatedAt.getTime() : undefined,
      romajiName: media.romajiName,
      englishName: media.englishName,
      japaneseName: media.japaneseName,
      airingFormat: media.airingFormat,
      airingStatus: media.airingStatus,
      genres: media.genres,
      cover: getMediaCoverUrl(media),
      banner: getMediaBannerUrl(media),
      startDate: media.startDate as string, // YYYY-MM-DD format
      endDate: media.endDate as string | undefined, // YYYY-MM-DD format
      folderMediaName: media.romajiName.replace(/[^a-zA-Z0-9]/g, '_'),
      version: media.version,
      numSegments: media.numSegments,
      numEpisodes: media.episodes?.length ?? 0,
    };
  }
}
