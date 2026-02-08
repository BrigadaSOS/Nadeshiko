<script setup>
const store = userStore();
const isAuth = computed(() => store.isLoggedIn);

function openLoginModal() {
  window.NDOverlay?.open('#nd-vertically-centered-scrollable-loginsignup-modal');
}
</script>
<template>    
    <header
        class="relative flex flex-wrap sm:justify-start sm:flex-nowrap w-full bg-white text-xs py-3 lg:py-2 dark:bg-header-background">
        <nav class="max-w-[92%] w-full mx-auto sm:flex sm:items-center sm:justify-between">
            <div class="flex items-center justify-between">
                <div class="flex mr-7">
                    <NuxtLink to="/"
                        class="text-lg inline-flex items-center text-center align-middle font-semibold text-white">
                        <img format="ico" src="/favicon.ico" class="h-8 mr-3 rounded-semi" alt="Nadeshiko Logo" />
                        Nadeshiko
                    </NuxtLink>
                </div>

                <div class="sm:hidden">
                    <button type="button"
                        class="nd-collapse-toggle relative size-7 flex justify-center items-center gap-x-2 rounded-lg   bg-white text-gray-800  hover:bg-gray-50 focus:outline-none focus:bg-gray-50 disabled:opacity-50 disabled:pointer-events-none dark:bg-transparent dark:border-neutral-700 dark:text-white dark:hover:bg-white/10 dark:focus:bg-white/10"
                        id="nd-navbar-example-collapse" aria-expanded="false" aria-controls="nd-navbar-example"
                        aria-label="Toggle navigation" data-nd-collapse="#nd-navbar-example">
                        <svg class="nd-collapse-open:hidden shrink-0 size-4" xmlns="http://www.w3.org/2000/svg"
                            width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="3" x2="21" y1="6" y2="6" />
                            <line x1="3" x2="21" y1="12" y2="12" />
                            <line x1="3" x2="21" y1="18" y2="18" />
                        </svg>
                        <svg class="nd-collapse-open:block hidden shrink-0 size-4" xmlns="http://www.w3.org/2000/svg"
                            width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                        <span class="sr-only">Toggle navigation</span>
                    </button>
                </div>
            </div>
            <div id="nd-navbar-example"
                class="hidden nd-collapse transition-all duration-300 basis-full grow sm:block"
                aria-labelledby="nd-navbar-example-collapse">
                <div class="flex flex-col  mt-5 sm:flex-row sm:items-center sm:justify-end sm:mt-0 sm:ps-5">
                    <div class="gap-6 flex flex-col sm:flex-row mr-auto">
                        <NuxtLink to="/about"
                            class="text-xs font-bold text-white transition-all duration-200 hover:text-opacity-80">
                            {{ $t("navbar.buttons.about") }}
                        </NuxtLink>
                        <NuxtLink to="/api/v1/docs"
                            class="text-xs font-bold text-white transition-all duration-200 hover:text-opacity-80">
                            API
                        </NuxtLink>
                    </div>
                    <hr class="border-none my-1">
                    <div class="gap-2 flex flex-col sm:flex-row">
                        <div class="flex items-center">
                        <a href="https://discord.gg/ajWm26ADEj"
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
                        <a href="https://github.com/BrigadaSOS/BrigadaSOS-db"
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
                    <SearchDropdownContainer dropdownId="nd-dropdown-profile"
                        dropdownContainerClass="nd-dropdown-menu absolute top-full right-0 z-50 items-center text-center align-middle min-w-60 bg-white shadow-md p-2 mt-1 dark:bg-neutral-800 border-none rounded-lg">
                        <template #default>
                            <SearchDropdownMainButton
                                dropdownButtonClass="nd-dropdown-toggle py-2.5 px-4 inline-flex  w-full items-center gap-x-2 text-xs sm:text-xs font-semibold rounded-lg  border hover:bg-black/5 hover:border-white/70 transition-all  text-gray-800   disabled:opacity-50 disabled:pointer-events-none  dark:text-white"
                                dropdownId="nd-dropdown-profile">
                                {{ $t("navbar.buttons.profile") }}
                            </SearchDropdownMainButton>
                        </template>
                        <template #content>
                            <SearchDropdownContent>
                                <NuxtLink to="/settings">
                                    <SearchDropdownItem :text="$t('navbar.buttons.settings')" />
                                </NuxtLink>
                                <SearchDropdownItem v-if="!isAuth || isAuth == null" @click="openLoginModal" :text="$t('navbar.buttons.login')" />
                                <SearchDropdownItem v-else @click="store.logout()" :text="$t('navbar.buttons.logout')" />
                            </SearchDropdownContent>
                        </template>
                    </SearchDropdownContainer>
                    </div>
                </div>
            </div>
        </nav>
    </header>

</template>
