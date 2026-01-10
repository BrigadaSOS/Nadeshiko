export interface SegmentDocument {
  id: number;
  uuid: string;
  position: number;
  status: number;
  start_time: string | null;
  end_time: string | null;
  content: string | null;
  content_length: number | null;
  content_spanish: string | null;
  content_spanish_mt: boolean | null;
  content_english: string | null;
  content_english_mt: boolean | null;
  is_nsfw: boolean;
  path_image: string | null;
  path_audio: string | null;
  actor_ja: string | null;
  actor_es: string | null;
  actor_en: string | null;
  episode: number;
  season: number;
  media_id: number;
  Media: MediaDocument;
}

export interface MediaDocument {
  id: number;
  id_anilist: number | null;
  id_tmdb: number | null;
  created_at: Date;
  updated_at: Date | null;
  romaji_name: string;
  english_name: string | null;
  japanese_name: string | null;
  folder_media_name: string | null;
  airing_format: string | null;
  airing_status: string | null;
  genres: string[] | null;
  cover: string | null;
  banner: string | null;
  release_date: string | null;
  version: string;
  category: number;
  num_segments: number;
  num_seasons: number;
  num_episodes: number;
}

export interface ReindexMediaOptions {
  mediaId: number;
  season?: number;
  episode?: number;
}

export interface ReindexResult {
  success: boolean;
  indexed: number;
  failed: number;
  deleted: number;
  errors: string[];
}

export type ReindexProgressCallback = (progress: {
  phase: 'deleting' | 'indexing' | 'complete';
  current: number;
  total: number;
  mediaId?: number;
}) => void;
