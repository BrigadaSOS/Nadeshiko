<script setup>
import {
  mdiAccountCircleOutline,
  mdiMagnify,
  mdiMovieOpenOutline,
  mdiNewspaperVariantOutline,
  mdiInformationOutline,
  mdiChartBar,
  mdiApi,
  mdiCogOutline,
  mdiSync,
  mdiFormatListBulletedSquare,
  mdiHistory,
  mdiLogin,
  mdiLogout,
} from '@mdi/js';

const store = userStore();
const isAuth = computed(() => store.isLoggedIn);
const { hasNewPost } = useBlogNotification();
const route = useRoute();
const isOnBlog = computed(() => route.path.startsWith('/blog'));

function openLoginModal() {
  window.NDOverlay?.close('#nd-nav-sidebar');
  window.NDOverlay?.open('#nd-vertically-centered-scrollable-loginsignup-modal');
}

async function logout() {
  window.NDOverlay?.close('#nd-nav-sidebar');
  await store.logout();
}

const sidebarSearch = ref('');
async function submitSidebarSearch() {
  const term = sidebarSearch.value?.trim();
  if (!term) return;
  window.NDOverlay?.close('#nd-nav-sidebar');
  await navigateTo(`/search/${encodeURIComponent(term)}`);
}
</script>
<template>
    <header
        class="relative flex flex-wrap md:justify-start md:flex-nowrap w-full bg-white py-3 lg:py-2 dark:bg-header-background yomitan-ignore">
        <nav class="px-4 md:px-0 md:max-w-[90%] w-full mx-auto md:flex md:items-center md:justify-between text-xs">
            <div class="flex items-center justify-between">
                <div class="flex mr-7">
                    <NuxtLink to="/"
                        class="text-lg inline-flex items-center text-center align-middle font-semibold text-white">
                        <img src="/logo-38d6e06a.webp" class="h-8 mr-3 rounded-semi" alt="Nadeshiko Logo" />
                        Nadeshiko
                    </NuxtLink>
                </div>

                <div class="md:hidden">
                    <button type="button"
                        class="relative size-9 flex justify-center items-center rounded-lg bg-white/10 text-white hover:bg-white/20 focus:outline-none focus:bg-white/20"
                        data-testid="hamburger-menu"
                        aria-haspopup="dialog" aria-expanded="false" aria-controls="nd-nav-sidebar"
                        aria-label="Toggle navigation" data-nd-overlay="#nd-nav-sidebar">
                        <svg class="shrink-0 size-5" xmlns="http://www.w3.org/2000/svg"
                            width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="4" x2="20" y1="6" y2="6" />
                            <line x1="4" x2="20" y1="12" y2="12" />
                            <line x1="4" x2="20" y1="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="hidden md:flex md:flex-1 md:items-center md:ps-5">
                <div class="gap-6 flex md:flex-row md:mr-auto">
                    <NuxtLink to="/media"
                        class="text-sm font-semibold text-white transition-all duration-200 hover:text-opacity-80">
                        {{ $t("navbar.buttons.media") }}
                    </NuxtLink>
                    <NuxtLink to="/blog"
                        class="relative text-sm font-semibold text-white transition-all duration-200 hover:text-opacity-80">
                        {{ $t("navbar.buttons.blog") }}
                        <span
                          v-if="hasNewPost && !isOnBlog"
                          class="absolute -top-0.5 -right-2 size-[5px] rounded-full bg-white"
                        />
                    </NuxtLink>
                    <NuxtLink to="/stats"
                        class="text-sm font-semibold text-white transition-all duration-200 hover:text-opacity-80">
                        {{ $t("navbar.buttons.stats") }}
                    </NuxtLink>
                    <NuxtLink to="/about"
                        class="text-sm font-semibold text-white transition-all duration-200 hover:text-opacity-80">
                        {{ $t("navbar.buttons.about") }}
                    </NuxtLink>
                    <NuxtLink to="/api/v1/docs" :prefetch="false"
                        class="text-sm font-semibold text-white transition-all duration-200 hover:text-opacity-80">
                        API
                    </NuxtLink>
                </div>
                <div class="gap-2 flex flex-row">
                    <div class="flex items-center">
                    <a href="https://discord.gg/c6yGwbXruq"
                        class="mx-2 hidden lg:flex text-gray-600 transition-colors duration-300 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400"
                        target="_blank" aria-label="Discord">
                        <svg class="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg"
                            xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 -25 260 260" version="1.1">
                            <g>
                                <path
                                    d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"
                                    fill-rule="nonzero"></path>
                            </g>
                        </svg>
                    </a>
                    <a href="https://github.com/BrigadaSOS/Nadeshiko"
                        class="hidden lg:flex mx-2 text-gray-600 transition-colors duration-300 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400"
                        target="_blank" aria-label="Github">
                        <svg class="w-5 h-5 fill-white" viewBox="0 0 24 24" fill="none"
                            xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M12.026 2C7.13295 1.99937 2.96183 5.54799 2.17842 10.3779C1.395 15.2079 4.23061 19.893 8.87302 21.439C9.37302 21.529 9.55202 21.222 9.55202 20.958C9.55202 20.721 9.54402 20.093 9.54102 19.258C6.76602 19.858 6.18002 17.92 6.18002 17.92C5.99733 17.317 5.60459 16.7993 5.07302 16.461C4.17302 15.842 5.14202 15.856 5.14202 15.856C5.78269 15.9438 6.34657 16.3235 6.66902 16.884C6.94195 17.3803 7.40177 17.747 7.94632 17.9026C8.49087 18.0583 9.07503 17.99 9.56902 17.713C9.61544 17.207 9.84055 16.7341 10.204 16.379C7.99002 16.128 5.66202 15.272 5.66202 11.449C5.64973 10.4602 6.01691 9.5043 6.68802 8.778C6.38437 7.91731 6.42013 6.97325 6.78802 6.138C6.78802 6.138 7.62502 5.869 9.53002 7.159C11.1639 6.71101 12.8882 6.71101 14.522 7.159C16.428 5.868 17.264 6.138 17.264 6.138C17.6336 6.97286 17.6694 7.91757 17.364 8.778C18.0376 9.50423 18.4045 10.4626 18.388 11.453C18.388 15.286 16.058 16.128 13.836 16.375C14.3153 16.8651 14.5612 17.5373 14.511 18.221C14.511 19.555 14.499 20.631 14.499 20.958C14.499 21.225 14.677 21.535 15.186 21.437C19.8265 19.8884 22.6591 15.203 21.874 10.3743C21.089 5.54565 16.9181 1.99888 12.026 2Z">
                            </path>
                        </svg>
                    </a>
                    </div>
                    <CommonLanguageSelector />
                    <SearchDropdownContainer data-testid="profile-dropdown" dropdownId="nd-dropdown-profile"
                        dropdownContainerClass="nd-dropdown-menu absolute top-full right-0 z-50 items-center text-center align-middle min-w-60 bg-white shadow-md p-2 mt-1 dark:bg-neutral-800 border-none rounded-lg">
                        <template #default>
                            <SearchDropdownMainButton
                                dropdownButtonClass="nd-dropdown-toggle py-2 px-4 inline-flex w-full items-center gap-x-2 text-xs sm:text-xs font-semibold rounded-lg border hover:bg-black/5 hover:border-white/70 transition-all text-gray-800 disabled:opacity-50 disabled:pointer-events-none dark:text-white"
                                dropdownId="nd-dropdown-profile">
                                <UiBaseIcon :path="mdiAccountCircleOutline" />
                                {{ $t("navbar.buttons.profile") }}
                            </SearchDropdownMainButton>
                        </template>
                        <template #content>
                            <SearchDropdownContent :header="$t('navbar.buttons.profile')">
                                <NuxtLink v-if="isAuth" to="/user/settings" data-testid="nav-settings" :prefetch="false">
                                    <SearchDropdownItem :text="$t('navbar.buttons.settings')" />
                                </NuxtLink>
                                <NuxtLink v-if="isAuth" to="/user/sync" data-testid="nav-anki" :prefetch="false">
                                    <SearchDropdownItem text="Anki" />
                                </NuxtLink>
                                <NuxtLink v-if="isAuth" to="/user/collections" data-testid="nav-collections" :prefetch="false">
                                    <SearchDropdownItem text="Collections" />
                                </NuxtLink>
                                <NuxtLink v-if="isAuth" to="/user/activity" data-testid="nav-activity" :prefetch="false">
                                    <SearchDropdownItem text="Activity" />
                                </NuxtLink>
                                <SearchDropdownItem v-if="!isAuth || isAuth == null" data-testid="nav-login" @click="openLoginModal" :text="$t('navbar.buttons.login')" />
                                <hr v-if="isAuth" class="my-1 border-neutral-700" />
                                <SearchDropdownItem v-if="isAuth" data-testid="nav-logout" @click="logout" :text="$t('navbar.buttons.logout')" />
                            </SearchDropdownContent>
                        </template>
                    </SearchDropdownContainer>
                </div>
            </div>
        </nav>
    </header>

    <div id="nd-nav-sidebar"
        data-testid="nav-menu"
        class="nd-overlay nd-overlay-backdrop-open:bg-neutral-900/40 nd-overlay-open:translate-x-0 hidden translate-x-full fixed top-0 end-0 transition-all duration-300 transform h-full max-w-xs w-full z-[80] bg-white border-s dark:bg-neutral-800 dark:border-neutral-700 md:hidden"
        role="dialog" tabindex="-1" aria-label="Navigation menu">

        <div class="flex items-center justify-between py-3 px-4 border-b dark:border-neutral-700">
            <NuxtLink to="/" class="inline-flex items-center font-semibold text-gray-800 dark:text-white">
                <img src="/logo-38d6e06a.webp" class="h-7 mr-2.5 rounded-semi" alt="Nadeshiko Logo" />
                Nadeshiko
            </NuxtLink>
            <button type="button"
                class="size-8 inline-flex justify-center items-center rounded-full border border-transparent bg-gray-100 text-gray-800 hover:bg-gray-200 focus:outline-none focus:bg-gray-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-400 dark:focus:bg-neutral-600"
                aria-label="Close" data-nd-overlay="#nd-nav-sidebar">
                <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                </svg>
            </button>
        </div>

        <div class="flex flex-col h-[calc(100%-57px)]">
            <div class="px-4 py-3 border-b dark:border-neutral-700">
                <div class="relative">
                    <input v-model="sidebarSearch" @keydown.enter="submitSidebarSearch"
                        class="w-full pl-9 pr-3 py-2 bg-neutral-700/50 text-white text-sm rounded-lg border border-white/10 placeholder-neutral-400 focus:outline-none focus:border-input-focus-ring"
                        placeholder="Search anything!" />
                    <UiBaseIcon :path="mdiMagnify" :size="16"
                        class="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
            </div>

            <div class="flex flex-col py-2">
                <NuxtLink to="/media"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiMovieOpenOutline" :size="18" />
                    {{ $t("navbar.buttons.media") }}
                </NuxtLink>
                <NuxtLink to="/blog"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiNewspaperVariantOutline" :size="18" />
                    {{ $t("navbar.buttons.blog") }}
                    <span
                      v-if="hasNewPost && !isOnBlog"
                      class="size-1.5 rounded-full bg-header-background"
                    />
                </NuxtLink>
                <NuxtLink to="/stats"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiChartBar" :size="18" />
                    {{ $t("navbar.buttons.stats") }}
                </NuxtLink>
                <NuxtLink to="/about"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiInformationOutline" :size="18" />
                    {{ $t("navbar.buttons.about") }}
                </NuxtLink>
                <NuxtLink to="/api/v1/docs" :prefetch="false"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiApi" :size="18" />
                    API
                </NuxtLink>
            </div>

            <div class="border-t dark:border-neutral-700 py-2">
                <template v-if="isAuth">
                    <NuxtLink to="/user/settings"
                        class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                        <UiBaseIcon :path="mdiCogOutline" :size="18" />
                        {{ $t('navbar.buttons.settings') }}
                    </NuxtLink>
                    <NuxtLink to="/user/sync"
                        class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                        <UiBaseIcon :path="mdiSync" :size="18" />
                        Anki
                    </NuxtLink>
                    <NuxtLink to="/user/collections"
                        class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                        <UiBaseIcon :path="mdiFormatListBulletedSquare" :size="18" />
                        Collections
                    </NuxtLink>
                    <NuxtLink to="/user/activity"
                        class="nd-sidebar-link flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                        <UiBaseIcon :path="mdiHistory" :size="18" />
                        Activity
                    </NuxtLink>
                </template>
                <button v-if="!isAuth" @click="openLoginModal"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 w-full text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiLogin" :size="18" />
                    {{ $t('navbar.buttons.login') }}
                </button>
                <button v-if="isAuth" @click="logout"
                    class="nd-sidebar-link flex items-center gap-3 px-5 py-3 w-full text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700">
                    <UiBaseIcon :path="mdiLogout" :size="18" />
                    {{ $t('navbar.buttons.logout') }}
                </button>
            </div>

            <div class="mt-auto border-t dark:border-neutral-700 py-3 px-5">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <a href="https://discord.gg/c6yGwbXruq"
                            class="flex items-center justify-center size-9 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
                            target="_blank" aria-label="Discord">
                            <svg class="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg"
                                xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 -25 260 260" version="1.1">
                                <g>
                                    <path
                                        d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"
                                        fill-rule="nonzero"></path>
                                </g>
                            </svg>
                        </a>
                        <a href="https://github.com/BrigadaSOS/Nadeshiko"
                            class="flex items-center justify-center size-9 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
                            target="_blank" aria-label="Github">
                            <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24" fill="none"
                                xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M12.026 2C7.13295 1.99937 2.96183 5.54799 2.17842 10.3779C1.395 15.2079 4.23061 19.893 8.87302 21.439C9.37302 21.529 9.55202 21.222 9.55202 20.958C9.55202 20.721 9.54402 20.093 9.54102 19.258C6.76602 19.858 6.18002 17.92 6.18002 17.92C5.99733 17.317 5.60459 16.7993 5.07302 16.461C4.17302 15.842 5.14202 15.856 5.14202 15.856C5.78269 15.9438 6.34657 16.3235 6.66902 16.884C6.94195 17.3803 7.40177 17.747 7.94632 17.9026C8.49087 18.0583 9.07503 17.99 9.56902 17.713C9.61544 17.207 9.84055 16.7341 10.204 16.379C7.99002 16.128 5.66202 15.272 5.66202 11.449C5.64973 10.4602 6.01691 9.5043 6.68802 8.778C6.38437 7.91731 6.42013 6.97325 6.78802 6.138C6.78802 6.138 7.62502 5.869 9.53002 7.159C11.1639 6.71101 12.8882 6.71101 14.522 7.159C16.428 5.868 17.264 6.138 17.264 6.138C17.6336 6.97286 17.6694 7.91757 17.364 8.778C18.0376 9.50423 18.4045 10.4626 18.388 11.453C18.388 15.286 16.058 16.128 13.836 16.375C14.3153 16.8651 14.5612 17.5373 14.511 18.221C14.511 19.555 14.499 20.631 14.499 20.958C14.499 21.225 14.677 21.535 15.186 21.437C19.8265 19.8884 22.6591 15.203 21.874 10.3743C21.089 5.54565 16.9181 1.99888 12.026 2Z">
                                </path>
                            </svg>
                        </a>
                    </div>
                    <CommonLanguageSelector test-id="language-selector-mobile" drop-up />
                </div>
            </div>
        </div>
    </div>
</template>
