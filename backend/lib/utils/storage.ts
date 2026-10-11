import { config } from '@config/config';
import { SegmentStorage } from '@app/models/Segment';

export type Storage = SegmentStorage;

const STORAGE_BASE_URLS: Record<SegmentStorage, string> = {
  [SegmentStorage.R2]: config.R2_BASE_URL,
  [SegmentStorage.LOCAL]: '/media',
};

function getBaseUrl(storage: SegmentStorage): string {
  // Normalize to uppercase to handle pre-migration lowercase varchar values (e.g. 'r2' → 'R2')
  const normalized = (typeof storage === 'string' ? storage.toUpperCase() : storage) as SegmentStorage;
  return STORAGE_BASE_URLS[normalized];
}

/** Cover URL: `{storageBasePath}/cover.webp`. */
export function getMediaCoverUrl(media: { storage: SegmentStorage; storageBasePath: string }): string {
  return `${getBaseUrl(media.storage)}/${media.storageBasePath}/cover.webp`;
}

/** Banner URL: `{storageBasePath}/banner.webp`. */
export function getMediaBannerUrl(media: { storage: SegmentStorage; storageBasePath: string }): string {
  return `${getBaseUrl(media.storage)}/${media.storageBasePath}/banner.webp`;
}

type SegmentForUrl = {
  episode: number;
  storage: SegmentStorage;
  hashedId: string;
  storageBasePath: string;
  externalVideoId?: string | null;
};

/** Segment folder is the YouTube video ID for YOUTUBE media, otherwise the episode number. */
function getSegmentFolder(segment: SegmentForUrl): string {
  return segment.externalVideoId ?? String(segment.episode);
}

/** Segment image URL: `{storageBasePath}/{episodeNumber|videoId}/{hashedId}.webp`. */
export function getSegmentImageUrl(segment: SegmentForUrl): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${getSegmentFolder(segment)}/${segment.hashedId}.webp`;
}

/** Segment audio URL: `{storageBasePath}/{episodeNumber|videoId}/{hashedId}.mp3`. */
export function getSegmentAudioUrl(segment: SegmentForUrl): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${getSegmentFolder(segment)}/${segment.hashedId}.mp3`;
}

/** Segment video URL: `{storageBasePath}/{episodeNumber|videoId}/{hashedId}.mp4`. */
export function getSegmentVideoUrl(segment: SegmentForUrl): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${getSegmentFolder(segment)}/${segment.hashedId}.mp4`;
}
