export interface SegmentDocument {
  uuid: string;
  position: number;
  status: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  content: string;
  contentLength: number;
  contentSpanish?: string; // Optional - may not exist
  contentSpanishMt: boolean; // Required - has default false in DB
  contentEnglish?: string; // Optional - may not exist
  contentEnglishMt: boolean; // Required - has default false in DB
  isNsfw: boolean;
  storage: 'local' | 'r2';
  hashedId: string;
  category: string; // "ANIME", "JDRAMA"
  episode: number;
  mediaId: number;
}
