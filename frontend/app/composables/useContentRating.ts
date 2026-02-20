import type { ContentRating } from '@brigadasos/nadeshiko-sdk';
export type ContentRatingMode = 'show' | 'blur' | 'hide';

export interface ContentRatingPreferences {
  suggestive: ContentRatingMode;
  explicit: ContentRatingMode;
}

const DEFAULT_PREFERENCES: ContentRatingPreferences = {
  suggestive: 'blur',
  explicit: 'blur',
};

const ALL_RATINGS: ContentRating[] = ['SAFE', 'SUGGESTIVE', 'QUESTIONABLE', 'EXPLICIT'];

const toPreferenceKey = (rating: string): keyof ContentRatingPreferences | null => {
  const normalized = rating.toUpperCase();
  if (normalized === 'SUGGESTIVE') return 'suggestive';
  if (normalized === 'QUESTIONABLE') return 'suggestive';
  if (normalized === 'EXPLICIT') return 'explicit';
  return null;
};

export function useContentRating() {
  const user = userStore();

  const preferences = computed<ContentRatingPreferences>(() => ({
    ...DEFAULT_PREFERENCES,
    ...(user.preferences?.contentRatingPreferences ?? {}),
  }));

  /** Content ratings to include in search results (ratings not hidden by user) */
  const contentRating = computed<ContentRating[]>(() => {
    const prefs = preferences.value;
    return ALL_RATINGS.filter((rating) => {
      if (rating === 'SAFE') return true;
      const key = toPreferenceKey(rating);
      return key ? prefs[key] !== 'hide' : true;
    });
  });

  const shouldBlur = (rating: string): boolean => {
    if (rating.toUpperCase() === 'SAFE') return false;
    const key = toPreferenceKey(rating);
    if (!key) return false;
    const mode = preferences.value[key];
    return mode === 'blur';
  };

  const isRestricted = (rating: string): boolean => {
    return rating.toUpperCase() !== 'SAFE';
  };

  return { preferences, contentRating, shouldBlur, isRestricted };
}
