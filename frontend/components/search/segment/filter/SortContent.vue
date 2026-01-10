<script setup>
const { t } = useI18n();
import { mdiDice2, mdiSortAscending, mdiSortDescending, mdiSort, mdiFilterOutline, mdiClockOutline, mdiClockAlertOutline } from '@mdi/js';
const router = useRouter();
const route = useRoute();
const sortType = ref(route.query.sort);
const emit = defineEmits(['randomSortSelected']);

const previousSort = ref(route.query.sort || 'none');

const sortContent = async (type) => {
    const query = { ...route.query };
    if (type === 'none') {
        delete query.sort;
    } else {
        query.sort = type;
    }

    if (type !== previousSort.value) {
        sortType.value = type;
        await router.push({ query });        
    } else if (type === 'random') {
        // El sort no ha cambiado, pero es 'random', emitimos el evento
        emit('randomSortSelected');
    }
    previousSort.value = type;
};

watch(() => route.query.sort, (newSort) => {
    previousSort.value = newSort || 'none';
}, { immediate: true });

</script>
<template>
    <SearchDropdownContainer class="gap-2 mb-4 text-xs w-full flex" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton class="w-full items-center text-center align-middle flex"
                dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiFilterOutline" />
                {{ t('searchpage.main.buttons.sortmain') }}
                <span v-if="sortType && sortType !== 'none'">
                    ({{ t(`searchpage.main.buttons.sort${sortType}`) }})
                </span>
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent>
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