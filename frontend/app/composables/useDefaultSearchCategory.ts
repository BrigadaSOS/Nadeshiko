import type { Category } from '@brigadasos/nadeshiko-sdk';
import { isCategory, resolveDefaultCategorySlug } from '~/utils/categories';

/** Stored form of the preference: an API category, or `ALL` for "no category filter". */
export type DefaultSearchCategory = Category | 'ALL';

/**
 * The category tab a search opens on when the URL names none.
 *
 * A reader who only ever watches anime should not have to click the Anime tab on
 * every search, so the landing tab is a stored preference rather than a constant
 * `all`. It is only a *default*: `?category=` in the URL always wins, which keeps
 * shared links pointing at what the sender saw.
 *
 * A default naming a category the reader has since hidden wholesale
 * (`useHiddenCategories`) resolves to `all` instead of to a tab whose results
 * were deliberately dropped. The stored value is left alone, so unhiding the
 * category brings the choice back rather than making them set it twice.
 */
export function useDefaultSearchCategory() {
  const user = userStore();
  const { hiddenCategories, isCategoryHidden } = useHiddenCategories();

  const storedDefault = computed<DefaultSearchCategory>(() => {
    if (!user.isLoggedIn) return 'ALL';
    const raw = user.preferences?.defaultSearchCategory;
    return isCategory(raw) ? raw : 'ALL';
  });

  /** The stored choice names a category the reader has since hidden, so it does not apply. */
  const isDefaultCategoryHidden = computed<boolean>(
    () => storedDefault.value !== 'ALL' && isCategoryHidden(storedDefault.value),
  );

  /** The preference as a URL slug, ready to stand in for a missing `?category=`. */
  const defaultCategorySlug = computed<string>(() =>
    resolveDefaultCategorySlug(storedDefault.value, hiddenCategories.value),
  );

  return { storedDefault, defaultCategorySlug, isDefaultCategoryHidden };
}
