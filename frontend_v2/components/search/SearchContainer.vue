<script setup>
import { useI18n } from '#imports'
const { t } = useI18n()

const apiSearch = useApiSearch();
const route = useRoute();

let searchData = ref(null);
let cursor = ref(null);
let query = ref('彼女');
let isLoading = ref(false);
let categorySelected = ref(0)

let querySearchMedia = ref('')

onMounted(async () => {
    // 1. Get all params for make first search
    query.value = route.query.query;

    // Finally get all sentences
    await fetchSentences();

    // Logic for infinite scroll
    window.addEventListener('scroll', handleScroll);
    window.HSStaticMethods.autoInit();
});

onBeforeRouteUpdate(async (to, from) => {
    query.value = to.query.query;

    // We must clear results from before
    cursor.value = null

    await fetchSentences();

})

onBeforeUnmount(() => {
    window.removeEventListener('scroll', handleScroll);
});

// Fetch sentences with an infinite scroll
const fetchSentences = async () => {
    try {
        isLoading.value = true;

        let body = {
            query: query.value,
            limit: 10
        };

        if (cursor.value) {
            body.cursor = cursor.value;
        }

        const response = await apiSearch.getSentenceV1(body);

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


// Logic for infinite scroll
const handleScroll = () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight && !isLoading.value) {
        fetchSentences();
    }
};

const getCategoryCount = (category) => {
  if (category === 0) {
    return searchData.value.categoryStatistics.reduce((total, item) => total + item.count, 0);
  }
  const item = searchData.value.categoryStatistics.find(item => item.category === category);
  return item ? item.count : 0;
};

</script>
<template>
    <!-- Tabs -->
    <div class="pb-4" v-if="searchData?.categoryStatistics?.length > 0">
        <GeneralTabsContainer>
            <GeneralTabsHeader>
                <GeneralTabsItem category="0" categoryName="Todo"
                    :count="getCategoryCount(0)"
                    :isActive="categorySelected === 0" @click="categoryFilter(0)" />
                <GeneralTabsItem category="1" categoryName="Anime"
                    :count="getCategoryCount(1)"
                    :isActive="categorySelected === 1" @click="categoryFilter(1)" />
                <GeneralTabsItem category="3" categoryName="Liveaction"
                    :count="getCategoryCount(3)"
                    :isActive="categorySelected === 3" @click="categoryFilter(3)" />
            </GeneralTabsHeader>
        </GeneralTabsContainer>
    </div>
    <!-- End Tabs -->

    <div class="grid grid-cols-5">
        <!-- Segment -->
        <div class="col-span-4">
            <SearchSegmentContainer :searchData="searchData" :categorySelected="categorySelected" />
        </div>
        <!-- End Segment-->

        <!-- Filters -->
        <div class="pl-4">
            <SearchSegmentFilterContent :searchData="searchData" :categorySelected="categorySelected" />
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