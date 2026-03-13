<script setup>
import { mdiTextSearch } from '@mdi/js';

const props = defineProps({
  compact: {
    type: Boolean,
    default: false,
  },
});

const route = useRoute();
const router = useRouter();
const query = ref('');
const forceSearchCounter = useState('force-search-counter', () => 0);

const headers = useRequestHeaders(['user-agent']);
const isMobile = computed(() => {
  const ua = process.client ? navigator.userAgent : headers['user-agent'] || '';
  return /Android|webOS|iPhone|iPad|Opera Mini/i.test(ua);
});

const navigateSearchSentence = async () => {
  const { query: _query, hideLangs: _, blurLangs: __, ...restOfQuery } = route.query;
  const term = query.value?.trim();
  const remaining = Object.keys(restOfQuery).length > 0 ? restOfQuery : undefined;

  const target = {
    path: term ? `/search/${encodeURIComponent(term)}` : '/search',
    query: remaining,
  };

  // If already at the target URL, skip navigation and signal SearchContainer to re-fetch.
  if (router.resolve(target).fullPath === route.fullPath) {
    forceSearchCounter.value++;
    return;
  }

  await navigateTo(target);
};

const handleKeyDown = (event) => {
  if (event.shiftKey && event.key === 'S') {
    const inputElem = document.getElementById('sentence-search-input');
    const rect = inputElem.getBoundingClientRect();

    // The element is no longer visible
    if (rect.bottom <= 0) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      inputElem.focus();
    }
  }
};

const syncQueryFromRoute = () => {
  query.value = route.params.query ? decodeURIComponent(String(route.params.query)) : String(route.query.query || '');
};

syncQueryFromRoute();

watch(() => [route.params.query, route.query.query], syncQueryFromRoute);

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>
<template>
  <SearchModalBatch />

  <!-- Form -->
  <div @submit.prevent="navigateSearchSentence">
    <div
      class="relative flex space-x-3 rounded-lg shadow-gray-100 dark:border-neutral-500"
      :class="props.compact ? 'mt-1 py-1' : 'mt-2 py-2'"
    >
      <div class="relative flex-[1_0_0%]">
        <label for="sentence-search-input" class="block text-sm text-gray-700 font-medium dark:text-white"><span
            class="sr-only">Search anything!</span></label>
        <input id="sentence-search-input" :autofocus="!isMobile" v-model="query" @keydown.enter="navigateSearchSentence"
          class="dark:focus:ring-gray-500 border py-3 dark:focus:border-gray-500 h-full pl-4 pr-4 md:pr-32 block w-full border-transparent rounded-lg focus:outline-none dark:bg-input-background dark:border-neutral-600 dark:text-white/80 dark:placeholder-neutral-500"
          placeholder="Search anything!" />
        <div class="absolute inset-y-0 end-3 flex items-center pointer-events-none">
          <span
            class="hidden md:inline-flex items-center whitespace-nowrap py-3 text-center gap-x-1 text-base text-gray-400 dark:text-white">
            <kbd
              class="min-h-[30px] min-w-[30px] inline-flex justify-center items-center py-1 px-1.5 bg-white border border-gray-200 font-mono text-sm text-gray-800 rounded-md dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200">
              <svg class="flex-shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round">
                <path d="M9 18v-6H5l7-7 7 7h-4v6H9z"></path>
              </svg>
            </kbd>
            +
            <kbd
              class="min-h-[30px] min-w-[30px] inline-flex justify-center items-center py-1 px-1.5 bg-white border border-gray-200 font-mono text-sm text-gray-800 rounded-md dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200">
              S
            </kbd>
          </span>
          <!-- End KBD -->
        </div>

      </div>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="col-span-1 py-4 px-4 dark:border-neutral-700 border inline-flex justify-center items-center text-sm font-semibold rounded-lg bg-button-primary-main text-white hover:bg-button-primary-hover disabled:opacity-50 disabled:pointer-events-none"
          @click="navigateSearchSentence">
          <svg class="flex-shrink-0 size-5" xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>

        <button
          class="col-span-1 py-4 px-4 dark:border-neutral-700 border inline-flex justify-center items-center text-sm font-semibold rounded-lg bg-button-primary-main text-white hover:bg-button-primary-hover disabled:opacity-50 disabled:pointer-events-none"
          data-nd-overlay="#nd-vertically-centered-scrollable-batch">
          <UiBaseIcon :path="mdiTextSearch" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
        </button>
      </div>
    </div>
  </div>
  <!-- End Form -->
</template>
