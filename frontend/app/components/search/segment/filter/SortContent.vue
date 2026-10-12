<script setup lang="ts">
import {
  mdiFilterOutline,
  mdiSort,
  mdiSortAscending,
  mdiSortDescending,
  mdiClockOutline,
  mdiClockAlertOutline,
  mdiDice2,
} from '@mdi/js';

const { t } = useI18n();
const route = useRoute();
const { setQuery } = useQuerySync();

const emit = defineEmits<{
  /** Any sort was picked, including the one already applied. */
  sortSelected: [];
}>();

/** The URL keeps sidebar and drawer controls synchronized, including copies remounted during navigation. */
const currentSort = computed(() => (typeof route.query.sort === 'string' ? route.query.sort : 'none'));

/** Persist random seeds in the URL for reproducible reloads/shared links. Without one the backend uses a daily
 * shuffle; choose a different seed so re-picking Random changes the URL.
 */
const nextRandomSeed = (current: number | null): number => {
  let seed = current;
  while (seed === null || seed === current) {
    seed = Math.floor(Math.random() * 2 ** 31);
  }
  return seed;
};

const sortContent = async (type: string) => {
  emit('sortSelected');

  if (type === 'random') {
    const current = Number(route.query.seed);
    await setQuery({
      sort: 'random',
      seed: String(nextRandomSeed(Number.isInteger(current) ? current : null)),
    });
    return;
  }

  // Every other sort is idempotent, so re-picking the one in force is a no-op.
  // The seed goes with random: leaving it behind would put a parameter in the
  // URL that nothing reads and that reappears if random is picked again.
  if (type === currentSort.value) return;

  await setQuery({ sort: type === 'none' ? null : type, seed: null });
};
</script>
<template>
    <!-- Its own button above the title list, full width so the label stays
         visible. `text-sm` is load-bearing on desktop: the sidebar column is
         `yomitan-ignore` (font-size: 0) and this control no longer inherits
         a size from the card. -->
    <SearchDropdownContainer class="w-full flex" dropdownId="nd-dropdown-with-header" teleport>
        <template #default>
            <SearchDropdownMainButton
                dropdown-button-class="w-full py-2.5 px-4 text-center flex justify-center items-center gap-x-2 text-sm font-semibold rounded-lg border border-hairline bg-button-primary-main text-ink hover:bg-surface-hover disabled:opacity-50 disabled:pointer-events-none outline-none"
                dropdownId="nd-dropdown-with-header">
                <UiBaseIcon :path="mdiFilterOutline" />
                {{ t('searchpage.main.buttons.sortmain') }}
                <span v-if="currentSort !== 'none'" data-testid="sort-active-label">
                    ({{ t(`searchpage.main.buttons.sort${currentSort}`) }})
                </span>
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent :header="t('searchpage.main.buttons.sortmain')">
                <SearchDropdownItem @click="sortContent('none')" :text="t('searchpage.main.buttons.sortlengthnone')"
                    :iconPath="mdiSort" />
                <SearchDropdownItem @click="sortContent('asc')" :text="t('searchpage.main.buttons.sortlengthmin')"
                    :iconPath="mdiSortAscending" />
                <SearchDropdownItem @click="sortContent('desc')" :text="t('searchpage.main.buttons.sortlengthmax')"
                    :iconPath="mdiSortDescending" />
                <SearchDropdownItem @click="sortContent('time_asc')" :text="t('searchpage.main.buttons.sorttime_asc')"
                    :iconPath="mdiClockOutline" />
                <SearchDropdownItem @click="sortContent('time_desc')" :text="t('searchpage.main.buttons.sorttime_desc')"
                    :iconPath="mdiClockAlertOutline" />
                <SearchDropdownItem @click="sortContent('random')" :text="t('searchpage.main.buttons.sortrandom')"
                    :iconPath="mdiDice2" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>
</template>