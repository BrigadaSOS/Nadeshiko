<script setup lang="ts">
import type { Category } from '@brigadasos/nadeshiko-sdk';
import { ALL_CATEGORIES, CATEGORY_SLUG_BY_API } from '~/utils/categories';

const { t } = useI18n();
const { isCategoryHidden, canToggleCategory, toggleCategory } = useHiddenCategories();
const posthog = usePostHog();

const CATEGORY_LABEL_KEYS: Record<Category, string> = {
  ANIME: 'searchContainer.categoryAnime',
  JDRAMA: 'searchContainer.categoryLiveaction',
  YOUTUBE: 'searchContainer.categoryYoutube',
};

const categories = ALL_CATEGORIES;

const categoryLabel = (category: Category): string => t(CATEGORY_LABEL_KEYS[category]);

const categoryDescription = (category: Category): string =>
  t(`accountSettings.account.hiddenCategoryDescriptions.${CATEGORY_SLUG_BY_API[category]}`);

const onToggle = async (category: Category) => {
  const wasHidden = isCategoryHidden(category);
  await toggleCategory(category);
  posthog?.capture('category_visibility_changed', {
    action: wasHidden ? 'unhidden' : 'hidden',
    category,
  });
};
</script>

<template>
  <div class="dark:bg-card-background p-6 mb-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.account.hiddenCategories') }}</h3>
    <p class="text-gray-400 text-sm mt-1">{{ t('accountSettings.account.hiddenCategoriesDescription') }}</p>

    <div class="border-b pt-4 border-white/10" />

    <ul class="mt-2 divide-y divide-white/10">
      <li
        v-for="category in categories"
        :key="category"
        class="flex items-center justify-between gap-4 py-3"
        data-testid="hidden-category-row"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-100">{{ categoryLabel(category) }}</p>
          <p class="text-xs text-gray-400 mt-0.5">{{ categoryDescription(category) }}</p>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <span class="text-xs" :class="isCategoryHidden(category) ? 'text-gray-500' : 'text-gray-300'">
            {{ isCategoryHidden(category) ? t('accountSettings.account.hiddenCategoryHidden') : t('accountSettings.account.hiddenCategoryShown') }}
          </span>
          <label
            class="relative inline-flex items-center"
            :class="canToggleCategory(category) ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
            :title="canToggleCategory(category) ? undefined : t('accountSettings.account.hiddenCategoriesLastVisible')"
          >
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="!isCategoryHidden(category)"
              :disabled="!canToggleCategory(category)"
              :aria-label="categoryLabel(category)"
              :data-testid="`hidden-category-toggle-${CATEGORY_SLUG_BY_API[category]}`"
              @change="onToggle(category)"
            />
            <div
              class="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-button-accent-main transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"
            />
          </label>
        </div>
      </li>
    </ul>

    <p class="text-xs text-gray-500 mt-3">{{ t('accountSettings.account.hiddenCategoriesLastVisible') }}</p>
  </div>
</template>
