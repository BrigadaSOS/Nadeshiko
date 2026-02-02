export interface MediaDocument {
  id: number;
  anilist_id?: number;
  created_at?: Date;
  updated_at?: Date;
  romaji_name: string;
  english_name?: string;
  japanese_name?: string;
  airing_format?: string;
  airing_status?: string;
  genres?: string[];
  cover_url?: string;
  banner_url?: string;
  start_date: string;
  end_date?: string;
  version: string;
  category: string;
  num_segments: number;
  num_episodes: number;
  studio: string;
  season_name: string;
  season_year: number;
}

export interface SegmentDocument {
  id: number;
  uuid?: string;
  position: number;
  status: number;
  start_time: string;
  end_time: string;
  content: string;
  content_length?: number;
  content_spanish?: string;
  content_spanish_mt?: string;
  content_english?: string;
  content_english_mt?: string;
  is_nsfw?: boolean;
  image_url?: string;
  audio_url?: string;
  actor_ja?: string;
  actor_es?: string;
  actor_en?: string;
  episode: number;
  media_id: number;
  Media: MediaDocument;
}
