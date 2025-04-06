<script setup lang="ts">
// Fix for random focus when pressing tab
import { useFocusTrap } from "@vueuse/integrations/useFocusTrap";
const target = ref();
const { hasFocus, activate, deactivate } = useFocusTrap(target);

const store = userStore();
let passwordR = ref("");
let passwordR2 = ref("");
let emailR = ref("");
let usernameR = ref("");


onMounted(() => {
  const modalObserver = useElementObserver(
    "hs-vertically-centered-scrollable-loginsignup-modal-backdrop",
    () => activate(),
    () => deactivate()
  );
  onBeforeUnmount(() => {
    modalObserver.disconnect();
  });

  const query = new URLSearchParams(window.location.search);
  const code = query.get("code");

  if (code) {
    callbackDiscord(code);
  }
});

watch(
  () => store.isLoggedIn,
  async (newVal) => {
    if (newVal) {
      await nextTick(); // Asegura que el DOM esté actualizado
      const closeButton = document.querySelector(
        '[data-hs-overlay="#hs-vertically-centered-scrollable-loginsignup-modal"]'
      );
      if (closeButton) {
        HSOverlay.close("#hs-vertically-centered-scrollable-loginsignup-modal");
      }
    }
  }
);

const callbackGoogle = (response) => {
  store.loginGoogle(response.code);
};

const callbackDiscord = (code) => {
  store.loginDiscord(code);
};

const redirectToDiscordAuth = async () => {
  store.redirectToDiscordLogin();
};
</script>

<template>
  <div id="hs-vertically-centered-scrollable-loginsignup-modal"
    class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/40 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto">
    <div
      ref="target"
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
    >
      <div
        class="max-h-full l flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border"
      >
        <div
          class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border"
        >
          <h3 class="font-bold text-gray-800 text-gray-600 dark:text-gray-400">{{ $t('modalauth.headers.auth') }}</h3>
          <button
            type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-loginsignup-modal"
          >
            <span class="sr-only">Close</span>
            <svg
              class="w-3.5 h-3.5"
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M0.258206 1.00652C0.351976 0.912791 0.479126 0.860131 0.611706 0.860131C0.744296 0.860131 0.871447 0.912791 0.965207 1.00652L3.61171 3.65302L6.25822 1.00652C6.30432 0.958771 6.35952 0.920671 6.42052 0.894471C6.48152 0.868271 6.54712 0.854471 6.61352 0.853901C6.67992 0.853321 6.74572 0.865971 6.80722 0.891111C6.86862 0.916251 6.92442 0.953381 6.97142 1.00032C7.01832 1.04727 7.05552 1.1031 7.08062 1.16454C7.10572 1.22599 7.11842 1.29183 7.11782 1.35822C7.11722 1.42461 7.10342 1.49022 7.07722 1.55122C7.05102 1.61222 7.01292 1.6674 6.96522 1.71352L4.31871 4.36002L6.96522 7.00648C7.05632 7.10078 7.10672 7.22708 7.10552 7.35818C7.10442 7.48928 7.05182 7.61468 6.95912 7.70738C6.86642 7.80018 6.74102 7.85268 6.60992 7.85388C6.47882 7.85498 6.35252 7.80458 6.25822 7.71348L3.61171 5.06702L0.965207 7.71348C0.870907 7.80458 0.744606 7.85498 0.613506 7.85388C0.482406 7.85268 0.357007 7.80018 0.264297 7.70738C0.171597 7.61468 0.119017 7.48928 0.117877 7.35818C0.116737 7.22708 0.167126 7.10078 0.258206 7.00648L2.90471 4.36002L0.258206 1.71352C0.164476 1.61976 0.111816 1.4926 0.111816 1.36002C0.111816 1.22744 0.164476 1.10028 0.258206 1.00652Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <div class="overflow-y-auto">
          <div class="flex flex-row mx-auto">
            <div class="mx-4 sm:w-[60vh] w-full flex flex-col">
              <nav
                class="relative mt-2 z-0 flex border overflow-hidden border-none"
              >
              </nav>
              <div class="">
                <div
                  id="bar-with-underline-1"
                >
                  <div class="p-4 sm:px-7 mb-3">
                    <div class="flex flex-col">
                      <ClientOnly>
                        <GoogleLogin :callback="callbackGoogle">
                          <UiButtonPrimaryAction
                            class="py-3 w-full px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-sgray text-white hover:bg-sgray2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all text-sm dark:focus:ring-offset-gray-800"
                          >
                            <svg
                              class="w-4 h-auto"
                              width="46"
                              height="47"
                              viewBox="0 0 46 47"
                              fill="none"
                            >
                              <path
                                d="M46 24.0287C46 22.09 45.8533 20.68 45.5013 19.2112H23.4694V27.9356H36.4069C36.1429 30.1094 34.7347 33.37 31.5957 35.5731L31.5663 35.8669L38.5191 41.2719L38.9885 41.3306C43.4477 37.2181 46 31.1669 46 24.0287Z"
                                fill="#4285F4"
                              />
                              <path
                                d="M23.4694 47C29.8061 47 35.1161 44.9144 39.0179 41.3012L31.625 35.5437C29.6301 36.9244 26.9898 37.8937 23.4987 37.8937C17.2793 37.8937 12.0281 33.7812 10.1505 28.1412L9.88649 28.1706L2.61097 33.7812L2.52296 34.0456C6.36608 41.7125 14.287 47 23.4694 47Z"
                                fill="#34A853"
                              />
                              <path
                                d="M10.1212 28.1413C9.62245 26.6725 9.32908 25.1156 9.32908 23.5C9.32908 21.8844 9.62245 20.3275 10.0918 18.8588V18.5356L2.75765 12.8369L2.52296 12.9544C0.909439 16.1269 0 19.7106 0 23.5C0 27.2894 0.909439 30.8731 2.49362 34.0456L10.1212 28.1413Z"
                                fill="#FBBC05"
                              />
                              <path
                                d="M23.4694 9.07688C27.8699 9.07688 30.8622 10.9863 32.5344 12.5725L39.1645 6.11C35.0867 2.32063 29.8061 0 23.4694 0C14.287 0 6.36607 5.2875 2.49362 12.9544L10.0918 18.8588C11.9987 13.1894 17.25 9.07688 23.4694 9.07688Z"
                                fill="#EB4335"
                              />
                            </svg>
                            {{ $t('modalauth.buttons.google') }}
                          </UiButtonPrimaryAction>
                        </GoogleLogin>
                      </ClientOnly>
                      <UiButtonPrimaryAction
                        @click="redirectToDiscordAuth"
                        class="py-3 w-full px-4 mt-2 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-sgray text-white hover:bg-sgray2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all text-sm dark:focus:ring-offset-gray-800"
                      >
                        <svg
                          class="w-5 h-5"
                          viewBox="0 0 280 280"
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          xmlns:xlink="http://www.w3.org/1999/xlink"
                        >
                          <g>
                            <path
                              d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"
                              fill="#5865F2"
                            ></path>
                          </g>
                        </svg>
                        {{ $t('modalauth.buttons.discord') }}
                      </UiButtonPrimaryAction>
                    </div>
                  </div>
                </div>
                <div
                  id="bar-with-underline-2"
                  class="hidden"
                >
                  <div class="mt-3">
                    <div
                    >
                      <div class="p-4 sm:px-7 mb-3">
                        <div class="-mt-4">
                          <form autocomplete="off">
                            <div class="grid gap-y-4">
                              <!-- Form Group -->
                              <div>
                   
                                <div class="relative">
                                  <input
                                    type="username"
                                    v-model="usernameR"
                                    :placeholder="$t('modalauth.labels.username')"
                                    class="block p-2.5 w-full text-sm text-gray-900 rounded-lg border border-gray-300 focus:ring-white/50 focus:border-white/50 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 text-gray-600 dark:text-gray-400 dark:focus:ring-white/10 dark:focus:border-white/10"
                                    required
                                  />
                                  <div
                                    class="hidden absolute inset-y-0 right-0 flex items-center pointer-events-none pr-3"
                                  >
                                    <svg
                                      class="h-5 w-5 text-red-500"
                                      width="16"
                                      height="16"
                                      fill="currentColor"
                                      viewBox="0 0 16 16"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
                                      />
                                    </svg>
                                  </div>
                                </div>
                                <p
                                  class="hidden text-xs text-red-600 mt-2"
                                  id="email-error"
                                >
                                  Please include a valid email address so we can
                                  get back to you
                                </p>
                              </div>

                              <div>
                             
                                <div class="relative">
                                  <input
                                    type="email"
                                    v-model="emailR"
                                    :placeholder="$t('modalauth.labels.email')"
                                    class="block p-2.5 w-full text-sm text-gray-900 rounded-lg border border-gray-300 focus:ring-white/50 focus:border-white/50 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 text-gray-600 dark:text-gray-400 dark:focus:ring-white/10 dark:focus:border-white/10"
                                    required
                                  />
                                  <div
                                    class="hidden absolute inset-y-0 right-0 flex items-center pointer-events-none pr-3"
                                  >
                                    <svg
                                      class="h-5 w-5 text-red-500"
                                      width="16"
                                      height="16"
                                      fill="currentColor"
                                      viewBox="0 0 16 16"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
                                      />
                                    </svg>
                                  </div>
                                </div>
                                <p
                                  class="hidden text-xs text-red-600 mt-2"
                                  id="email-error"
                                >
                                  Please include a valid email address so we can
                                  get back to you
                                </p>
                              </div>
                              <!-- End Form Group -->

                              <!-- Form Group -->
                              <div class="flex justify-between space-x-4">
                                <div class="flex-grow">
                                  <div
                                    class="flex justify-between items-center"
                                  >
                                
                                  </div>
                                  <div class="relative">
                                    <input
                                      type="password"
                                      v-model="passwordR"
                                      :placeholder="$t('modalauth.labels.password')"
                                      class="block p-2.5 w-full text-sm text-gray-900 rounded-lg border border-gray-300 focus:ring-white/50 focus:border-white/50 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 text-gray-600 dark:text-gray-400 dark:focus:ring-white/10 dark:focus:border-white/10"
                                      required
                                    />
                                    <div
                                      class="hidden absolute inset-y-0 right-0 flex items-center pointer-events-none pr-3"
                                    >
                                      <svg
                                        class="h-5 w-5 text-red-500"
                                        width="16"
                                        height="16"
                                        fill="currentColor"
                                        viewBox="0 0 16 16"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
                                        />
                                      </svg>
                                    </div>
                                  </div>
                                  <p
                                    class="hidden text-xs text-red-600 mt-2"
                                    id="password-error"
                                  >
                                    8+ characters required
                                  </p>
                                </div>

                                <!-- Campo para repetir contraseña -->
                                <div class="flex-grow">
                                  <div
                                    class="flex justify-between items-center"
                                  >
                                  </div>
                                  <div class="relative">
                                    <input
                                      type="password"
                                      v-model="passwordR2"
                                      :placeholder="$t('modalauth.labels.repeatpassword')"
                                      class="block p-2.5 w-full text-sm text-gray-900 rounded-lg border border-gray-300 focus:ring-white/50 focus:border-white/50 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 text-gray-600 dark:text-gray-400 dark:focus:ring-white/10 dark:focus:border-white/10"
                                      required
                                    />
                                    <div
                                      class="hidden absolute inset-y-0 right-0 flex items-center pointer-events-none pr-3"
                                    >
                                      <svg
                                        class="h-5 w-5 text-red-500"
                                        width="16"
                                        height="16"
                                        fill="currentColor"
                                        viewBox="0 0 16 16"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
                                        />
                                      </svg>
                                    </div>
                                  </div>
                                  <p
                                    class="hidden text-xs text-red-600 mt-2"
                                    id="password_repeat-error"
                                  >
                                    Las contraseñas deben coincidir
                                  </p>
                                </div>
                              </div>

                              <!-- End Form Group -->

                              <!-- Checkbox -->

                              <!-- End Checkbox -->

                              <p
                                class="text-sm text-gray-600 text-center dark:text-gray-400"
                              >
                                {{ $t('modalauth.labels.terms', {
                                  terms: `<a href="/terms-and-conditions" class="text-blue-500" aria-label="TermsAndConditions">${$t('navbar.buttons.terms')}</a>`,
                                  privacy: `<a href="/privacy" class="text-blue-500" aria-label="Privacy">${$t('navbar.buttons.privacy')}</a>`
                                }) }}
                              </p>

                              <UiButtonPrimaryAction
                                @click="store.signUp(usernameR,emailR, passwordR)"
                                class="py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-sgray text-white hover:bg-sgray2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all text-sm dark:focus:ring-offset-gray-800"
                              >
                                {{ $t('modalauth.labels.registerButton') }}
                              </UiButtonPrimaryAction>
                            </div>
                          </form>
                          <!-- End Form -->
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
