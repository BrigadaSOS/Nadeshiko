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
/** `?sort=` is always a single value; anything else is treated as unset. */
const readSortFromRoute = () => (typeof route.query.sort === 'string' ? route.query.sort : undefined);

const sortType = ref<string | undefined>(readSortFromRoute());
const emit = defineEmits<{
  randomSortSelected: [];
}>();

const previousSort = ref<string>(readSortFromRoute() ?? 'none');

const sortContent = async (type: string) => {
  if (type !== previousSort.value) {
    sortType.value = type;
    await setQuery({ sort: type === 'none' ? null : type });
  } else if (type === 'random') {
    // El sort no ha cambiado, pero es 'random', emitimos el evento
    emit('randomSortSelected');
  }
  previousSort.value = type;
};

watch(
  () => route.query.sort,
  (newSort) => {
    previousSort.value = typeof newSort === 'string' ? newSort : 'none';
  },
  { immediate: true },
);
</script>
<template>
    <SearchDropdownContainer class="gap-2 mb-4 text-xs w-full flex" dropdownId="nd-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton class="w-full items-center text-center align-middle flex"
                dropdownId="nd-dropdown-with-header">
                <UiBaseIcon :path="mdiFilterOutline" />
                {{ t('searchpage.main.buttons.sortmain') }}
                <span v-if="sortType && sortType !== 'none'">
                    ({{ t(`searchpage.main.buttons.sort${sortType}`) }})
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