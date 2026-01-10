<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const props = defineProps(['searchData', 'categorySelected']);
const statistics = ref([]);
const querySearchMedia = ref('');
const debouncedQuerySearchMedia = ref('');
const categorySelected = ref(props.categorySelected);

// Cache translated strings outside computed to avoid repeated lookups
const allLabel = computed(() => t('searchpage.main.labels.all'));

// Debounce implementation: update debounced value 300ms after input changes
let debounceTimer = null;
watch(querySearchMedia, (newValue) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debouncedQuerySearchMedia.value = newValue.toLowerCase();
    }, 300);
}, { immediate: true });

watch(() => props.searchData, (newData) => {
    if (newData && newData.statistics) {
        statistics.value = newData.statistics;
    } else {
        statistics.value = [];
    }
}, { immediate: true });

watch(() => props.categorySelected, (newCategory) => {
    if (newCategory !== null && newCategory !== undefined) {
        categorySelected.value = newCategory;
    } else {
        categorySelected.value = 0;
    }
}, { immediate: true });

// Pre-compute lowercase names once when statistics change
const normalizedStatistics = computed(() => {
    return statistics.value.map(item => ({
        ...item,
        name_anime_en_lower: item?.name_anime_en?.toLowerCase() || '',
        name_anime_jp_lower: item?.name_anime_jp?.toLowerCase() || '',
        name_anime_romaji_lower: item?.name_anime_romaji?.toLowerCase() || '',
    }));
});

const filteredMedia = computed(() => {
    // Calculate total count for "All" from all statistics before filtering
    const totalCount = normalizedStatistics.value
        .filter((item) => categorySelected.value === 0 || item.category === categorySelected.value)
        .reduce((a, b) => a + parseInt(b.amount_sentences_found || 0), 0);

    const filteredItems = normalizedStatistics.value.filter((item) => {
        const categoryFilter = categorySelected.value === 0 || item.category === categorySelected.value;
        // Use pre-computed lowercase names and debounced search query
        const nameFilterEnglish = item.name_anime_en_lower.includes(debouncedQuerySearchMedia.value);
        const nameFilterJapanese = item.name_anime_jp_lower.includes(debouncedQuerySearchMedia.value);
        const nameFilterRomaji = item.name_anime_romaji_lower.includes(debouncedQuerySearchMedia.value);

        return categoryFilter && (nameFilterEnglish || nameFilterJapanese || nameFilterRomaji);
    });

    // Build "All" option separately to avoid sorting it
    const allOption = {
        anime_id: 0,
        name_anime_en: allLabel.value,
        amount_sentences_found: totalCount
    };

    if (filteredItems.length === 0) {
        return [allOption];
    }

    // Sort only the filtered items, then prepend "All"
    const sortedItems = filteredItems.sort((a, b) => {
        const nameA = a.name_anime_en_lower;
        const nameB = b.name_anime_en_lower;

        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    return [allOption, ...sortedItems];
});

const selectedMediaId = computed(() => {
    return route.query.media ? Number(route.query.media) : null;
});

const filterAnime = (anime_id, anime_name) => {
    const query = { ...route.query };

    if (anime_id === 0) {
        delete query.media;
    } else {
        query.media = anime_id;
    }

    router.push({ query });
};

</script>

<template>
    <div class="relative mx-auto">
        <ul
            class="z-20 divide-y divide-white/5 dark:border-white/5 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 rounded-lg dark:bg-button-primary-main border dark:text-white">
            <div class="flex items-center w-full px-4 py-2 text-center justify-center rounded-t-lg rounded-l-lg">
                <span class="font-medium text-sm">{{ $t('searchpage.main.labels.contentList') }}</span>
            </div>
            <div class="flex flex-inline">
                <input type="search" v-model="querySearchMedia" id="default-search2" autocomplete="off"
                    class="block w-full p-4 pl-4 text-xs xxl:text-sm xxm:text-xl text-gray-900 dark:bg-neutral-800  dark:placeholder-gray-400 dark:text-white/45 dark:focus:ring-gray-500 dark:focus:border-gray-500"
                    :placeholder="$t('filterContent.searchPlaceholder')" required />
                <div class="absolute z-10 right-0 mr-2 mt-4 inline-flex items-center pr-3 pointer-events-none">
                    <svg aria-hidden="true" class="w-5 h-5 text-white/60 dark:text-gray-400" fill="none"
                        stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>
            </div>
            <div class="overflow-auto snap-y max-h-[50vh]">
                <li class="snap-start" v-for="item in filteredMedia" :key="item.anime_id">
                    <button @click="filterAnime(item.anime_id, item.name_anime_en)"
                        :class="{ 'bg-sgrayhover': (item.anime_id === 0 && selectedMediaId === null) || (item.anime_id === selectedMediaId) }"
                        class="flex truncate border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-xs xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                        <span class="truncate max-w-[80%] overflow-hidden text-ellipsis">{{ item.name_anime_en }}</span>
                        <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs">
                            {{ item.amount_sentences_found }}
                        </span>
                    </button>
                </li>
            </div>

            <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600">
            </div>
        </ul>
    </div>
</template>
