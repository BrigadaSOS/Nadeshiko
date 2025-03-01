<script setup>
import { mdiRefresh } from '@mdi/js'

const { t } = useI18n();
const apiSearch = useApiSearch();
const route = useRoute();
const router = useRouter();
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

// Main variables
let searchData = ref(null);
let isLoading = ref(false);
let endOfResults = ref(false);
const hasMoreResults = ref(true)
const showLoadMoreButton = ref(false)
const initialError = ref(false);

// Available params for search
let query = ref('');
let previousQuery = ref('');
let category = ref(0);
let cursor = ref(null);
let media = ref(null);
let sort = ref(null)
let uuid = ref(null);

// Category mapping
const categoryMapping = {
    'all': 0,
    'anime': 1,
    'liveaction': 3
};

// SEO Meta

const dynamicTitle = computed(() => {
  if (uuid.value && searchData.value?.sentences?.length > 0) {
    const sentence = searchData.value.sentences[0];
    return `${sentence.basic_info.name_anime_en} | Nadeshiko`;
  }
  return route.query.query 
    ? `${route.query.query} - Búsqueda en Nadeshiko` 
    : 'Nadeshiko - Búsqueda';
})

const dynamicDescription = computed(() => {
  if (uuid.value && searchData.value?.sentences?.length > 0) {
    const sentence = searchData.value.sentences[0];
    return `${sentence.segment_info.content_jp} De ${sentence.basic_info.name_anime_en}, ${sentence.basic_info.season === 0 ? 'Película' : `Temporada ${sentence.basic_info.season}, Episodio ${sentence.basic_info.episode}`}`;
  }
  return route.query.query 
    ? `Resultados de búsqueda para "${route.query.query}" en Nadeshiko` 
    : 'Busca frases de anime y live action en Nadeshiko';
})

const updateMetadata = () => {
  const metaData = {
    title: dynamicTitle.value,
    meta: [
      { name: 'description', content: dynamicDescription.value },
      { property: 'og:title', content: dynamicTitle.value },
      { property: 'og:description', content: dynamicDescription.value },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: dynamicTitle.value },
      { name: 'twitter:description', content: dynamicDescription.value },
    ]
  }

  if (uuid.value && searchData.value?.sentences?.length > 0) {
    const sentence = searchData.value.sentences[0];
    
    metaData.meta.push(
      { property: 'og:image', content: sentence.media_info.path_image + '?width=1200&height=630' },
      { name: 'twitter:image', content: sentence.media_info.path_image + '?width=1200&height=630' }
    )

    if (sentence.media_info.path_audio) {
      const mp4Url = sentence.media_info.path_video;
      
      metaData.meta.push(
        { property: 'og:video', content: mp4Url },
        { property: 'og:video:type', content: 'video/mp4' },
        { property: 'og:video:width', content: '1280' },  
        { property: 'og:video:height', content: '720' }  
      )

      metaData.meta.push(
        { name: 'twitter:card', content: 'player' },
        { name: 'twitter:player', content: `https://dev.nadeshiko.co/embed/player?url=${encodeURIComponent(mp4Url)}` },
        { name: 'twitter:player:width', content: '1280' },
        { name: 'twitter:player:height', content: '720' }
      )
    }

    metaData.meta.push(
      { property: 'og:locale', content: 'ja_JP' },
      { property: 'og:locale:alternate', content: 'es_ES' },
      { property: 'og:locale:alternate', content: 'en_US' }
    )

    metaData.meta.push(
        { property: 'og:site_name', content: `Nadeshiko - ${sentence.basic_info.name_anime_en}` }
    )

  }

  useHead(metaData)
}

onBeforeMount(() => {
  updateMetadata()
})

////////////////////////////////

// Fetch sentences with an infinite scroll
const fetchSentences = async (fromButton = false) => {
    try {
        if (endOfResults.value || isLoading.value) return;

        isLoading.value = true;
        showLoadMoreButton.value = false;

        // Build request body
        let body = {
            query: query.value,
            limit: 20,
            extra: true
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

        if(uuid.value){
            body.uuid = uuid.value;
        }

        // Define the behaviour of elements based on params
        if (previousQuery.value == query.value) {
            if (!cursor.value) {
                if (searchData.value && searchData.value.sentences) {
                    searchData.value.sentences = null;
                }
            }
        } else {
            searchData.value = null;
        }

        // Fetch data from API      
        const response = await apiSearch.getSentenceV1(body);
        // await delay(5000)

        // Update search data
        if (cursor.value === null) {
            searchData.value = response;
        } else {
            searchData.value.sentences.push(...response.sentences);
        }

        if (response.sentences.length < body.limit) {
            endOfResults.value = true;
            hasMoreResults.value = false;
        } else {
            hasMoreResults.value = true;
        }

        cursor.value = response.cursor;
        previousQuery.value = query.value;
        initialError.value = false;
    } catch (error) {
        console.error('Error fetching sentences:', error);
        if (!searchData.value || !searchData.value.sentences || searchData.value.sentences.length === 0) {
            initialError.value = true;
        }
        hasMoreResults.value = false;
        showLoadMoreButton.value = true;
    } finally {
        isLoading.value = false;
    }
};

const loadMore = () => {
    fetchSentences(true);
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

const handleRandomLogic = () => {
    cursor.value = null;
    endOfResults.value = false;
    searchData.value.sentences = null;
    fetchSentences();
}

// Lifecycle hooks
onMounted(async () => {
    query.value = route.query.query;
    category.value = categoryMapping[route.query.category] ?? 0;
    media.value = route.query.media;
    sort.value = route.query.sort;
    uuid.value = route.query.uuid;

    if (category.value === undefined) {
        category.value = 0;
    }

    await fetchSentences();
    updateMetadata();
});

onBeforeRouteUpdate(async (to, from) => {
    query.value = to.query.query;
    category.value = categoryMapping[to.query.category] ?? 0;
    media.value = to.query.media;
    sort.value = to.query.sort;
    uuid.value = route.query.uuid;

    if (category.value === undefined) {
        category.value = 0;
    }

    cursor.value = null;
    endOfResults.value = false;
    await fetchSentences();
    updateMetadata();
});

</script>

<template>
    <SearchSegmentSidebar :searchData="searchData" :categorySelected="category" />
    <div v-if="initialError">
        <section class="w-full">
            <div class="container py-10 flex items-center px-6 mx-auto">
                <div class="w-full align-top items-center">
                    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
                        <img class="mb-6"
                            src="https://animeforums.net/uploads/monthly_2022_03/haruhi-suzumiya-kyon-computer-haruhi-suzumiya.gif.be78c7de58e641e3701a97a85d01a059.gif" />
                        <h2 class="font-bold text-red-400 text-3xl">502</h2>
                        <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">Se produjo un
                            error</h1>
                        <p class="mt-4 text-gray-500 dark:text-gray-400">Reintenta la busqueda con el boton de abajo.
                        </p>

                        <UiButtonPrimaryAction class="my-4" @click="fetchSentences()">
                            <template v-if="isLoading">
                                Reintentando...
                                <div role="status">
                                    <svg aria-hidden="true"
                                        class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                                        viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path
                                            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                                            fill="currentColor" />
                                        <path
                                            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                                            fill="currentFill" />
                                    </svg>
                                    <span class="sr-only">Loading...</span>
                                </div>

                            </template>
                            <template v-else>
                                <UiBaseIcon :path="mdiRefresh" @click="fetchSentences()" />
                                Reintentar conexión
                            </template>
                        </UiButtonPrimaryAction>
                    </div>
                </div>
            </div>
        </section>
    </div>
    <div v-else class="flex-1 mx-auto">
        <!-- Tabs -->
        <div class="pb-4" v-if="searchData?.categoryStatistics?.length > 0">
            <GeneralTabsContainer>
                <GeneralTabsHeader>
                    <GeneralTabsItem category="0" categoryName="Todo" :count="getCategoryCount(0)"
                        :isActive="category === 0" @click="categoryFilter(0)" />
                    <GeneralTabsItem v-if="searchData?.categoryStatistics?.find((item) => item.category === 1)"
                        category="1" categoryName="Anime" :count="getCategoryCount(1)" :isActive="category === 1"
                        @click="categoryFilter(1)" />
                    <GeneralTabsItem v-if="searchData?.categoryStatistics?.find((item) => item.category === 3)"
                        category="3" categoryName="Liveaction" :count="getCategoryCount(3)" :isActive="category === 3"
                        @click="categoryFilter(3)" />
                </GeneralTabsHeader>
            </GeneralTabsContainer>
        </div>
        <div v-else-if="isLoading && !searchData?.sentences?.length || !searchData" class="w-full pb-4  animate-pulse">
            <GeneralTabsContainer>
                <GeneralTabsHeader>
                    <div v-for="i in 3" :key="i" class="flex  flex-row space-x-10 gap-10 py-5">
                        <p class="p-2 bg-gray-200 rounded-lg mr-6 dark:bg-neutral-700 px-16"></p>
                    </div>
                </GeneralTabsHeader>
            </GeneralTabsContainer>
        </div>
        <div class="flex mx-auto w-full">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <SearchSegmentContainer current-sentence-index="" :searchData="searchData" :isLoading="isLoading" />
                <GeneralInfiniteScrollObserver @intersect="fetchSentences" v-if="hasMoreResults && !isLoading" />
                <div v-if="showLoadMoreButton" class="text-center mt-4 mb-8">
                    <UiButtonPrimaryAction class="my-1" @click="loadMore">
                        <UiBaseIcon :path="mdiRefresh" />
                        Load more sentences
                    </UiButtonPrimaryAction>
                </div>
            </div>
            <!-- Filters -->
            <div class="2xl:min-w-[18rem] 2xl:max-w-[18rem]">
                <div v-if="searchData?.statistics?.length > 0" class="pl-4 mx-auto hidden 2xl:block">
                    <SearchSegmentFilterSortContent @randomSortSelected="handleRandomLogic()" />
                    <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
                </div>
                <div v-else-if="isLoading && !searchData?.sentences?.length || !searchData">
                    <div class="pl-4 mx-auto hidden 2xl:block min-w-[340px]">
                        <div role=" status" class="hidden w-10/12 2xl:flex flex-col py-6 animate-pulse">
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
    </div>
</template>
