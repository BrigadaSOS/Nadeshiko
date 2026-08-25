<script setup lang="ts">
import { useRoute } from 'vue-router';
import { handleApiError } from '~/utils/apiError';

/**
 * Where the unsubscribe link in a lifecycle email lands.
 *
 * IT OFFERS LESS BEFORE IT OFFERS NONE. Somebody who clicked this link is on
 * their way out, and that is the one moment where a choice between categories is
 * worth more than anywhere else in the product: a reader who only wanted the
 * monthly recap to stop will take that option if it is in front of them, and
 * will take "stop everything" if it is not.
 *
 * IT CHANGES NOTHING ON ARRIVAL, and that is why the link points here rather
 * than at a backend route. Mail scanners and link-preview bots fetch every URL
 * in a message before the recipient has seen it; anything that opted somebody
 * out on load would unsubscribe readers from mail they never opened, and we
 * would never know it had happened. The GET reads, the writes are explicit.
 *
 * The header's one-click is a different URL carrying the same token, and it is
 * blunt on purpose -- Gmail posts it with nobody present, so there is no one to
 * show a choice to. See `unsubscribeUrls` in the backend.
 *
 * No session required, by design. The token speaks for the account, and an
 * opt-out that first demanded a sign-in is the one that gets answered with the
 * spam button instead.
 */

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const CATEGORIES = ['recap', 'checkins', 'updates'] as const;
type Category = (typeof CATEGORIES)[number];

const token = computed(() => String(route.query.token ?? ''));
const state = ref<'loading' | 'ready' | 'failed'>('loading');
const message = ref('');
const saving = ref<Category | 'all' | null>(null);

const enabled = ref(true);
const categories = reactive<Record<Category, boolean>>({ recap: true, checkins: true, updates: true });
/** Which category the email that brought them here belonged to, so the page can point at it. */
const cameFrom = ref<Category | null>(null);

// Nothing here should be indexed or previewed: the URL carries a token, and a
// crawler following it is exactly the visitor this page is careful about.
definePageMeta({ robots: false });

/**
 * Says what just changed.
 *
 * The switches save as they are flipped, so without this the page answers a
 * deliberate act with nothing at all -- and a reader who came here to make
 * something stop needs to be told it stopped. Names the switch rather than
 * saying "saved", because there are four of them on one card.
 */
const announce = (on: boolean, name: string) => {
  useToastSuccess(t(on ? 'accountSettings.emails.turnedOn' : 'accountSettings.emails.turnedOff', { name }));
};

const failWith = (caught: unknown) => {
  state.value = 'failed';
  // A token we cannot read is the one failure the reader can route around
  // themselves, so it names the way out rather than saying "something went
  // wrong": the same switches live in their settings.
  const status =
    (caught as { status?: number; response?: { status?: number } })?.status ??
    (caught as { response?: { status?: number } })?.response?.status;
  message.value = status === 400 ? t('unsubscribe.invalid') : t('unsubscribe.failed');
  handleApiError('email.unsubscribe', caught, { toastKey: false });
};

onMounted(async () => {
  if (!token.value) {
    state.value = 'failed';
    message.value = t('unsubscribe.invalid');
    return;
  }

  try {
    const current = await useNadeshikoSdk().getEmailPreferencesByToken({ token: token.value });
    enabled.value = current.enabled;
    Object.assign(categories, current.categories);
    cameFrom.value = (current.category as Category | null) ?? null;
    state.value = 'ready';
  } catch (caught) {
    failWith(caught);
  }
});

/**
 * One switch at a time, sending only what moved.
 *
 * The reader sees the change take immediately rather than pressing a save
 * button, because the thing they came here to do is stop something -- and a page
 * that makes them confirm twice is a page they close on the first screen.
 */
const toggle = async (category: Category) => {
  if (saving.value) return;
  saving.value = category;
  const next = !categories[category];

  try {
    const updated = await useNadeshikoSdk().updateEmailPreferencesByToken({
      token: token.value,
      [category]: next,
    });
    enabled.value = updated.enabled;
    Object.assign(categories, updated.categories);
    announce(next, t(`accountSettings.emails.${category}Title`));
  } catch (caught) {
    failWith(caught);
  } finally {
    saving.value = null;
  }
};

/**
 * The master switch, which is also the way out.
 *
 * A switch rather than a "stop everything" button, because the card this page
 * copies already has one and a reader who wants out can flip it without reading
 * anything. Turning it back on restores whatever the categories underneath say.
 */
const toggleAll = async () => {
  if (saving.value) return;
  saving.value = 'all';
  const next = !enabled.value;

  try {
    const updated = await useNadeshikoSdk().updateEmailPreferencesByToken({ token: token.value, enabled: next });
    enabled.value = updated.enabled;
    Object.assign(categories, updated.categories);
    announce(next, t('accountSettings.emails.allTitle'));
  } catch (caught) {
    failWith(caught);
  } finally {
    saving.value = null;
  }
};
</script>

<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4">
    <div class="mx-auto flex w-full max-w-lg flex-col">
      <template v-if="state === 'loading'">
        <span class="nd-spinner mx-auto" aria-hidden="true" />
      </template>

      <template v-else-if="state === 'failed'">
        <div class="flex flex-col items-center text-center">
          <img data-testid="error-image" class="mb-6" src="/assets/no-results.gif" :alt="t('errorPage.imageAlt')">
          <h1 class="text-2xl font-semibold text-white md:text-3xl">{{ message }}</h1>
          <NuxtLink :to="localePath('/user/settings')" class="mt-4 text-lg text-red-400 transition-colors hover:text-red-300">
            {{ t('unsubscribe.goToSettings') }}
          </NuxtLink>
        </div>
      </template>

      <template v-else>
        <h1 class="text-2xl font-semibold text-white md:text-3xl">{{ t('unsubscribe.chooseTitle') }}</h1>

        <!-- The same card as the account settings page, deliberately. Somebody
             who lands here from an email and somebody who found their settings
             are making the same decision, and two layouts for one decision is
             two places to keep in step. -->
        <div class="nd-settings-card mt-6">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="font-medium text-white">{{ t('accountSettings.emails.allTitle') }}</p>
                <p class="text-sm text-gray-400">{{ t('accountSettings.emails.allDescription') }}</p>
              </div>
              <button
                type="button"
                data-testid="unsubscribe-all"
                :disabled="saving !== null"
                :aria-pressed="enabled"
                :aria-label="t('accountSettings.emails.allTitle')"
                :class="[
                  'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                  enabled ? 'bg-red-500' : 'bg-gray-600',
                ]"
                @click="toggleAll"
              >
                <span
                  :class="[
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                    enabled ? 'translate-x-5' : 'translate-x-0',
                  ]"
                />
              </button>
            </div>

            <!-- Dimmed rather than hidden when the master is off: a reader
                 deciding whether to turn email back on needs to see what they
                 would be turning on. -->
            <div :class="['space-y-4 border-t border-gray-700 pt-4 transition-opacity', enabled ? '' : 'opacity-50']">
              <div
                v-for="category in CATEGORIES"
                :key="category"
                class="flex items-center justify-between gap-4"
              >
                <div>
                  <p class="text-white">{{ t(`accountSettings.emails.${category}Title`) }}</p>
                  <p class="text-sm text-gray-400">{{ t(`accountSettings.emails.${category}Description`) }}</p>
                </div>
                <button
                  type="button"
                  :data-testid="`unsubscribe-${category}`"
                  :disabled="!enabled || saving !== null"
                  :aria-pressed="enabled && categories[category]"
                  :aria-label="t(`accountSettings.emails.${category}Title`)"
                  :class="[
                    'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                    enabled ? 'cursor-pointer' : 'cursor-not-allowed',
                    enabled && categories[category] ? 'bg-red-500' : 'bg-gray-600',
                  ]"
                  @click="toggle(category)"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      enabled && categories[category] ? 'translate-x-5' : 'translate-x-0',
                    ]"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        <NuxtLink :to="localePath('/')" class="mt-6 text-center text-sm text-gray-400 transition-colors hover:text-gray-300">
          {{ t('unsubscribe.cancel') }}
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
