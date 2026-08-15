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

/**
 * The sort in force, read from `?sort=` rather than latched at setup.
 *
 * A local ref went stale the moment the sort changed anywhere other than this
 * button, and this button exists twice: the sticky sidebar and the mobile
 * drawer are both mounted, so sorting from one left the other's label reading
 * "Sort sentences" with no sort named. Worse, whichever copy remounted while
 * the navigation was still in flight latched `undefined` and lost the label
 * even for the sort it had just applied itself -- which is what made picking
 * Random from the drawer look like nothing had happened. The URL is the one
 * thing every copy agrees on, so read it every time.
 *
 * `?sort=` is always a single value; anything else is treated as unset.
 */
const currentSort = computed(() => (typeof route.query.sort === 'string' ? route.query.sort : 'none'));

/**
 * A fresh shuffle for `sort=random`, written into the URL beside it.
 *
 * The seed has to travel in the URL rather than live in memory. Without one the
 * backend derives its seed from the calendar day, so "random" was one fixed
 * order for the whole day and re-picking it refetched a byte-identical page --
 * asking again with the same seed is not asking for a different shuffle. In the
 * URL it also means the order is reproducible: a shared link, a reload and the
 * back button all show the same shuffle rather than silently re-rolling one.
 *
 * Drawn away from the current seed so a click always changes the URL; a repeat
 * would navigate nowhere and look like nothing happened.
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
    <SearchDropdownContainer class="w-full flex" dropdownId="nd-dropdown-with-header">
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