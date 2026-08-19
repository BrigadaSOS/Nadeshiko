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
  /** Shirabe refused the key outright -- revoked over there, or swept for being
   *  idle. Unlike `needsUpgrade` this IS a repair: the reader's own dictionaries
   *  are not being used until they link again. */
  disconnected: boolean;
  linkedAt: string;
  shirabeName: string | null;
  tokenPrefix: string;
  scopes: string[];
  dictionaries: string[];
  /** Slug => display name, as Shirabe names them. Empty for a link made before
   *  Shirabe published the names, so a slug is the fallback. */
  dictionaryNames?: Record<string, string>;
  stackIsPrivate: boolean;
  syncedAt: string | null;
}

const { t, locale } = useI18n();

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
 * Four states, and the middle two are opposites worth keeping apart.
 *
 * `upgrade` is a link that WORKS: what it was linked for still resolves, and it
 * is asking for a permission a newer feature wants. It must not read as broken,
 * because "approve more permissions" with no reason attached is a thing readers
 * decline.
 *
 * `disconnected` is the repair. Shirabe refused the key outright -- the reader
 * revoked it over there, or it was swept for being idle -- so their own
 * dictionaries are NOT being used and nothing here can fix that except making a
 * new link. It is checked first: a dead link that also happens to be missing a
 * scope is dead, and offering "update permissions" for a key that no longer
 * exists sends the reader somewhere that cannot help them.
 */
const state = computed<'unlinked' | 'linked' | 'upgrade' | 'disconnected'>(() => {
  if (!connection.value) return 'unlinked';
  if (connection.value.disconnected) return 'disconnected';
  return connection.value.needsUpgrade ? 'upgrade' : 'linked';
});

/**
 * The dictionaries this link actually answers from, in the reader's own order.
 *
 * Shown because without it the card claimed an effect nobody could check: it
 * said "Linked as Lumi" and stopped, while the whole point of linking is which
 * dictionaries a word card reads. A reader who reorders their stack in Shirabe
 * had no way to confirm that anything over here had noticed.
 *
 * It is also what makes a refresh button unnecessary rather than merely absent.
 * Opening this page re-reads the stack from Shirabe before answering
 * (`getShirabeConnection` calls `refreshStack`), so the list is current by the
 * time it renders -- and a button that refreshes something invisible is one
 * people press twice and then distrust.
 */
const dictionaries = computed(() =>
  (connection.value?.dictionaries ?? []).map((source, index) => ({ ...dictionaryLabel(source), position: index + 1 })),
);

/**
 * A stack entry is `slug:language` -- `jmdict:en`, `yomitan-c89af12122021a8a:ja`
 * -- and both halves matter to a reader: the same dictionary sits in the stack
 * twice when they read it in two languages.
 *
 * The NAME comes from Shirabe, because only Shirabe has it. A reader's own
 * uploads are filed under a hash of their contents, so this card printed
 * `yomitan-c89af12122021a8a` at the person who had uploaded 三省堂国語辞典 -- and
 * no map on this side could ever have fixed that, since the slug is a hash and
 * the name is theirs. The slug survives as the fallback for a link made before
 * Shirabe published the names, which is what the reader saw anyway.
 */
function dictionaryLabel(source: string): { name: string; language: string | null } {
  const separator = source.lastIndexOf(':');
  const slug = separator === -1 ? source : source.slice(0, separator);
  const language = separator === -1 ? null : source.slice(separator + 1);
  return { name: connection.value?.dictionaryNames?.[slug] || slug, language: language?.toUpperCase() ?? null };
}

/**
 * Where to go to change any of this. The dictionaries are Shirabe's setting, not
 * ours -- there is nothing here to edit -- so the useful thing this card can do
 * is show the reader what we see and point at the page that owns it.
 *
 * From `public.shirabeSite` rather than the API base, which may be an address
 * only our server can reach, and locale-matched so a Spanish reader does not
 * land on an English settings page.
 */
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
</template>
