<script setup>
import { mdiSync, mdiDownload, mdiHistory, mdiCardMultiple, mdiRefresh } from '@mdi/js'

useSeoMeta({
    title: 'Nadeshiko',
    ogTitle: 'Nadeshiko',
    ogDescription: 'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more!'
})

// Firefox Mobile scroll-to-bottom fix
// Disable scroll restoration and force scroll to top on page load
useHead({
    script: [
        {
            innerHTML: `
                if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'manual';
                }
                window.addEventListener('load', function() {
                    window.scrollTo(0, 0);
                });
            `,
            tagPosition: 'head'
        }
    ]
})

const apiSearch = useApiSearch();
const {
    data: media,
    pending: isLoading,
    error: mediaError,
    refresh: fetchMedia
} = await useAsyncData(
    'recentMedia',
    () => apiSearch.getRecentMedia({ size: 10 }),
    {
        default: () => null
    },

);

</script>

<template>
    <NuxtLayout>
        <div class="mx-auto">
            <div class="relative text-white">
                <div class="py-2">
                    <div class="max-w-[92%] mx-auto">
                        <SearchBaseInputSegment />
                        <div class="py-2 xl:py-4">
                            <div class="flex dark:text-white/80 gap-10 flex-col xl:flex-row justify-between">
                                <div class="flex-1 md:min-w-[30rem]">
                                    <div class="flex rounded-lg flex-col first-letter:items-left">
                                        <div class="inline-flex">
                                            <h2
                                                class="text-3xl ml-2 mt-3 md:mt-0 underline underline-offset-8 decoration-4 decoration-header-background sm:mt-0 font-bold md:text-4xl md:leading-tight dark:text-white">
                                                Nadeshiko
                                            </h2>
                                            <h3
                                                class="inline-flex ml-2 rounded-full items-end text-base font-medium text-white/80">
                                                v1.2.0
                                            </h3>
                                        </div>

                                        <p class="ml-2 pt-5 text-base">{{ $t('home.nadeDbDescription') }}</p>
                                        <ul class="list-disc ml-8 py-4 text-sm font-normal">
                                            <li class="mb-4">
                                                {{ $t('home.nadeDbDescriptionJpSearch') }}:
                                                <NuxtLink class="underline text-blue-400/95 underline-offset-4"
                                                    to="search/sentence?query=彼女">彼女</NuxtLink>
                                            </li>
                                            <li class="mb-4">
                                                {{ $t('home.nadeDbDescriptionOtherSearch') }}:
                                                <NuxtLink class="underline text-blue-400/95 underline-offset-4"
                                                    to="search/sentence?query=school">School</NuxtLink>,
                                                <NuxtLink class="underline text-blue-400/95 underline-offset-4"
                                                    to="search/sentence?query=escuela">Escuela</NuxtLink>
                                            </li>
                                            <li class="mb-4">
                                                {{ $t('home.nadeDbDescriptionExclusiveSearch') }}:
                                                <NuxtLink class="underline text-blue-400/95 underline-offset-4"
                                                    to="search/sentence?query=卒業 -みんな">卒業 -みんな</NuxtLink>
                                            </li>
                                            <li class="">
                                                {{ $t('home.nadeDbDescriptionExactSearch') }}:
                                                <NuxtLink to='search/sentence?query="食べられない"'
                                                    class="underline text-blue-400/90 underline-offset-4">"食べられない"
                                                </NuxtLink>
                                            </li>
                                        </ul>
                                    </div>

                                    <div class="border-b pt-2 border-white/10" />

                                    <div class="my-4 flex text-sm font-medium">
                                        <div class="mr-4">
                                            <UiBaseIcon :path="mdiSync" w="w-12 md:w-12" h="h-12 md:h-12" size="30"
                                                class="rotate-90" />
                                        </div>
                                        <div class="">
                                            <p class="mb-2">{{ $t('home.keyFeatures.feature1.title') }}</p>
                                            <span class="font-normal dark:text-white/60">{{
                                                $t('home.keyFeatures.feature1.description') }}</span>
                                        </div>
                                    </div>

                                    <div class="mb-5 flex text-sm font-medium">
                                        <div class="mr-4">
                                            <UiBaseIcon :path="mdiDownload" w="w-12 md:w-12" h="h-12 md:h-12" size="30"
                                                class="" />
                                        </div>
                                        <div class="">
                                            <p class="mb-2">{{ $t('home.keyFeatures.feature2.title') }}</p>
                                            <span class="font-normal dark:text-white/60">{{
                                                $t('home.keyFeatures.feature2.description') }}</span>
                                        </div>
                                    </div>

                                    <div class="mb-5 flex text-sm font-medium">
                                        <div class="mr-4">
                                            <UiBaseIcon :path="mdiHistory" w="w-12 md:w-12" h="h-12 md:h-12" size="30"
                                                class="" />
                                        </div>
                                        <div class="">
                                            <p class="mb-2">{{ $t('home.keyFeatures.feature3.title') }}</p>
                                            <span class="font-normal dark:text-white/60">{{
                                                $t('home.keyFeatures.feature3.description') }}</span>
                                        </div>
                                    </div>

                                    <div class="mb-5 flex text-sm font-medium">
                                        <div class="mr-4">
                                            <UiBaseIcon :path="mdiCardMultiple" w="w-12 md:w-12" h="h-12 md:h-12"
                                                size="30" class="" />
                                        </div>
                                        <div class="">
                                            <p class="mb-2">{{ $t('home.keyFeatures.feature4.title') }}</p>
                                            <span class="font-normal dark:text-white/60">{{
                                                $t('home.keyFeatures.feature4.description') }}</span>
                                        </div>
                                    </div>

                                    <div class="mb-5 border-b border-white/10" />

                                    <div class="flex gap-4 text-center">
                                        <div class="md:w-2/4 sm:w-1/2 w-full">
                                            <div class="dark:bg-card-background px-4 py-4 rounded-lg">
                                                <h2 class="title-font font-medium text-2xl text-white">
                                                    +{{ Math.ceil(media?.stats?.full_total_segments / 100) * 100 || 0 }}
                                                </h2>
                                                <p class="leading-relaxed text-sm">
                                                    {{ $t('home.stats.sentenceCount') }}
                                                </p>
                                            </div>
                                        </div>
                                        <div class="md:w-2/4 sm:w-1/2 w-full">
                                            <div class="dark:bg-card-background px-4 py-4 rounded-lg">
                                                <h2 class="title-font font-medium text-2xl text-white">{{
                                                    media?.stats?.full_total_animes || 0 }}</h2>
                                                <p class="leading-relaxed text-sm">
                                                    {{ $t('home.stats.mediaCount') }}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="mt-5 border-b border-white/10" />
                                </div>

                                <div class="flex-grow xl:max-w-[60rem]">
                                    <section class="w-full rounded-lg">
                                        <div class="tab-content md:mx-2 flex-grow w-full">
                                            <div class="inline-flex justify-between items-center w-full mb-4">
                                                <h1
                                                    class="text-2xl font-bold md:text-2xl md:leading-tight dark:text-white">
                                                    {{ $t('animeList.recentlyAddedTitle') }}
                                                </h1>
                                                <NuxtLink to="/search/media">
                                                    <button type="button"
                                                        class="py-3 px-4 inline-flex justify-center rounded-lg items-center gap-4 transition-all font-medium dark:hover:bg-button-primary-hover align-middle text-sm ">
                                                        {{ $t('animeList.seeAll') }}
                                                        <svg class="w-2.5 h-auto" width="17" height="16"
                                                            viewBox="0 0 17 16" fill="none"
                                                            xmlns="http://www.w3.org/2000/svg">
                                                            <path fill-rule="evenodd" clip-rule="evenodd"
                                                                d="M1 7C0.447715 7 -3.73832e-07 7.44771 -3.49691e-07 8C-3.2555e-07 8.55228 0.447715 9 1 9L13.0858 9L7.79289 14.2929C7.40237 14.6834 7.40237 15.3166 7.79289 15.7071C8.18342 16.0976 8.81658 16.0976 9.20711 15.7071L16.0303 8.88388C16.5185 8.39573 16.5185 7.60427 16.0303 7.11612L9.20711 0.292893C8.81658 -0.0976318 8.18342 -0.0976318 7.79289 0.292893C7.40237 0.683417 7.40237 1.31658 7.79289 1.70711L13.0858 7L1 7Z"
                                                                fill="currentColor" />
                                                        </svg>
                                                    </button>
                                                </NuxtLink>
                                            </div>

                                            <div class="relative">
                                                <div
                                                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6 gap-y-3">
                                                    <NuxtLink v-if="media?.results.length > 0"
                                                        v-for="(media_info, index) in media.results"
                                                        :key="media_info.id"
                                                        :to="`/search/sentence?media=${media_info.id}`"
                                                        class="w-full relative">
                                                        <div class="w-full">
                                                            <div
                                                                class="border-none pb-[145%] rounded-lg overflow-hidden relative bg-[rgba(255,255,255,0.06)] block">
                                                                <img class="w-full h-full object-cover absolute top-0 left-0"
                                                                    :src="media_info.cover + '?width=460&height=652'" />
                                                            </div>
                                                            <!--
                                                            <template>
                                                                <div
                                                                    class="w-full backdrop-blur-sm bg-sgray2/90 flex flex-col max-w-[400px]">
                                                                    <span
                                                                        class="mx-auto object-center mt-2 text-center px-2 text-base font-bold text-gray-800 dark:text-white">{{
                                                                            media_info.english_name }}</span>
                                                                    <div
                                                                        class="py-3 px-4 text-sm text-gray-600 dark:text-gray-400 min-w-[400px]">
                                                                        <div
                                                                            class="pb-[20%] overflow-hidden relative bg-[rgba(255,255,255,0.06)] block">
                                                                            <img class="object-cover absolute top-0 left-0"
                                                                                :src="media_info.banner" />
                                                                        </div>
                                                                        <div class="mt-3 break-words">
                                                                            <p>
                                                                                <span
                                                                                    class="font-bold pt-3 first:pt-0 dark:text-white">{{
                                                                                        $t('animeList.romajiName')
                                                                                    }}:</span>
                                                                                {{ media_info.romaji_name }}
                                                                            </p>
                                                                            <p>
                                                                                <span
                                                                                    class="font-bold pt-3 first:pt-0 dark:text-white">{{
                                                                                        $t('animeList.japaneseName')
                                                                                    }}:</span>
                                                                                {{ media_info.japanese_name }}
                                                                            </p>
                                                                            <p>
                                                                                <span
                                                                                    class="font-bold pt-3 first:pt-0 dark:text-white">{{
                                                                                        $t('animeList.seasons') }}:</span>
                                                                                {{ media_info.num_seasons }}
                                                                            </p>
                                                                            <p>
                                                                                <span
                                                                                    class="font-bold pt-3 first:pt-0 dark:text-white">{{
                                                                                        $t('animeList.episodes') }}:
                                                                                </span>
                                                                                {{ media_info.num_episodes }}
                                                                            </p>
                                                                            <p>
                                                                                <span
                                                                                    class="font-bold pt-3 first:pt-0 dark:text-white break-words">{{
                                                                                        $t('animeList.genres') }}:
                                                                                </span>
                                                                                {{ media_info?.genres?.toString() }}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </template>
                                                            -->
                                                        </div>

                                                        <div
                                                            class="mt-2 text-center justify-center flex flex-col items-center">
                                                            <h3 class="text-sm text-center font-semibold line-clamp-2">
                                                                {{
                                            media_info.english_name }}</h3>
                                                        </div>
                                                        <div
                                                            class="text-center mt-1 mb-5 justify-center flex flex-col items-center">
                                                            <h3 class="text-sm text-center font-medium line-clamp-2">
                                                                {{ media_info.num_segments }} {{
                                                                    $t('animeList.sentenceCount') }}
                                                            </h3>
                                                        </div>
                                                    </NuxtLink>
                                                    <div v-else role="status" v-for="i in 10"
                                                        class="animate-pulse relative">
                                                        <div
                                                            class="w-full pb-[145%] rounded-lg items-center overflow-hidden relative bg-[rgba(255,255,255,0.06)] block">
                                                        </div>
                                                        <div
                                                            class="mt-2 text-center justify-center flex flex-col items-center">
                                                            <div
                                                                class="h-2.5 bg-gray-200 rounded-full dark:bg-[rgba(255,255,255,0.06)] w-36 mt-2 mb-4">
                                                            </div>
                                                        </div>
                                                        <div
                                                            class="text-center mt-1 mb-4 justify-center flex flex-col items-center">
                                                            <div
                                                                class="h-2.5 bg-gray-200 rounded-full dark:bg-[rgba(255,255,255,0.06)] w-28 mb-4">
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div v-if="mediaError"
                                                    class="absolute px-6 py-2 rounded-lg shadow-lg inset-0 flex items-center justify-center">
                                                    <div class=" rounded-lg">
                                                        <div role="alert"
                                                            class="rounded-lg flex items-center flex-col border-red-500 bg-red-50 p-4 dark:border-red-600 dark:bg-red-900/80">
                                                            <div
                                                                class="flex items-center gap-2 mb-2 text-red-800 dark:text-red-100">
                                                                <strong class="block font-medium">{{ $t('searchContainer.errorMessage1') }}</strong>
                                                            </div>
                                                            <UiButtonPrimaryAction @click="fetchMedia">
                                                                <template v-if="isLoading">
                                                                    {{ $t('searchContainer.retrying') }}
                                                                    <div role="status">
                                                                        <svg aria-hidden="true"
                                                                            class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                                                                            viewBox="0 0 100 101" fill="none"
                                                                            xmlns="http://www.w3.org/2000/svg">
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
                                                                        <UiBaseIcon :path="mdiRefresh"
                                                                            @click="fetchMedia" />
                                                                    {{ $t('searchContainer.retryButton') }}
                                                                </template>
                                                            </UiButtonPrimaryAction>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="pb-8">
                    <div class="rounded-lg mx-auto max-w-[92%] p-6 dark:text-white/80 dark:bg-card-background relative">
                        <section class="py-2">
                            <div class="flex mb-2 flex-col md:flex-row justify-top">
                                <div class="md:flex-1">
                                    <h2 class="text-xl font-bold md:text-xl mb-3 md:leading-tight dark:text-white">{{
                                        $t('home.support.title') }}
                                    </h2>
                                    <p class="text-sm max-w-2xl text-gray-800 dark:text-gray-200">
                                        {{ $t('home.support.description') }}
                                    </p>
                                </div>
                                <div class="md:flex-1 mx-2 flex items-center justify-end space-x-4">
                                    <div class="mt-5 w-auto bg-white p-1 rounded-md">
                                        <a href="https://github.com/BrigadaSOS">
                                            <img class="h-10 object-contain" src="/github.png" alt="GitHub" height="48" loading="lazy" />
                                        </a>
                                    </div>
                                    <div class="mt-5 w-auto">
                                        <a href="https://patreon.com/BrigadaSOS">
                                            <img class="h-12 object-contain rounded-md" src="/patreon.png"
                                                alt="Become a Patron" height="48" loading="lazy" />
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    </NuxtLayout>
</template>
