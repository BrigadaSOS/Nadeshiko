<script setup>
const apiSearch = useApiSearch();
const media = ref(null);

const fetchMedia = async () => {
    try {
        media.value = await apiSearch.getRecentMedia();
    } catch (error) {
        console.error('Error fetching media:', error);
    }
};

onMounted(() => {
    fetchMedia();
});
</script>

<template>
    <NuxtLayout>
        <section class="lg:w-11/12 mx-auto">
            <div class="tab-content mt-6">
                <div class="inline-flex justify-between items-center w-full">
                    <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">
                        {{ $t('animeList.fullListTitle') }}
                    </h1>
                </div>

                <div v-if="media?.results.length > 0" v-for="(media_info, index) in media?.results" :key="media_info.id" class="w-full relative my-6">
                    <div class="relative flex flex-col z-20 items-center sm:items-start sm:flex-row rounded-lg dark:bg-card-background transition-all dark:border-white/10 border">
                        <div class="absolute inset-0">
                            <img :src="media_info.banner" class="object-cover w-full h-full rounded-lg" />
                            <div class="absolute inset-0 bg-card-background opacity-90 rounded-lg"></div>
                        </div>                        
                        <div class="relative flex-none w-[16em] h-[21em]">
                            <img :src="media_info.cover" class="absolute inset-0 object-cover w-full h-full rounded-lg" />
                        </div>

                        <div class="relative flex-auto p-6 z-10">
                            <div class="flex flex-wrap">
                                <h1 class="flex-auto text-xl font-semibold dark:text-gray-50">
                                    {{ media_info.english_name }}
                                </h1>
                                <div class="text-lg font-semibold bg-graypalid px-3 rounded-lg dark:bg-graypalid dark:border-sgray2 text-white">
                                    Anime
                                </div>
                                <div class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300">
                                    {{ media_info.japanese_name }} - {{ media_info.romaji_name }}
                                </div>
                            </div>

                            <div class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"></div>

                            <div class="grid grid-cols-2 mt-2">
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">
                                    Cantidad de Oraciones: {{ media_info.num_segments }}
                                </p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Cantidad de Palabras:</p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Palabras Únicas:</p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Kanjis Únicos:</p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">
                                    Palabras Únicas (usadas una vez):
                                </p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Índice de Diversidad Léxica:</p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Puntaje Anilist:</p>
                                <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Dificultad:</p>
                            </div>

                            <div class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"></div>

                            <div class="flex mt-2 items-center flex-wrap">
                                <div class="flex h-8 flex-row grow-0 bg-white border mr-2 shadow-sm rounded-xl dark:bg-graypalid dark:border-sgray2">
                                    <div class="px-2 py-2 text-center">
                                        <div class="flex items-center gap-x-2">
                                            <p class="text-xs uppercase tracking-wide text-white">Temporadas:</p>
                                            <p class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ media_info.num_seasons }}</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="flex h-8 flex-row bg-white border shadow-sm rounded-xl dark:bg-graypalid dark:border-sgray2">
                                    <div class="px-2 py-2 text-center">
                                        <div class="flex items-center gap-x-2">
                                            <p class="text-xs uppercase tracking-wide text-white">Episodios:</p>
                                            <p class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ media_info.num_episodes }}</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="ml-auto mt-4 md:mt-1 flex">
                                    <a :href="'https://anilist.co/anime/' + media_info.media_id" type="button" data-hs-overlay="#hs-vertically-centered-scrollable-batch1" class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-white dark:placeholder-gray-400 dark:text-white">
                                        <div>Anilist</div>
                                    </a>

                                    <button type="button" data-hs-overlay="#hs-vertically-centered-scrollable-batch1" class="py-3.5 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-blue-500/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-blue-400 dark:placeholder-gray-400 dark:text-blue-400">
                                        <div>Vocabulario</div>
                                        <BaseIcon :path="mdiArrowRight" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex flex-1 mb-10">
                    <button v-if="showPrevPageButton" @click="prevPage" class="mr-auto border-b-2 border-sred p-2">
                        Página Anterior
                    </button>
                    <button v-if="showNextPageButton" @click="nextPage" class="ml-auto border-b-2 border-sred p-2">
                        Página Siguiente
                    </button>
                </div>
            </div>
        </section>
    </NuxtLayout>
</template>
