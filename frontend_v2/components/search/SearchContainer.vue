<script setup>
const { t } = useI18n()
const apiSearch = useApiSearch();
const route = useRoute();

// Main variables
let searchData = ref(null);
let isLoading = ref(false);

// Available params for search
let query = ref('');
let category = ref(0);
let cursor = ref(null);

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
const handleScroll = () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight && !isLoading.value) {
        fetchSentences();
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
const categoryFilter = async (filter) => {
    category.value = filter;
    cursor.value = null;
    await fetchSentences();
    window.scrollTo(0, 0);
};

// Lifecycle hooks
onMounted(async () => {
    query.value = route.query.query;
    category.value = categoryMapping[route.query.category] ?? 0;

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

    if (category.value === undefined) {
        category.value = 0;
    }

    cursor.value = null;
    await fetchSentences();
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
        <!-- End Tabs -->

        <div class="flex mx-auto w-full">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <SearchSegmentContainer :searchData="searchData" :categorySelected="category" />
            </div>
            <!-- End Segment-->

            <!-- Filters -->
            <div class="pl-4 mx-auto hidden 2xl:block">
                <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
            </div>
        </div>
    </div>
</template>

<style>
#tab-headers ul {
    margin: 0;
    padding: 0;
    display: flex;
    border-bottom: 1px solid #dddddd21;
}

#tab-headers ul li {
    list-style: none;
    padding: 1rem 1.25rem;
    position: relative;
    cursor: pointer;
}

#tab-headers ul li.active {
    color: rgb(251, 120, 120);
    font-weight: bold;
}

#tab-headers ul li.active:after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    height: 2px;
    width: 100%;
    background: rgb(251, 120, 120);
}

#active-tab,
#tab-headers {
    width: 100%;
}

#active-tab {
    padding: 0.75rem;
}
</style>
