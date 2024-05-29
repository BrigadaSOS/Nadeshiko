<script setup>

const { t } = useI18n();
const apiSearch = useApiSearch();
const route = useRoute();
const router = useRouter();

// Main variables
let searchData = ref(null);
let isLoading = ref(false);

// Available params for search
let query = ref('');
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

        // Fetch data from API
        const response = await apiSearch.getSentenceV1(body);

        // Update search data
        if (cursor.value === null) {
            searchData.value = response;
        } else {
            searchData.value.sentences.push(...response.sentences);
        }

        cursor.value = response.cursor;
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
        <div class="flex mx-auto w-full">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <SearchSegmentContainer :searchData="searchData" :categorySelected="category" />
            </div>
            <!-- Filters -->
            <div class="pl-4 mx-auto hidden 2xl:block">
                <SearchSegmentFilterSortContent/>
                <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
                
            </div>
        </div>
    </div>
</template>
