<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import type { Definition } from '@shirabe-org/card/word-card';
import { cardTokenAttributes } from '@shirabe-org/card/word-card/host';
import { enrichTokens, type EnrichedToken, type SlimToken } from '~/utils/tokenEnrichment';
import { tabStop, tokenKeyAction } from '~/utils/tokenNavigation';
import { glossPreference } from '~/utils/wordCard';
import { definitionSize } from '~/utils/wordPopup';
import { posthog } from '~/utils/posthogClient';
import { createNadeshikoWordCardHost, toShirabeCardToken } from '~/utils/shirabeWordCardHost';
import {
  activeShirabeCardOwner,
  dismissShirabeWordCard,
  prefetchShirabeWordCard,
  prepareShirabeWordCard,
  toggleShirabeWordCard,
} from '~/utils/shirabeWordCard.client';
import type { SearchResult } from '~/types/search';

type Props = {
  tokens: Token[];
  highlight?: string;
  /** The sentence supplies the card's parser context when it is available. */
  result?: SearchResult;
};

const props = defineProps<Props>();
const emit = defineEmits<{ 'token-click': [query: string] }>();
const owner = Symbol('sentence-card');
const actionsTarget = shallowRef<HTMLElement | null>(null);
const openedToken = shallowRef<EnrichedToken | null>(null);
const openedDefinition = shallowRef<Definition | null>(null);
const { locale, t } = useI18n();
const config = useRuntimeConfig().public;
const { closeAllDropdowns, wordCardEpoch } = useDropdownState();
const { englishMode, spanishMode } = useTranslationVisibility();
const { dictionaryGlossLanguages } = useTranslationLanguages();
const { furiganaMode } = useHiraganaVisibility();
const { presets, isDictionaryEnabled } = useDictionaryLinks();

const enrichedTokens = computed<EnrichedToken[]>(() => enrichTokens(props.tokens as SlimToken[], props.highlight));
const sentenceText = computed(() => props.result?.segment.textJa.content ?? '');
const glossLanguages = computed(() =>
  glossPreference(locale.value, { en: englishMode.value, es: spanishMode.value }, dictionaryGlossLanguages.value),
);
const cardOutcome = (definition: Definition | null): 'name' | 'shown' | 'no_senses' | 'missing' => {
  if (!definition) return 'missing';
  if (definition.name) return 'name';
  return definition.senses.length ? 'shown' : 'no_senses';
};
const reader = userStore();
const cardHost = createNadeshikoWordCardHost({
  glossPreference: () => glossLanguages.value,
  uiLocale: () => locale.value,
  shirabeSite: config.shirabeSite,
  linked: () => reader.shirabeLinked,
  dictionaryReveal: () => reader.shirabeDictionaryReveal,
  onDefinition(definition) {
    if (activeShirabeCardOwner.value !== owner) return;
    openedDefinition.value = definition;
  },
  lookupLinks(definition, word) {
    const token = openedToken.value;
    if (!token) return [];
    const spelling = definition?.headword ?? word.dataset.lemma ?? token.dictForm;
    const reading = definition?.reading ?? (spelling === token.dictForm ? token.readingHiragana : '');
    return presets
      .filter((preset) => isDictionaryEnabled(preset.id))
      .map((preset) => ({
        id: preset.id,
        label: preset.label,
        url:
          preset.id === 'shirabe' && definition?.url
            ? definition.url
            : preset.buildUrl(spelling, reading, definition?.entry, glossLanguages.value.labels),
      }));
  },
  report(event, detail) {
    const token = openedToken.value;
    const context = {
      lemma: token?.dictForm ?? null,
      gloss_locale: glossLanguages.value.order[0] ?? null,
      label_locale: glossLanguages.value.labels,
    };
    if (event === 'card_opened' || event === 'card_missing' || event === 'lookup_failed') {
      posthog.capture('word_card_opened', {
        ...context,
        outcome: event === 'lookup_failed' ? 'failed' : cardOutcome(openedDefinition.value),
        candidate_count: detail?.candidate_count ?? 0,
      });
    } else if (event === 'candidate_selected') {
      posthog.capture('word_card_candidate_picked', { ...context, ...detail });
    } else if (event === 'lookup_link_opened') {
      posthog.capture('dictionary_link_clicked', {
        ...context,
        ...detail,
        surface: 'word-card',
        left_shirabe: detail?.dictionary !== 'shirabe',
        outcome: cardOutcome(openedDefinition.value),
        alternatives_enabled: presets.filter((preset) => preset.id !== 'shirabe' && isDictionaryEnabled(preset.id))
          .length,
      });
    } else {
      posthog.capture(`shirabe_shared_${event}`, detail);
    }
  },
});
const cardDefinitionSize = computed<'small' | 'medium' | 'large'>(
  () =>
    definitionSize(userStore().preferences?.wordPopup?.definitionSize).toLowerCase() as 'small' | 'medium' | 'large',
);

const NOT_A_WORD = new Set(['symbol', 'whitespace']);
const HAS_JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const isLookupable = (token: EnrichedToken): boolean =>
  !NOT_A_WORD.has(token.kind ?? '') && HAS_JAPANESE.test(token.d ?? '');

const rootRef = ref<HTMLElement | null>(null);
const rovingKey = ref<number | null>(null);
const navigableKeys = computed(() => enrichedTokens.value.filter(isLookupable).map((token) => token.b));
const tabStopKey = computed(() => tabStop(navigableKeys.value, rovingKey.value));

async function openCard(token: EnrichedToken, event: MouseEvent | KeyboardEvent): Promise<void> {
  if (!isLookupable(token)) return;
  if (event instanceof MouseEvent) event.stopPropagation();
  closeAllDropdowns();
  activeShirabeCardOwner.value = owner;
  openedToken.value = token;
  openedDefinition.value = null;
  const toggled = await toggleShirabeWordCard({
    element: event.currentTarget as HTMLElement,
    host: cardHost,
    definitionSize: cardDefinitionSize.value,
    languages: glossLanguages.value.order.map((language) => (language === 'es' ? 'spa' : 'eng')),
    displayLocale: locale.value === 'es' ? 'es' : 'en',
    labels: {
      parts: t('tokenTooltip.parts'),
      lookupIn: t('tokenTooltip.lookupIn'),
    },
    onClose() {
      if (activeShirabeCardOwner.value !== owner) return;
      activeShirabeCardOwner.value = null;
      actionsTarget.value = null;
      openedToken.value = null;
      openedDefinition.value = null;
    },
  });
  if (activeShirabeCardOwner.value !== owner) return;
  if (!toggled.open) {
    if (activeShirabeCardOwner.value === owner) activeShirabeCardOwner.value = null;
    openedToken.value = null;
    return;
  }
  actionsTarget.value = toggled.actionsTarget;
}

function searchForWord(query: string): void {
  activeShirabeCardOwner.value = null;
  void dismissShirabeWordCard();
  emit('token-click', query);
}

function prefetchCard(event: Event): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element?.getAttribute('role') !== 'button') return;
  void prefetchShirabeWordCard(element, cardHost);
}

function focusToken(key: number): void {
  rovingKey.value = key;
  void nextTick(() => rootRef.value?.querySelector<HTMLElement>(`[data-token="${key}"]`)?.focus());
}

function onTokenKeydown(token: EnrichedToken, event: KeyboardEvent): void {
  const action = tokenKeyAction(event.key, navigableKeys.value, token.b);
  if (!action) return;
  event.preventDefault();
  if (action.type === 'open') openCard(token, event);
  else if (action.type === 'move') focusToken(action.to);
}

watch(wordCardEpoch, () => {
  if (rootRef.value?.querySelector('.sb-word-open')) void dismissShirabeWordCard();
});

onMounted(prepareShirabeWordCard);

onBeforeUnmount(() => {
  if (activeShirabeCardOwner.value === owner) activeShirabeCardOwner.value = null;
  if (rootRef.value?.querySelector('.sb-word-open')) void dismissShirabeWordCard();
});
</script>

<template>
  <span ref="rootRef" lang="ja" class="token-text">
    <template v-for="token in enrichedTokens" :key="token.b">
      <span
        class="token"
        v-bind="cardTokenAttributes(toShirabeCardToken(token), sentenceText)"
        :class="{
          'token--context': token.origin === 'before' || token.origin === 'after',
          'token--match': token.matchType === 'match',
          'token--compound': token.matchType === 'partial',
        }"
        :data-token="token.b"
        :role="isLookupable(token) ? 'button' : undefined"
        :tabindex="isLookupable(token) ? (token.b === tabStopKey ? 0 : -1) : undefined"
        :aria-label="isLookupable(token) ? token.displaySurface : undefined"
        @click="openCard(token, $event)"
        @mouseenter="prefetchCard"
        @focus="prefetchCard"
        @keydown="isLookupable(token) && onTokenKeydown(token, $event)"
      ><template v-if="furiganaMode !== 'hidden'"><template v-for="(seg, si) in token.furigana" :key="si"><ruby v-if="seg.reading" :class="{ 'furigana--spoiler': furiganaMode === 'spoiler' }">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template><template v-else>{{ token.displaySurface }}</template></span>
    </template>
  </span>
  <Teleport v-if="actionsTarget && openedToken && activeShirabeCardOwner === owner" :to="actionsTarget">
    <SearchSegmentNadeshikoWordCardActions
      :token="openedToken"
      :result="result"
      :definition="openedDefinition"
      @search="searchForWord"
    />
  </Teleport>
</template>

<style scoped>
.token-text {
  position: relative;
}

.token {
  cursor: pointer;
  transition: background-color 0.15s ease;
  border-radius: 2px;
}

.token:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

/* The keyboard's version of the hover above. Without it the arrow keys move a
   focus nobody can see, which is the same as not having them: the ring IS the
   feature for a reader walking a sentence a word at a time. `focus-visible`
   rather than `focus` so a mouse click does not leave one behind. */
.token:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
  background-color: rgba(255, 255, 255, 0.15);
}


/* The sentences an expansion pulled in, so the reader can still see which line
   was the hit. Same colour the translations get from their `text-cyan-200`
   wrapper (Tailwind's cyan-200), because it is the same distinction.

   Declared before `.token--match` on purpose: the two are equally specific, so
   source order decides, and a match has to win. It only comes up in the segment
   the reader searched for -- a context request carries no query, so neighbours
   have nothing highlighted -- but "the word you searched for" is the louder
   thing to say when it does. */
.token--context {
  color: #a5f3fc;
}

.token--match {
  color: var(--accent-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.token--compound {
  color: var(--accent-soft);
  opacity: 0.7;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}


.token.sb-word-open {
  background-color: color-mix(in srgb, var(--accent-soft) 28%, transparent);
}

ruby rt {
  font-size: 0.55em;
  color: rgb(163 163 163);
  text-align: center;
  line-height: 1;
  user-select: none;
}

.furigana--spoiler rt {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.token:hover .furigana--spoiler rt {
  opacity: 1;
}
</style>
