import type { MorphemeData } from '@app/types/morpheme';

// Field names match the ES index mapping in elasticsearch-schema.json
export interface SegmentDocument {
  uuid: string;
  position: number;
  status: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  contentJa: string;
  characterCount: number;
  contentEs?: string;
  contentEsMt: boolean;
  contentEn?: string;
  contentEnMt: boolean;
  isNsfw: boolean;
  storage: string;
  hashedId: string;
  category: string; // "ANIME", "JDRAMA"
  episode: number;
  mediaId: number;
  morphemes?: MorphemeData[];
}
