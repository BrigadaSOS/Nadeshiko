<script setup>
import { mdiTranslate, mdiVolumeHigh } from '@mdi/js'
const props = defineProps(['searchData']);
let locale = ref('en');

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


</script>
<template>
    <div v-if="searchData?.sentences?.length > 0">
        <div v-for="(sentence, index) in searchData.sentences"
            class="dark:hover:bg-neutral-800/20 items-center b-2 transition-all rounded-lg flex flex-col lg:flex-row py-2">
            <!-- Image -->
            <div class="h-auto shrink-0 w-auto lg:w-[28em]">
                <img :src="sentence.media_info.path_image + '?width=960&height=540'"
                    class="inset-0 h-70 w-full object-cover filter hover:brightness-75 cursor-pointer object-center"
                    :key="sentence.media_info.path_image" />
            </div>
            <!-- End Image -->

            <!-- Details -->
            <div class="w-full py-6 sm:py-2 px-6 rounded-e-lg text-white flex flex-col justify-between">
                <div>
                    <!-- First Row -->
                    <div class="inline-flex items-center py-2 align-middle justify-center">
                        <!-- Audio button -->
                        <button @click="playAudio(sentence.media_info.path_audio)"
                            class="py-2 px-2 mr-0.5 inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg border border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-white/10 dark:hover:bg-white/30 dark:text-neutral-400 dark:hover:text-neutral-300">
                            <UiBaseIcon w="w-10 md:w-5" h="h-10 md:h-5" size="24" class="" :path="mdiVolumeHigh" />
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
                            <li class="my-2 text-sm xxl:text-base xxm:text-2xl" v-for="segment in orderedSegments"
                                :key="segment.content">
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
                        <SearchSegmentActionsContainer :content="sentence" />
                    </div>
                    <!-- End Buttons  -->

                    <!-- Five Row -->
                    <!-- Media details  -->
                    <div class="flex-1 pb-2 justify-left">
                        <p class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold mt-2">
                            {{ sentence.basic_info.name_anime_en }} &bull;
                            <template v-if="sentence.basic_info.season === 0"> {{
        $t('searchpage.main.labels.movie')
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
</template>
