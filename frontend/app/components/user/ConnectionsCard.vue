<script setup lang="ts">
import { mdiPatreon } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

/** Linked lookups use the reader's Shirabe dictionary stack; unlinked lookups use service defaults. Keys stay
 * server-side: stored by the backend and supplied only to our server, never the browser.
 */

interface Connection {
  /** The link works, but a newer feature wants a permission granted before that
   *  feature existed. A re-consent, not a repair. */
  needsUpgrade: boolean;
  missingScopes: string[];
  /** Shirabe refused the key outright -- revoked over there, or swept for being
   *  idle. Unlike `needsUpgrade` this IS a repair: the reader's own dictionaries
   *  are not being used until they link again. */
  disconnected: boolean;
  linkedAt: string;
  shirabeName: string | null;
  scopes: string[];
  dictionaries: string[];
  /** Slug => display name, as Shirabe names them. Empty for a link made before
   *  Shirabe published the names, so a slug is the fallback. */
  dictionaryNames?: Record<string, string>;
  stackIsPrivate: boolean;
  syncedAt: string | null;
}

interface PatreonConnection {
  linked: true;
  fullName: string | null;
  active: boolean;
  patronStatus: string | null;
}

const { t, locale } = useI18n();

const connection = ref<Connection | null>(null);
const isLoading = ref(true);
const isWorking = ref(false);
const patreonConnection = ref<PatreonConnection | null>(null);
const patreonWorking = ref(false);
const patreonUrl = ref('https://www.patreon.com/c/BrigadaSOS');

async function load() {
  try {
    const data = await $fetch<{ connection: Connection | null }>('/v1/user/connections/shirabe');
    connection.value = data.connection;
  } catch (error) {
    handleApiError('shirabeConnection.load', error);
  } finally {
    isLoading.value = false;
  }
  try {
    const data = await $fetch<{ connection: PatreonConnection | null; patreonUrl: string }>(
      '/v1/user/connections/patreon',
    );
    patreonConnection.value = data.connection;
    patreonUrl.value = data.patreonUrl;
  } catch (error) {
    handleApiError('patreonConnection.load', error, { toastKey: false });
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

/** A refused key takes precedence over missing scopes: upgrade is a working link needing consent; disconnected
 * needs repair.
 */
const state = computed<'unlinked' | 'linked' | 'upgrade' | 'disconnected'>(() => {
  if (!connection.value) return 'unlinked';
  if (connection.value.disconnected) return 'disconnected';
  return connection.value.needsUpgrade ? 'upgrade' : 'linked';
});

/** Opening this page refreshes the Shirabe stack before returning it, so the displayed order needs no refresh
 * button.
 */
const dictionaries = computed(() =>
  (connection.value?.dictionaries ?? []).map((source, index) => ({ ...dictionaryLabel(source), position: index + 1 })),
);

/** Entries are slug:language; one dictionary can appear in two languages. Shirabe supplies upload names because
 * slugs may be content hashes; retain the slug fallback for older links without names.
 */
function dictionaryLabel(source: string): { name: string; language: string | null } {
  const separator = source.lastIndexOf(':');
  const slug = separator === -1 ? source : source.slice(0, separator);
  const language = separator === -1 ? null : source.slice(separator + 1);
  return { name: connection.value?.dictionaryNames?.[slug] || slug, language: language?.toUpperCase() ?? null };
}

/** Use the locale-matched public site URL, not an API base that may be reachable only from our server. */
const shirabeSettingsUrl = computed(() => {
  const site = useRuntimeConfig().public.shirabeSite || 'https://shirabe.org';
  return `${site}/${locale.value === 'es' ? 'es' : 'en'}/settings`;
});

/** What the row says under the name. Linked, that is who they are over there --
 *  the fact the reader needs to recognise the link. Unlinked, what linking is
 *  for, since the name alone does not say. */
const description = computed(() => {
  if (state.value === 'unlinked') return t('connections.shirabe.description');

  const name = connection.value?.shirabeName || t('connections.shirabe.anonymous');
  // Named even here: it is how the reader recognises WHICH link ended, and the
  // sentence has to say the dictionaries are not being used -- otherwise a card
  // reading "connected to Lumi" and a word card reading the default definitions
  // are two facts nobody can reconcile.
  if (state.value === 'disconnected') return t('connections.shirabe.disconnected', { name });
  return state.value === 'upgrade'
    ? t('connections.shirabe.upgradeNeeded', { name })
    : t('connections.shirabe.linkedAs', { name });
});

/** Re-consent and repair go through the same door as a first link: Shirabe mints
 *  a new key, and the old one is revoked as it is replaced. Only a working link
 *  offers to disconnect -- there is nothing left to disconnect from once Shirabe
 *  has refused the key. */
const action = computed(() => (state.value === 'linked' ? disconnect : connect));

/** Spelled out rather than built from the state name. An interpolated key reads
 *  shorter and hides all three from every `grep 'connections.shirabe.disconnect'`
 *  anyone runs while cleaning up translations. */
const actionLabel = computed(() => {
  if (state.value === 'linked') return t('connections.shirabe.disconnect');
  if (state.value === 'upgrade') return t('connections.shirabe.upgrade');
  if (state.value === 'disconnected') return t('connections.shirabe.reconnect');
  return t('connections.shirabe.connect');
});

async function connectPatreon() {
  patreonWorking.value = true;
  try {
    const { authorizeUrl } = await $fetch<{ authorizeUrl: string }>('/v1/user/connections/patreon', {
      method: 'POST',
    });
    window.location.href = authorizeUrl;
  } catch (error) {
    handleApiError('patreonConnection.start', error);
    patreonWorking.value = false;
  }
}

async function disconnectPatreon() {
  if (!confirm(t('connections.patreon.confirmDisconnect'))) return;
  patreonWorking.value = true;
  try {
    await $fetch('/v1/user/connections/patreon', { method: 'DELETE' });
    patreonConnection.value = null;
  } catch (error) {
    handleApiError('patreonConnection.unlink', error);
  } finally {
    patreonWorking.value = false;
  }
}
</script>

<template>
  <div class="nd-settings-card" data-testid="connections-card">
    <h3 class="nd-settings-title">{{ t('connections.title') }}</h3>

    <div class="mt-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="flex items-center gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded bg-[#ff424d] text-white" aria-hidden="true"><UiBaseIcon :path="mdiPatreon" size="22" /></div>
          <div>
            <p class="text-white">{{ t('connections.patreon.name') }}</p>
            <p class="text-sm text-gray-400" data-testid="patreon-connection-description">
              {{ patreonConnection
                ? t(patreonConnection.active ? 'connections.patreon.active' : 'connections.patreon.inactive', { name: patreonConnection.fullName || t('connections.patreon.member') })
                : t('connections.patreon.description') }}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <a v-if="patreonConnection && !patreonConnection.active" :href="patreonUrl" target="_blank" rel="noopener" class="nd-btn-accent">{{ t('connections.patreon.join') }}</a>
          <button type="button" class="nd-btn grow sm:grow-0" :disabled="patreonWorking" data-testid="patreon-connection-toggle" @click="patreonConnection ? disconnectPatreon() : connectPatreon()">
            {{ t(patreonConnection ? 'connections.patreon.disconnect' : 'connections.patreon.connect') }}
          </button>
        </div>
      </div>

      <div class="mt-5 border-t border-white/10 pt-5">
      <!-- The button drops to its own line below `sm`. Beside the text it was
           competing with a description that wraps to five lines on a phone, so
           both got squeezed: the description into a narrow column and the button
           into whatever was left. Full width there, which `nd-btn` already
           centres its label for. Written out rather than using
           `nd-settings-row`, because composing a utility over that
           component-layer class would win at every width, not just this one. -->
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="flex items-center gap-3">
          <!-- Their mark, not ours. A row naming another service is easier to
               recognise by its logo than by reading it, and this card is a list
               of other places rather than a list of settings. -->
          <img
            src="/assets/shirabe-logo.png"
            alt=""
            aria-hidden="true"
            width="40"
            height="40"
            class="w-10 h-10 shrink-0 rounded"
          >
          <div>
            <p class="text-white">{{ t('connections.shirabe.name') }}</p>
            <p data-testid="shirabe-connection-description" class="text-gray-400 text-sm">{{ description }}</p>
          </div>
        </div>
        <button type="button"
          class="nd-btn w-full shrink-0 sm:w-auto"
          :disabled="isLoading || isWorking"
          data-testid="shirabe-connection-toggle"
          @click="action()"
        >
          {{ actionLabel }}
        </button>
      </div>

      <!-- Only once there is a WORKING link to describe. Unlinked, the row is an
           offer, and a list of dictionaries the reader does not have yet would
           read as a claim about their account. Disconnected, the list is the
           last thing we saw before Shirabe refused the key: still true of their
           Shirabe account, no longer true of anything happening here, and the
           one thing on this card that would keep implying the link works. -->
      <div v-if="dictionaries.length && state !== 'disconnected'" class="mt-4 pt-4 border-t border-white/10">
        <p class="text-gray-300 text-sm">{{ t('connections.shirabe.dictionaries') }}</p>
        <!-- A LIST rather than a row of pills. A stack is ordered and can run to
             twenty entries, and pills wrapped over five lines read as a bag of
             tags: nothing about them says the first one is consulted first. A
             numbered column says it without a word of explanation. -->
        <ol class="mt-2 flex flex-col" data-testid="shirabe-stack">
          <li
            v-for="dictionary in dictionaries"
            :key="`${dictionary.name}-${dictionary.position}`"
            class="flex items-baseline gap-2 border-white/5 border-b py-1.5 last:border-b-0"
          >
            <span class="w-5 shrink-0 text-right text-gray-500 text-xs tabular-nums">{{ dictionary.position }}</span>
            <span class="text-gray-200 text-sm">{{ dictionary.name }}</span>
            <span v-if="dictionary.language" class="text-gray-500 text-xs">{{ dictionary.language }}</span>
          </li>
        </ol>
        <!-- The setting lives over there, so the hint is a door rather than an
             instruction: there is nothing on this card to edit. -->
        <p class="mt-3 text-gray-500 text-xs">
          <a
            :href="shirabeSettingsUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-gray-400 underline underline-offset-2 hover:text-white"
          >{{ t('connections.shirabe.dictionariesHint') }}</a>
        </p>
      </div>

      </div>
    </div>
  </div>
</template>
