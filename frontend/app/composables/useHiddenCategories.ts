import type { Category } from '@brigadasos/nadeshiko-sdk';
import { ALL_CATEGORIES, isCategory } from '~/utils/categories';
import { handleApiError } from '~/utils/apiError';

/**
 * Whole-category hiding, the coarse counterpart to `useHiddenMedia`: instead of
 * naming individual shows, a reader drops every live action title or every
 * YouTube video at once.
 *
 * Stored in the same user preferences blob, so it follows the reader across
 * devices, and applied the same way -- as a filter on the outgoing search, not as
 * a post-filter on the results, so the pagination and tab counts stay honest.
 */
export function useHiddenCategories() {
  const user = userStore();

  const hiddenCategories = computed<Category[]>(() => {
    if (!user.isLoggedIn) return [];
    const raw = user.preferences?.hiddenCategories;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isCategory);
  });

  const visibleCategories = computed<Category[]>(() =>
    ALL_CATEGORIES.filter((category) => !hiddenCategories.value.includes(category)),
  );

  const hasHiddenCategories = computed(() => hiddenCategories.value.length > 0);

  const isCategoryHidden = (category: Category): boolean => hiddenCategories.value.includes(category);

  /**
   * The last visible category cannot be hidden. `filters.category` reads an empty
   * term list as "no filter", so hiding it would hand back the entire corpus
   * rather than nothing -- the API rejects it too, this just keeps the UI from
   * offering a click that only ever fails.
   */
  const canToggleCategory = (category: Category): boolean =>
    isCategoryHidden(category) || visibleCategories.value.length > 1;

  /** Returns whether the change reached the server; see `useHiddenMedia`. */
  const toggleCategory = async (category: Category): Promise<boolean> => {
    if (!user.isLoggedIn || !canToggleCategory(category)) return false;

    const isUnhiding = isCategoryHidden(category);
    const next = isUnhiding
      ? hiddenCategories.value.filter((item) => item !== category)
      : [...hiddenCategories.value, category];

    const previous = hiddenCategories.value;
    user.preferences = {
      ...(user.preferences ?? {}),
      hiddenCategories: next,
    };

    try {
      const sdk = useNadeshikoSdk();
      await sdk.updateUserPreferences({ hiddenCategories: next });
    } catch (error) {
      // Same reasoning as the hidden-media rollback: a kept optimistic update
      // would show the category as hidden here while every other device -- and
      // the next page load -- still shows it.
      user.preferences = {
        ...(user.preferences ?? {}),
        hiddenCategories: previous,
      };
      handleApiError('hidden-categories:toggle-failed', error, {
        toastKey: 'hiddenCategories.updateError',
        context: { category, action: isUnhiding ? 'unhide' : 'hide' },
      });
      return false;
    }

    const forceSearchCounter = useState('force-search-counter', () => 0);
    forceSearchCounter.value++;

    return true;
  };

  return {
    hiddenCategories,
    visibleCategories,
    hasHiddenCategories,
    isCategoryHidden,
    canToggleCategory,
    toggleCategory,
  };
}
