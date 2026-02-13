import { Entity, PrimaryColumn, Column, OneToMany, DeleteDateColumn, Index, Not } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { MediaCharacter } from './MediaCharacter';
import { type Segment, SegmentStatus } from './Segment';
import type { ListItem } from './ListItem';
import type { MediaInfoData } from '@app/types/queryMediaInfoResponse';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';
import { Cache, createCacheNamespace } from '@lib/cache';

export const MEDIA_INFO_CACHE = createCacheNamespace('mediaInfo');
const MEDIA_INFO_TTL_MS = 24 * 60 * 60 * 1000;

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
  segments!: Segment[];

  @OneToMany('Episode', 'media', { cascade: true })
  episodes!: Episode[];

  @OneToMany('MediaCharacter', 'media', { cascade: true })
  characters!: MediaCharacter[];

  @OneToMany('ListItem', 'media')
  listItems!: ListItem[];

  static async getMediaInfoMap(): Promise<{
    results: Map<number, MediaInfoData>;
    stats: {
      totalAnimes: number;
      totalSegments: number;
      fullTotalAnimes: number;
      fullTotalSegments: number;
    };
  }> {
    return Cache.fetch(MEDIA_INFO_CACHE, 'all', MEDIA_INFO_TTL_MS, async () => {
      const allMedia = await Media.find({
        relations: ['episodes'],
        order: { createdAt: 'DESC' },
      });

      const mediaMap = new Map<number, MediaInfoData>();
      let totalSegments = 0;

      for (const media of allMedia) {
        const info = Media.toMediaInfoData(media);
        mediaMap.set(media.id, info);
        totalSegments += info.numSegments ?? 0;
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
    });
  }

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

  static async updateSegmentCount(mediaId: number): Promise<void> {
    await Media.createQueryBuilder()
      .update()
      .set({
        numSegments: () => `(SELECT COUNT(*) FROM "Segment" WHERE "media_id" = :mediaId AND "status" != 0)`,
      })
      .where('id = :mediaId')
      .setParameter('mediaId', mediaId)
      .execute();

    Cache.invalidate(MEDIA_INFO_CACHE);
  }

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
