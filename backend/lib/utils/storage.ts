/**
 * Storage abstraction layer for media assets.
 *
 * This module provides a unified interface for generating URLs to media assets
 * stored in different backends (local, R2/CDN).
 */

export type Storage = 'local' | 'r2';

const STORAGE_BASE_URLS: Record<Storage, string> = {
  r2: process.env.R2_BASE_URL || 'https://cdn.nadeshiko.co/media',
  local: process.env.LOCAL_BASE_URL || '/assets',
};

/**
 * Get the cover image URL for a media entry.
 * Path pattern: {mediaId}/cover.webp
 */
export function getMediaCoverUrl(media: { id: number; storage: Storage }): string {
  const baseUrl = STORAGE_BASE_URLS[media.storage];
  return `${baseUrl}/${media.id}/cover.webp`;
}

/**
 * Get the banner image URL for a media entry.
 * Path pattern: {mediaId}/banner.webp
 */
export function getMediaBannerUrl(media: { id: number; storage: Storage }): string {
  const baseUrl = STORAGE_BASE_URLS[media.storage];
  return `${baseUrl}/${media.id}/banner.webp`;
}

/**
 * Get the segment image URL.
 * Path pattern: {mediaId}/{episodeNumber}/{hashedId}.webp
 */
export function getSegmentImageUrl(segment: {
  mediaId: number;
  episode: number;
  storage: Storage;
  hashedId: string;
}): string {
  const baseUrl = STORAGE_BASE_URLS[segment.storage];
  return `${baseUrl}/${segment.mediaId}/${segment.episode}/${segment.hashedId}.webp`;
}

/**
 * Get the segment audio URL.
 * Path pattern: {mediaId}/{episodeNumber}/{hashedId}.mp3
 */
export function getSegmentAudioUrl(segment: {
  mediaId: number;
  episode: number;
  storage: Storage;
  hashedId: string;
}): string {
  const baseUrl = STORAGE_BASE_URLS[segment.storage];
  return `${baseUrl}/${segment.mediaId}/${segment.episode}/${segment.hashedId}.mp3`;
}

/**
 * Get the segment video URL.
 * Path pattern: {mediaId}/{episodeNumber}/{hashedId}.mp4
 */
export function getSegmentVideoUrl(segment: {
  mediaId: number;
  episode: number;
  storage: Storage;
  hashedId: string;
}): string {
  const baseUrl = STORAGE_BASE_URLS[segment.storage];
  return `${baseUrl}/${segment.mediaId}/${segment.episode}/${segment.hashedId}.mp4`;
}

/**
 * Get the base URL for a storage backend.
 */
export function getStorageBaseUrl(storage: Storage): string {
  return STORAGE_BASE_URLS[storage];
}
