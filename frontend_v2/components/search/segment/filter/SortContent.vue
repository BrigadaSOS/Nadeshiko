<script setup>
const { t } = useI18n();
import { mdiDice2, mdiSortAscending, mdiSortDescending, mdiSort, mdiFilterOutline } from '@mdi/js';
const router = useRouter();
const route = useRoute();
const sortType = ref(route.query.sort);

const sortContent = (type) => {
    const query = { ...route.query };

    if (type === 'none') {
        delete query.sort;
    } else {
        query.sort = type;
    }

    router.push({ query });
    sortType.value = type;
};

</script>
<template>
    <SearchDropdownContainer class="mr-2 mb-4 w-full flex" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton class="w-full items-center text-center align-middle flex"
                dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiFilterOutline" />
                {{ t('searchpage.main.buttons.sortmain') }}
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
                <SearchDropdownItem @click="sortContent('random')" :text="t('searchpage.main.buttons.sortrandom')"
                    :iconPath="mdiDice2" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>
</template>