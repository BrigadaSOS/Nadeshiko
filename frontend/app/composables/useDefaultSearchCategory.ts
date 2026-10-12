import type { Category } from '@brigadasos/nadeshiko-sdk';
import { isCategory, resolveDefaultCategorySlug } from '~/utils/categories';

/** Stored form of the preference: an API category, or `ALL` for "no category filter". */
export type DefaultSearchCategory = Category | 'ALL';

/**
 * An explicit URL category wins over the preference. A hidden default resolves to all without
 * changing the stored choice, so unhiding restores it.
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
