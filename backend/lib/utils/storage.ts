import { config } from '@config/config';
import { SegmentStorage } from '@app/models/Segment';

export type Storage = SegmentStorage;
export { SegmentStorage };

const STORAGE_BASE_URLS: Record<SegmentStorage, string> = {
  [SegmentStorage.R2]: config.R2_BASE_URL,
  [SegmentStorage.LOCAL]: '/media',
};

function getBaseUrl(storage: SegmentStorage): string {
  // Normalize to uppercase to handle pre-migration lowercase varchar values (e.g. 'r2' → 'R2')
  const normalized = (typeof storage === 'string' ? storage.toUpperCase() : storage) as SegmentStorage;
  return STORAGE_BASE_URLS[normalized];
}

/**
 * Get the cover image URL for a media entry.
 * Path pattern: {storageBasePath}/cover.webp
 */
export function getMediaCoverUrl(media: { storage: SegmentStorage; storageBasePath: string }): string {
  return `${getBaseUrl(media.storage)}/${media.storageBasePath}/cover.webp`;
}

/**
 * Get the banner image URL for a media entry.
 * Path pattern: {storageBasePath}/banner.webp
 */
export function getMediaBannerUrl(media: { storage: SegmentStorage; storageBasePath: string }): string {
  return `${getBaseUrl(media.storage)}/${media.storageBasePath}/banner.webp`;
}

/**
 * Get the segment image URL.
 * Path pattern: {storageBasePath}/{episodeNumber}/{hashedId}.webp
 */
export function getSegmentImageUrl(segment: {
  episode: number;
  storage: SegmentStorage;
  hashedId: string;
  storageBasePath: string;
}): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${segment.episode}/${segment.hashedId}.webp`;
}

/**
 * Get the segment audio URL.
 * Path pattern: {storageBasePath}/{episodeNumber}/{hashedId}.mp3
 */
export function getSegmentAudioUrl(segment: {
  episode: number;
  storage: SegmentStorage;
  hashedId: string;
  storageBasePath: string;
}): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${segment.episode}/${segment.hashedId}.mp3`;
}

/**
 * Get the segment video URL.
 * Path pattern: {storageBasePath}/{episodeNumber}/{hashedId}.mp4
 */
export function getSegmentVideoUrl(segment: {
  episode: number;
  storage: SegmentStorage;
  hashedId: string;
  storageBasePath: string;
}): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${segment.episode}/${segment.hashedId}.mp4`;
}

/**
 * Get the base URL for a storage backend.
 */
export function getStorageBaseUrl(storage: SegmentStorage): string {
  return STORAGE_BASE_URLS[storage];
}
