<script setup>

const { t } = useI18n();
const apiSearch = useApiSearch();
const route = useRoute();
const router = useRouter();
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

// Main variables
let searchData = ref(null);
let isLoading = ref(false);

// Available params for search
let query = ref('');
let previousQuery = ref('');
let category = ref(0);
let cursor = ref(null);
let media = ref(null);
let sort = ref(null)

// Category mapping
const categoryMapping = {
    'all': 0,
    'anime': 1,
    'liveaction': 3
};

// Fetch sentences with an infinite scroll
const fetchSentences = async () => {
    try {
        isLoading.value = true;

        // Build request body
        let body = {
            query: query.value,
            limit: 10
        };

        // Add optional parameters, omit category if it is 'all'
        if (category.value !== 0) {
            body.category = [category.value];
        }

        if (media.value !== 0) {
            body.anime_id = media.value
        }

        if (sort.value && sort.value !== 'none') {
            body.content_sort = sort.value;
        }

        if (cursor.value) {
            body.cursor = cursor.value;
        }

        // Define the behaviour of elements based on params
        if (previousQuery.value == query.value) {
            if (!cursor.value) {
                if (searchData.value && searchData.value.sentences) {
                    searchData.value.sentences = null;
                    console.log(searchData.value)
                }
            }
        } else {
            searchData.value = null;
        }

        // Fetch data from API        
        const response = await apiSearch.getSentenceV1(body);

        // Update search data
        if (cursor.value === null) {
            searchData.value = response;
        } else {
            searchData.value.sentences.push(...response.sentences);
        }

        cursor.value = response.cursor;
        previousQuery.value = query.value;
    } catch (error) {
        console.error('Error fetching sentences:', error);
    } finally {
        isLoading.value = false;
    }
};

// Handle scroll event for infinite scroll
const handleScroll = async () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight && !isLoading.value) {
        await fetchSentences();
        window.HSStaticMethods.autoInit();

    }
};

// Get count of sentences for a specific category
const getCategoryCount = (category) => {
    if (category === 0) {
        return searchData.value.categoryStatistics.reduce((total, item) => total + item.count, 0);
    }
    const item = searchData.value.categoryStatistics.find(item => item.category === category);
    return item ? item.count : 0;
};

// Filter sentences by category
const categoryFilter = (filter) => {
    router.push({
        query: {
            ...route.query,
            category: Object.keys(categoryMapping).find(key => categoryMapping[key] === filter)
        }
    });
};

// Lifecycle hooks
onMounted(async () => {
    query.value = route.query.query;
    category.value = categoryMapping[route.query.category] ?? 0;
    media.value = route.query.media;
    sort.value = route.query.sort;

    if (category.value === undefined) {
        category.value = 0;
    }

    await fetchSentences();

    window.addEventListener('scroll', handleScroll);
    window.HSStaticMethods.autoInit();
});

onBeforeRouteUpdate(async (to, from) => {
    query.value = to.query.query;
    category.value = categoryMapping[to.query.category] ?? 0;
    media.value = to.query.media;
    sort.value = to.query.sort;

    if (category.value === undefined) {
        category.value = 0;
    }

    cursor.value = null;
    await fetchSentences();
    window.HSStaticMethods.autoInit();
});


onBeforeUnmount(() => {
    window.removeEventListener('scroll', handleScroll);
});
</script>

<template>
    <SearchSegmentSidebar :searchData="searchData" />
    <div class="flex-1 mx-auto">
        <!-- Tabs -->
        <div class="pb-4" v-if="searchData?.categoryStatistics?.length > 0">
            <GeneralTabsContainer>
                <GeneralTabsHeader>
                    <GeneralTabsItem category="0" categoryName="Todo" :count="getCategoryCount(0)"
                        :isActive="category === 0" @click="categoryFilter(0)" />
                    <GeneralTabsItem category="1" categoryName="Anime" :count="getCategoryCount(1)"
                        :isActive="category === 1" @click="categoryFilter(1)" />
                    <GeneralTabsItem category="3" categoryName="Liveaction" :count="getCategoryCount(3)"
                        :isActive="category === 3" @click="categoryFilter(3)" />
                </GeneralTabsHeader>
            </GeneralTabsContainer>
        </div>
        <div v-else class="w-full pb-4  animate-pulse">
            <GeneralTabsContainer>
                <GeneralTabsHeader>
                    <div v-for="i in 3" :key="i" class="flex  flex-row space-x-10 gap-10 py-5">
                        <p class="p-2 bg-gray-200 rounded-lg mr-6 dark:bg-neutral-700 px-16"></p>
                    </div>
                </GeneralTabsHeader>
            </GeneralTabsContainer>

        </div>
        <div class="flex mx-auto w-full ">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <SearchSegmentContainer :searchData="searchData" :categorySelected="category" />
            </div>
            <!-- Filters -->
            <div v-if="searchData?.statistics?.length > 0" class="pl-4 mx-auto hidden 2xl:block">
                <SearchSegmentFilterSortContent />
                <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
            </div>
            <div v-else>
                <div class="pl-4 mx-auto hidden lg:block min-w-[340px]">
                    <div role=" status" class="hidden w-11/12 lg:flex flex-col py-6 animate-pulse">
                        <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[460px] mb-2.5"></div>
                        <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                        <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[330px] mb-2.5"></div>
                        <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                        <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                        <span class="sr-only">Cargando...</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
