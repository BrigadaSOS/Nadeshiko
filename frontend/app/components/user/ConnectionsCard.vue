<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';

/**
 * Other accounts this one reaches, as a card on the settings page.
 *
 * Today that is Shirabe, which supplies the definitions behind every word on
 * this site and shapes a lookup by the dictionary stack of whoever's key made
 * the call. Unlinked, that key is ours -- a service identity with no
 * preferences -- so every reader sees the same dictionaries. Linked, the word
 * card answers from the dictionaries the reader configured over there, in their
 * order.
 *
 * A card here rather than a tab of its own: it is one switch about what
 * definitions look like, which is what the cards above it are, and a tab holding
 * a single row reads as a section somebody forgot to finish. Named for the
 * shelf rather than for Shirabe so a second connection is a row, not a rewrite.
 *
 * The key itself never reaches this component, or any browser: it is held by our
 * backend and only ever handed to our own server.
 */

interface Connection {
  /** The link works, but a newer feature wants a permission granted before that
   *  feature existed. A re-consent, not a repair. */
  needsUpgrade: boolean;
  missingScopes: string[];
  linkedAt: string;
  shirabeName: string | null;
  tokenPrefix: string;
  scopes: string[];
  dictionaries: string[];
  stackIsPrivate: boolean;
  syncedAt: string | null;
}

const { t } = useI18n();

const connection = ref<Connection | null>(null);
const isLoading = ref(true);
const isWorking = ref(false);

async function load() {
  try {
    const data = await $fetch<{ connection: Connection | null }>('/v1/user/connections/shirabe');
    connection.value = data.connection;
  } catch (error) {
    handleApiError('shirabeConnection.load', error);
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);

/**
 * A full navigation rather than a popup or an iframe. The reader is about to be
 * asked to approve something on somebody else's site, and the one defence
 * against being asked that by a page pretending to be them is seeing the address
 * bar say shirabe.org.
 */
async function connect() {
  isWorking.value = true;
  try {
    const { authorizeUrl } = await $fetch<{ authorizeUrl: string }>('/v1/user/connections/shirabe', {
      method: 'POST',
    });
    window.location.href = authorizeUrl;
  } catch (error) {
    handleApiError('shirabeConnection.start', error);
    isWorking.value = false;
  }
}

async function disconnect() {
  // Native `confirm`, the way every other destructive action on these pages asks
  // (deleting the account, revoking every session, clearing history). A modal of
  // its own would be the only one on the page, for the least destructive of
  // them.
  //
  // Worth confirming at all because the button sits inches from "Update
  // permissions" and the cost is not obvious from the word Disconnect: the key
  // is revoked on Shirabe, so re-connecting is a fresh approval rather than an
  // undo.
  if (!confirm(t('connections.shirabe.confirmDisconnect'))) return;

  isWorking.value = true;
  try {
    await $fetch('/v1/user/connections/shirabe', { method: 'DELETE' });
    connection.value = null;
  } catch (error) {
    handleApiError('shirabeConnection.unlink', error);
  } finally {
    isWorking.value = false;
  }
}

/**
 * Three states, not two.
 *
 * `upgrade` is the one worth being careful about: the account IS linked and what
 * it was linked for still works, so the row must not read as broken. It asks for
 * a permission a newer feature wants, and says which feature, because "approve
 * more permissions" with no reason attached is a thing readers decline.
 */
const state = computed<'unlinked' | 'linked' | 'upgrade'>(() => {
  if (!connection.value) return 'unlinked';
  return connection.value.needsUpgrade ? 'upgrade' : 'linked';
});

/** What the row says under the name. Linked, that is who they are over there --
 *  the fact the reader needs to recognise the link. Unlinked, what linking is
 *  for, since the name alone does not say. */
const description = computed(() => {
  if (state.value === 'unlinked') return t('connections.shirabe.description');

  const name = connection.value?.shirabeName || t('connections.shirabe.anonymous');
  return state.value === 'upgrade'
    ? t('connections.shirabe.upgradeNeeded', { name })
    : t('connections.shirabe.linkedAs', { name });
});

/** Re-consent goes through the same door as a first link: Shirabe mints a new
 *  key for the wider grant, and the old one is revoked as it is replaced. */
const action = computed(() => (state.value === 'linked' ? disconnect : connect));

/** Spelled out rather than built from the state name. An interpolated key reads
 *  shorter and hides all three from every `grep 'connections.shirabe.disconnect'`
 *  anyone runs while cleaning up translations. */
const actionLabel = computed(() => {
  if (state.value === 'linked') return t('connections.shirabe.disconnect');
  if (state.value === 'upgrade') return t('connections.shirabe.upgrade');
  return t('connections.shirabe.connect');
});
</script>

<template>
  <div class="nd-settings-card" data-testid="connections-card">
    <h3 class="nd-settings-title">{{ t('connections.title') }}</h3>

    <div class="mt-4">
      <div class="flex justify-between items-center gap-4">
        <div class="flex items-center gap-3">
          <!-- Their mark, not ours. A row naming another service is easier to
               recognise by its logo than by reading it, and this card is a list
               of other places rather than a list of settings. -->
          <img
            src="/assets/shirabe-logo.png"
            alt=""
            aria-hidden="true"
            width="32"
            height="32"
            class="w-8 h-8 shrink-0 rounded"
          >
          <div>
            <p class="text-white">{{ t('connections.shirabe.name') }}</p>
            <p class="text-gray-400 text-sm">{{ description }}</p>
          </div>
        </div>
        <button
          class="nd-btn shrink-0"
          :disabled="isLoading || isWorking"
          data-testid="shirabe-connection-toggle"
          @click="action()"
        >
          {{ actionLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
