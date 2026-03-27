<script setup>
import { useI18n } from 'vue-i18n';
import { CATEGORY_API_MAPPING } from '~/utils/categories';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { mediaName: getMediaName } = useMediaName();
const props = defineProps(['searchData', 'categorySelected']);
const mediaStatistics = ref([]);
const querySearchMedia = ref('');
const debouncedQuerySearchMedia = ref('');
const categorySelected = ref(props.categorySelected);
const categoryApiMapping = CATEGORY_API_MAPPING;

// Cache translated strings outside computed to avoid repeated lookups
const allLabel = computed(() => t('searchpage.main.labels.all'));

// Debounce implementation: update debounced value 300ms after input changes
let debounceTimer = null;
watch(
  querySearchMedia,
  (newValue) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedQuerySearchMedia.value = newValue.toLowerCase();
    }, 300);
  },
  { immediate: true },
);

watch(
  () => props.searchData,
  (newData) => {
    if (newData?.media) {
      mediaStatistics.value = newData.media;
    } else {
      mediaStatistics.value = [];
    }
  },
  { immediate: true },
);

watch(
  () => props.categorySelected,
  (newCategory) => {
    if (newCategory !== null && newCategory !== undefined) {
      categorySelected.value = newCategory;
    } else {
      categorySelected.value = 'all';
    }
  },
  { immediate: true },
);

const normalizedStatistics = computed(() => {
  return mediaStatistics.value.map((item) => ({
    ...item,
    displayName: getMediaName(item),
    displayNameLower: getMediaName(item).toLowerCase(),
    nameEnLower: item?.nameEn?.toLowerCase() || '',
    nameJaLower: item?.nameJa?.toLowerCase() || '',
    nameRomajiLower: item?.nameRomaji?.toLowerCase() || '',
  }));
});

const filteredMedia = computed(() => {
  const selectedCategory = categoryApiMapping[categorySelected.value];
  const totalCount = normalizedStatistics.value
    .filter((item) => categorySelected.value === 'all' || item.category === selectedCategory)
    .reduce((a, b) => a + parseInt(b.matchCount || 0, 10), 0);

  const filteredItems = normalizedStatistics.value.filter((item) => {
    const categoryFilter = categorySelected.value === 'all' || item.category === selectedCategory;
    const nameFilterEnglish = item.nameEnLower.includes(debouncedQuerySearchMedia.value);
    const nameFilterJapanese = item.nameJaLower.includes(debouncedQuerySearchMedia.value);
    const nameFilterRomaji = item.nameRomajiLower.includes(debouncedQuerySearchMedia.value);

    return categoryFilter && (nameFilterEnglish || nameFilterJapanese || nameFilterRomaji);
  });

  const allOption = {
    publicId: null,
    displayName: allLabel.value,
    matchCount: totalCount,
  };

  if (filteredItems.length === 0) {
    return [allOption];
  }

  const sortedItems = filteredItems.sort((a, b) => {
    const nameA = a.displayNameLower;
    const nameB = b.displayNameLower;

    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  return [allOption, ...sortedItems];
});

const selectedMediaId = computed(() => {
  return route.query.media ? String(route.query.media) : null;
});

const filterAnime = (publicId, _animeName) => {
  const query = { ...route.query };

  if (!publicId) {
    delete query.media;
  } else {
    query.media = publicId;
    // Clear episode filter when selecting a different media
    delete query.episode;
  }

  router.push({ path: route.path, query });
};

const clearFilters = () => {
  const query = { ...route.query };
  delete query.media;
  router.push({ path: route.path, query });
};
</script>

<template>
    <div class="relative mx-auto">
        <ul
            class="z-20 divide-y divide-white/5 dark:border-white/5 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 rounded-lg dark:bg-button-primary-main border dark:text-white">
            <div class="flex items-center w-full px-4 py-2 text-center rounded-t-lg rounded-l-lg">
                <span class="font-medium text-sm flex-1 text-center">{{ $t('searchpage.main.labels.contentList') }}</span>
                <button
                    @click="clearFilters"
                    class="text-xs text-gray-400 hover:text-gray-200 dark:hover:text-white absolute right-4">
                    {{ $t('episodeFilter.clear') }}
                </button>
            </div>
            <div class="flex flex-inline">
                <input type="search" v-model="querySearchMedia" id="default-search2" autocomplete="off"
                    class="block w-full p-4 pl-4 text-xs xxl:text-sm xxm:text-xl text-gray-900 dark:bg-neutral-800  dark:placeholder-gray-400 dark:text-white/45 dark:focus:ring-input-focus-ring dark:focus:border-input-focus-ring"
                    :placeholder="$t('filterContent.searchPlaceholder')" required />
                <div class="absolute z-10 right-0 mr-2 mt-4 inline-flex items-center pr-3 pointer-events-none">
                    <svg aria-hidden="true" class="w-5 h-5 text-white/60 dark:text-gray-400" fill="none"
                        stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>
            </div>
            <div class="overflow-auto snap-y max-h-[14rem]">
                <li class="snap-start" v-for="item in filteredMedia" :key="item.publicId || 'all'">
                    <button @click="filterAnime(item.publicId, item.displayName)"
                        :class="{ 'bg-sgrayhover': (!item.publicId && selectedMediaId === null) || (item.publicId === selectedMediaId) }"
                        class="flex truncate border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-xs xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                        <span class="truncate max-w-[80%] overflow-hidden text-ellipsis">{{ item.displayName }}</span>
                        <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs">
                            {{ item.matchCount }}
                        </span>
                    </button>
                </li>
            </div>

            <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600">
            </div>
        </ul>
    </div>
</template>
