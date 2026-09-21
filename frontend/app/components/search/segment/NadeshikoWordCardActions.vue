<script setup lang="ts">
import { mdiFileDocumentCheckOutline, mdiFileDocumentPlusOutline } from '@mdi/js';
import type { Definition } from '@shirabe-org/card/word-card';
import { userStore } from '~/stores/auth';
import type { SearchResult } from '~/types/search';
import type { EnrichedToken } from '~/utils/tokenEnrichment';
import { searchScopeQuery } from '~/utils/routes';
import { useWordMining } from '~/composables/useWordMining';
import { minedWordFromShirabeCard } from '~/utils/shirabeWordMining';

const props = defineProps<{
  result?: SearchResult;
  token: EnrichedToken;
  definition: Definition | null;
}>();
const emit = defineEmits<{ search: [query: string] }>();
const { t } = useI18n();
const router = useRouter();
const localePath = useLocalePath();
const route = useRoute();
const { openLoginModal } = useLoginModal();
const user = userStore();
const menuOpen = ref(false);
const checking = ref(false);
let currentProbe: Promise<void> | undefined;
const word = computed(() => props.definition?.headword ?? props.token.dictForm);
const selectedDictionaries = shallowRef<Set<string> | null>(null);
const dictionaryNames = computed(() => {
  const names = new Map<string, string>();
  for (const sense of props.definition?.senses ?? []) {
    const slug = sense.ref?.split('#')[0] ?? sense.dictionary ?? '';
    if (slug) names.set(slug, sense.dictionary ?? slug);
  }
  return [...names];
});
const minedWord = computed(() =>
  minedWordFromShirabeCard(
    props.definition,
    props.token,
    props.result?.segment.textJa.content ?? '',
    selectedDictionaries.value,
  ),
);
const { minedNoteId, mining, mapsDefinition, mineReady, probeMined, clearMined, openMinedNote, mineSentence } =
  useWordMining(
    () => props.result,
    () => word.value,
    () => minedWord.value,
  );
const searchHref = computed(
  () =>
    router.resolve({
      path: localePath(`/search/${encodeURIComponent(word.value)}`),
      query: searchScopeQuery(route.query),
    }).href,
);
watch(
  [word, () => props.definition?.entry],
  () => {
    menuOpen.value = false;
    selectedDictionaries.value = null;
    clearMined();
    currentProbe = probeMined();
  },
  { immediate: true },
);

function toggleDictionary(slug: string): void {
  const selected = new Set(selectedDictionaries.value ?? dictionaryNames.value.map(([id]) => id));
  if (selected.has(slug)) selected.delete(slug);
  else selected.add(slug);
  selectedDictionaries.value = selected;
}

function mine(wordFields = true): void {
  menuOpen.value = false;
  if (!mineReady.value) {
    void router.push(localePath('/user/sync'));
    return;
  }
  void mineSentence({ wordFields });
}

async function activateAnki(): Promise<void> {
  if (!props.definition || checking.value || mining.value) return;
  if (!user.isLoggedIn) {
    openLoginModal('anki_add_last');
    return;
  }
  if (!mineReady.value) {
    void router.push(localePath('/user/sync'));
    return;
  }
  const selectedWord = word.value;
  const selectedEntry = props.definition.entry;
  checking.value = true;
  try {
    await currentProbe;
    if (word.value !== selectedWord || props.definition?.entry !== selectedEntry) return;
    if (!mineReady.value) {
      void router.push(localePath('/user/sync'));
      return;
    }
    if (minedNoteId.value !== null) menuOpen.value = !menuOpen.value;
    else mine();
  } finally {
    checking.value = false;
  }
}

function search(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  emit('search', word.value);
}
</script>

<template>
  <div v-if="result" class="nd-anki-corner">
    <button
      type="button"
      class="nd-anki-add"
      data-testid="word-anki-add"
      :aria-label="t('searchpage.main.buttons.add')"
      :aria-expanded="minedNoteId !== null ? menuOpen : undefined"
      :aria-haspopup="minedNoteId !== null ? 'menu' : undefined"
      :disabled="!definition || checking || mining"
      :title="t('searchpage.main.buttons.add')"
      @click.stop="activateAnki"
    ><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="minedNoteId !== null ? mdiFileDocumentCheckOutline : mdiFileDocumentPlusOutline" /></svg></button>
    <div v-if="menuOpen && minedNoteId !== null" class="nd-anki-menu" role="menu" @click.stop>
      <button type="button" role="menuitem" data-testid="word-anki-open" @click="menuOpen = false; openMinedNote()">
        {{ t('tokenTooltip.openInAnki') }}
      </button>
      <button type="button" role="menuitem" data-testid="word-anki-context" :disabled="mining" @click="mine(false)">
        {{ t('tokenTooltip.mineContextOnly') }}
      </button>
      <button type="button" role="menuitem" data-testid="word-anki-mine" :disabled="mining" @click="mine()">
        {{ t('tokenTooltip.mineToNote') }}
      </button>
    </div>
  </div>
  <div v-if="result && mapsDefinition && dictionaryNames.length > 1" class="nd-dictionary-picks">
    <span>{{ t('tokenTooltip.pickedDictionaries', { count: selectedDictionaries?.size ?? dictionaryNames.length, total: dictionaryNames.length }) }}</span>
    <button v-for="[slug, name] in dictionaryNames" :key="slug" type="button"
      :aria-pressed="selectedDictionaries === null || selectedDictionaries.has(slug)"
      :aria-label="t('tokenTooltip.pickDictionary', { dictionary: name })"
      @click="toggleDictionary(slug)">{{ name }}</button>
  </div>
  <a :href="searchHref" class="nd-more-sentences" data-testid="word-more-sentences" @click="search">
    {{ t('wordCardActions.moreSentences') }}
  </a>
</template>
