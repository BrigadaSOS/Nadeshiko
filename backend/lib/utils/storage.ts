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

type SegmentForUrl = {
  episode: number;
  storage: SegmentStorage;
  hashedId: string;
  storageBasePath: string;
  externalVideoId?: string | null;
};

/**
 * The per-segment storage folder: the YouTube video ID for YOUTUBE media
 * otherwise the episode number.
 */
function getSegmentFolder(segment: SegmentForUrl): string {
  return segment.externalVideoId ?? String(segment.episode);
}

/**
 * Get the segment image URL.
 * Path pattern: {storageBasePath}/{episodeNumber|videoId}/{hashedId}.webp
 */
export function getSegmentImageUrl(segment: SegmentForUrl): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${getSegmentFolder(segment)}/${segment.hashedId}.webp`;
}

/**
 * Get the segment audio URL.
 * Path pattern: {storageBasePath}/{episodeNumber|videoId}/{hashedId}.mp3
 */
export function getSegmentAudioUrl(segment: SegmentForUrl): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${getSegmentFolder(segment)}/${segment.hashedId}.mp3`;
}

/**
 * Get the segment video URL.
 * Path pattern: {storageBasePath}/{episodeNumber|videoId}/{hashedId}.mp4
 */
export function getSegmentVideoUrl(segment: SegmentForUrl): string {
  return `${getBaseUrl(segment.storage)}/${segment.storageBasePath}/${getSegmentFolder(segment)}/${segment.hashedId}.mp4`;
}
