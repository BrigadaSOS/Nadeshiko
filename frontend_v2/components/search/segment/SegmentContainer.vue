<script setup>
import { mdiTranslate, mdiPlay } from '@mdi/js'
import { useI18n } from '#imports'
const { t } = useI18n()

const apiSearch = useApiSearch();

let search_data = ref(null);
let statistics = ref([])
let locale = ref('en');
let cursor = ref(null);
let query = ref('彼女');
let isLoading = ref(false);
let categorySelected = ref(0)

let querySearchMedia = ref('')

onMounted(async () => {
    await fetchSentences();
    window.addEventListener('scroll', handleScroll);
    window.HSStaticMethods.autoInit();
});

onBeforeUnmount(() => {
    window.removeEventListener('scroll', handleScroll);
});

// Fetch sentences with an infinite cursor
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
            search_data.value = response;
        } else {
            search_data.value.sentences.push(...response.sentences);
        }

        cursor.value = response.cursor;
        statistics.value = response.statistics;

        const default_row_statistics = {
            anime_id: 0,
            name_anime_en: t('searchpage.main.labels.all'),
            amount_sentences_found: statistics.value.reduce((a, b) => a + parseInt(b.amount_sentences_found), 0)
        }

        statistics.value = [default_row_statistics].concat(statistics.value)

    } catch (error) {
        console.error('Error fetching sentences:', error);
    } finally {
        isLoading.value = false;
    }
};


// Logic for infinite cursor
const handleScroll = () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight && !isLoading.value) {
        fetchSentences();
    }
};

// Order segment according to website language
const orderedSegments = computed(() => {
    const segments = [
        {
            content: 'content_es',
            highlight: 'content_es_highlight',
            mt: 'content_es_mt'
        },
        {
            content: 'content_en',
            highlight: 'content_en_highlight',
            mt: 'content_en_mt'
        }
    ];

    if (locale.value === 'en') {
        return [segments[1], segments[0]];
    }
    return segments;
});


const filteredAnimes = computed(() => {
    const filteredItems = statistics.value.filter((item) => {
        const categoryFilter = categorySelected.value == 0 || item.category === categorySelected.value;
        const nameFilterEnglish = item.name_anime_en.toLowerCase().includes(querySearchMedia.value.toLowerCase());
        const nameFilterJapanese = item?.name_anime_jp?.toLowerCase().includes(querySearchMedia.value.toLowerCase());
        const nameFilterRomaji = item?.name_anime_romaji?.toLowerCase().includes(querySearchMedia.value.toLowerCase());

        return (categoryFilter && (nameFilterEnglish || nameFilterJapanese || nameFilterRomaji));
    })

    if (categorySelected.value) {
        filteredItems.unshift({
            anime_id: 0,
            name_anime_en: t('searchpage.main.labels.all'),
            amount_sentences_found: filteredItems.reduce((a, b) => a + parseInt(b.amount_sentences_found), 0)
        });
    }

    if (filteredItems.length === 0) {
        return [{ name_anime_en: t('searchpage.main.labels.noresults') }]
    }

    const sortedItems = filteredItems.sort((a, b) => {
        const nameA = a.name_anime_en.toLowerCase()
        const nameB = b.name_anime_en.toLowerCase()

        // If "Todo" is present, it should always appear at the top (index -1)
        if (nameA === t('searchpage.main.labels.all').toLowerCase()) return -1
        if (nameB === t('searchpage.main.labels.all').toLowerCase()) return 1

        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return 0
    })

    return sortedItems
})
</script>
<template>

    <div class="grid grid-cols-5">
        <div class="col-span-4">
            <!-- Tabs -->
            <div class="pb-4" v-if="search_data?.categoryStatistics.length > 0">
                <div id="tabs-container" class="mt-2">
                    <div id="tab-headers">
                        <ul class="tab-titles">
                            <li @click="categoryFilter(0)" :class="{ active: categorySelected === 0 }"
                                v-if="search_data.categoryStatistics.some(item => item.category === 1 && item.count > 0)">
                                Todo
                                <span
                                    class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-white/20 dark:text-gray-300">
                                    <span
                                        v-if="search_data.categoryStatistics.reduce((total, item) => total + item.count, 0)">{{
                search_data.categoryStatistics.reduce((total, item) => total + item.count, 0)
            }}</span>
                                </span>
                            </li>
                            <li @click="categoryFilter(1)" :class="{ active: categorySelected === 1 }"
                                v-if="search_data.categoryStatistics.some(item => item.category === 1 && item.count > 0)">
                                Anime
                                <span
                                    class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-white/20 dark:text-gray-300">
                                    <span
                                        v-if="search_data.categoryStatistics.find(item => item.category === 1).count">{{
                search_data.categoryStatistics.find(item => item.category === 1).count }}</span>
                                </span>
                            </li>
                            <li @click="categoryFilter(3)" :class="{ active: categorySelected === 3 }"
                                v-if="search_data.categoryStatistics.some(item => item.category === 3 && item.count > 0)">
                                Liveaction
                                <span
                                    class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-white/20 dark:text-gray-300">
                                    <span
                                        v-if="search_data.categoryStatistics.find(item => item.category === 3).count">{{
                search_data.categoryStatistics.find(item => item.category === 3).count }}</span>
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            <!-- End Tabs -->

            <!-- Segment -->
            <div v-if="search_data?.sentences?.length > 0">
                <div v-for="(sentence, index) in search_data.sentences" class="flex flex-col lg:flex-row py-2">

                    <!-- Image -->
                    <div class="h-auto shrink-0 w-auto lg:w-[28em]">
                        <img :src="sentence.media_info.path_image + '?width=960&height=540'"
                            class="inset-0 h-full w-full object-cover filter hover:brightness-75 cursor-pointer object-center"
                            :key="sentence.media_info.path_image" />
                    </div>
                    <!-- End Image -->

                    <!-- Details -->
                    <div
                        class="w-full py-6 sm:py-2 px-6 bg-card-background dark:border-white/5 border rounded-e-lg text-white flex flex-col justify-between">
                        <div>
                            <!-- First Row -->
                            <div class="inline-flex items-center py-2 align-middle justify-center">
                                <!-- Audio button -->
                                <button
                                    class="py-2 px-2 mr-0.5 inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg border border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-white/10 dark:hover:bg-white/30 dark:text-neutral-400 dark:hover:text-neutral-300">

                                    <UiBaseIcon w="w-10 md:w-5" h="h-10 md:h-5" size="24" class="" :path="mdiPlay" />
                                </button>

                                <!-- Japanese Sentence -->
                                <div class="flex flex-1 relative items-start justify-start my-auto">
                                    <h3
                                        class=" ml-2 items-start text-xl xxl:text-2xl xxl:font-normal xxm:text-3xl leading-tight">
                                        <span v-html="sentence.segment_info.content_jp_highlight
                ? sentence.segment_info.content_jp_highlight
                : sentence.segment_info.content_jp
                "></span>
                                    </h3>
                                </div>
                                <!-- End Japanese Sentence -->
                            </div>


                            <!-- Second Row -->
                            <div class="items-start flex-1  justify-center">
                                <!-- Tag Translation -->
                                <span
                                    class="inline-flex items-center gap-x-1 py-1 px-3 rounded-lg text-xs font-medium bg-red-100 text-neutral-600 dark:bg-neutral-700/40 dark:text-neutral-400">{{
                $t('searchpage.main.labels.translation') }}</span>

                                <!-- Tag NSFW -->
                                <span v-if="sentence.segment_info.is_nsfw"
                                    class="bg-gray-100 mb-1 text-gray-800 text-xs xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/30 dark:text-gray-400 border border-gray-700">
                                    NSFW
                                </span>

                                <div class="font-normal  flex-1 text-sm xxl:text-base xxm:text-2xl leading-tight mt-3">

                                </div>
                            </div>

                            <!-- Third Row -->
                            <div class="items-start pb-2 flex-1 justify-center">
                                <!-- Spanish and English Sentences -->
                                <ul class="ml-5 xxm:ml-8 list-disc text-gray-400">
                                    <li class="my-2 text-sm xxl:text-base xxm:text-2xl"
                                        v-for="segment in orderedSegments" :key="segment.content">
                                        <span v-html="sentence.segment_info[segment.highlight]
                ? sentence.segment_info[segment.highlight]
                : sentence.segment_info[segment.content]
                "></span>
                                        <div v-if="sentence.segment_info[segment.mt]" class="hs-tooltip inline-block">
                                            <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate"
                                                fill="#DDDF" w="w-4" h="h-4" size="19" class="ml-2 hs-tooltip-toggle" />
                                            <span
                                                class="hs-tooltip-content hs-tooltip-shown:opacity-90 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-[#181818] shadow-sm rounded-md text-white"
                                                role="tooltip">
                                                {{ $t('searchpage.main.labels.mtTooltip') }}
                                            </span>
                                        </div>
                                    </li>
                                </ul>
                                <!-- End Spanish and English Sentences -->
                            </div>

                            <!-- Four Row -->
                            <!-- Buttons  -->
                            <div class="flex-1 pb-2">
                                <SearchSegmentActionsContainer />
                                
                            </div>
                            <!-- End Buttons  -->

                            <!-- Five Row -->
                            <!-- Media details  -->
                            <div class="flex-1 pb-2 justify-left">
                                <p
                                    class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold mt-2">
                                    {{ sentence.basic_info.name_anime_en }} &bull;
                                    <template v-if="sentence.basic_info.season === 0"> {{
                t('searchpage.main.labels.movie')
            }}
                                    </template>
                                    <template v-else>
                                        {{ $t('searchpage.main.labels.season') }} {{ sentence.basic_info.season }},
                                        {{ $t('searchpage.main.labels.episode') }} {{ sentence.basic_info.episode }}
                                    </template>
                                </p>
                            </div>
                        </div>

                    </div>
                    <!-- End Details -->
                </div>
            </div>
            <!-- End Segment-->
            
        </div>
        <div class="pl-4 pt-6">
            <div class="relative">
                <ul
                    class="z-20 divide-y divide-white/5 dark:border-white/5 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900  rounded-lg dark:bg-card-background border dark:text-white">
                    <div
                        class="flex items-center w-full px-4 py-2 text-center justify-center rounded-t-lg rounded-l-lg">
                        <span class="font-medium text-base">{{ $t('searchpage.main.labels.contentList') }}</span>
                    </div>
                    <div class="flex flex-inline ">
                        <input type="search" v-model="querySearchMedia" id="default-search2" autocomplete="off"
                            class="block w-full  p-4 pl-4 text-sm xxl:text-base xxm:text-2xl text-gray-900  dark:bg-card-background dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
                            placeholder="Search here" required />
                        <div class="absolute z-10 right-0 mr-2 mt-4 inline-flex items-center pr-3 pointer-events-none">
                            <svg aria-hidden="true" class="w-5 h-5 text-white/60 dark:text-gray-400" fill="none"
                                stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                            </svg>
                        </div>
                    </div>
                    <div class="overflow-auto snap-y max-h-[50vh]">
                        <li class="snap-start" v-for="item in filteredAnimes" :key="item.anime_id">
                            <button @click="filterAnime(item.anime_id, item.name_anime_en)"
                                :class="{ 'bg-sgrayhover': item.anime_id == anime_id }"
                                class="flex border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-sm xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                                <span :class="{ '': item.anime_id == anime_id }">{{ item.name_anime_en }}</span>
                                <span
                                    v-if="item.name_anime_en.toLowerCase() !== t('searchpage.main.labels.noresults').toLowerCase()"
                                    class="bg-gray-500 text-white rounded-full px-2 py-1 text-xs">
                                    {{ item.amount_sentences_found }}
                                </span>
                            </button>
                        </li>
                    </div>

                    <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600">
                    </div>
                </ul>
            </div>
        </div>

    </div>



</template>

<style>
#tab-headers ul {
    margin: 0;
    padding: 0;
    display: flex;
    border-bottom: 3px solid #dddddd21;
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