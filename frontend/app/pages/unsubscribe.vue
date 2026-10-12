<script setup lang="ts">
import { useRoute } from 'vue-router';
import { handleApiError } from '~/utils/apiError';

// Offer category opt-outs as well as the master switch. The token authorizes without a session.
// Arrival only reads: mail scanners and link previews must not unsubscribe readers.
// Writes require explicit interaction; the email header's one-click POST uses a separate
// URL with the same token because no reader is present there to choose categories.

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

// Token-bearing URLs must not be indexed or previewed.
definePageMeta({ robots: false });

// Confirm the specific switch changed, since each switch saves immediately.
const announce = (on: boolean, name: string) => {
  useToastSuccess(t(on ? 'accountSettings.emails.turnedOn' : 'accountSettings.emails.turnedOff', { name }));
};

const failWith = (caught: unknown) => {
  state.value = 'failed';
  // Invalid tokens point to settings, where the same switches remain available.
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

// Save only the changed category immediately, with no second confirmation.
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

// Re-enabling the master restores the category choices shown underneath.
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

        <!-- Match account settings so both opt-out entry points offer the same choices. -->
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

            <!-- Keep disabled categories visible so readers know what re-enabling restores. -->
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
