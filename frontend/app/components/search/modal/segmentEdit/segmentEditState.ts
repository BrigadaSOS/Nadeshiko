import type { Segment } from '~/types/search';

export interface SegmentEditFormState {
  ja: string;
  en: string;
  enMt: boolean;
  es: string;
  esMt: boolean;
  status: Segment['status'];
  contentRating: Segment['contentRating'];
  position: number;
  startTimeMs: number;
  endTimeMs: number;
  ratingAnalysisJson: string;
}

export type SegmentEditJsonField = 'ratingAnalysis';

export type SegmentEditJsonErrors = Record<SegmentEditJsonField, string>;

export const TEXT_MAX_LENGTH = 500;

/** Validates a JSON textarea, writing the message into `errors` for the field. */
export const validateJson = (
  json: string,
  field: SegmentEditJsonField,
  errors: SegmentEditJsonErrors,
  invalidMessage: string,
): boolean => {
  if (!json.trim()) {
    errors[field] = '';
    return true;
  }
  try {
    JSON.parse(json);
    errors[field] = '';
    return true;
  } catch {
    errors[field] = invalidMessage;
    return false;
  }
};
