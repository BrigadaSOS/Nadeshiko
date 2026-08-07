<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import {
  enrichTokens,
  hiraganaToKatakana,
  hiraganaToRomaji,
  type SlimToken,
  type EnrichedToken,
} from '~/utils/tokenEnrichment';
import {
  cardExamples,
  cardSenses,
  glossPreference,
  kanjiIn,
  pitchMorae,
  shirabeKanjiUrl,
  type GlossLanguage,
  type ShirabeWord,
} from '~/utils/wordCard';

type Props = {
  tokens: Token[];
  highlight?: string;
};

const props = defineProps<Props>();
const { locale } = useI18n();
const lookupsEnabled = Boolean(useRuntimeConfig().public.shirabeLookups);
const emit = defineEmits<{
  'token-click': [dictionaryForm: string];
}>();

const enrichedTokens = computed<EnrichedToken[]>(() => {
  return enrichTokens(props.tokens as SlimToken[], props.highlight);
});

const hoveredToken = ref<EnrichedToken | null>(null);
const tooltipStyle = ref<Record<string, string>>({});
const tooltipRef = ref<HTMLElement | null>(null);
// Which side of the token the card hangs off. A word card is several times the
// height of the two-line tooltip this replaced, so near the top of the viewport
// there is no longer room above.
const tooltipBelow = ref(false);
let hoveredElement: HTMLElement | null = null;

const GAP = 8; // px between token top and tooltip bottom
const VIEWPORT_MARGIN = 8; // px from viewport edges
// Below this the card is not worth showing at all, so it stops shrinking and
// scrolls instead. A viewport too short even for that is one where clamping the
// top edge is what keeps the headword readable.
const MIN_CARD_HEIGHT = 180;

// What the reader reads, which is not what the interface is in: the UI language
// and the translation language are separate settings, and only this one decides
// what a definition is worth showing in. Same preference the segment
// translations obey, so a reader who turned English off gets no English here.
const { englishMode, spanishMode } = useTranslationVisibility();
const glossLanguages = computed(() => glossPreference(locale.value, { en: englishMode.value, es: spanishMode.value }));

// Definitions come from Shirabe, which parsed these tokens and stamped each one
// with the id of its own entry. Fetched through our server route so the service
// key stays on the server. This cache spares a re-hover inside one segment; the
// same word in the segment below is covered by the route's own cache-control,
// which is a day long because a dictionary entry is the same for everyone.
const word = ref<ShirabeWord | null>(null);
const wordState = ref<'idle' | 'loading' | 'missing'>('idle');
const wordCache = new Map<string, ShirabeWord | null>();

const NOT_A_WORD = new Set(['symbol', 'whitespace']);
const HAS_JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

/** Worth asking the dictionary about, even with no id of its own. */
function lookupableWithoutId(token: EnrichedToken): boolean {
  return !NOT_A_WORD.has(token.kind ?? '') && HAS_JAPANESE.test(token.d ?? '');
}

async function loadWord(token: EnrichedToken): Promise<void> {
  // Not configured: no key on the server, so there is nothing to ask. Leaving
  // the request out entirely beats firing one that 503s on every hover and
  // caching the failure, and the card still answers from the token alone.
  if (!lookupsEnabled) {
    word.value = null;
    wordState.value = 'missing';
    return;
  }

  // `wid` only reaches content words: Shirabe's parse pool is the words a reader
  // studies, and particles are grammar. But の, は and が are the commonest things
  // on screen and JMdict defines all of them, so a reader hovering one should not
  // meet a blank card. Falling back to the dictionary form covers them.
  //
  // Only for something that could plausibly BE a word: punctuation, whitespace
  // and digits would just spend a request on a 404. And it is the fallback rather
  // than the rule because `wid` already picked the right homograph, which a bare
  // dictionary form cannot (開く answers あく, not ひらく).
  // The SURFACE, not the dictionary form, and that is the whole point. This
  // fallback only ever runs for a token Shirabe did not pool, and it does not
  // pool grammar: particles and auxiliaries. Those are exactly the words whose
  // surface IS their dictionary entry (は, が, なら), while their lemma is often
  // something else entirely: なら reduces to the copula だ, and looking that up
  // answers "to be" to a reader who pointed at "if". A content word never
  // reaches here, because it already carried a `wid`.
  const lookup = token.wid ?? (lookupableWithoutId(token) ? token.s : null);
  if (!lookup) {
    word.value = null;
    wordState.value = 'missing';
    return;
  }

  // Keyed by the label language, because that is the only thing that varies the
  // response: Shirabe resolves the sense tags into one language, while the
  // definitions come back in every language the entry has and are chosen here.
  const wid = lookup;
  const key = `${wid}:${glossLanguages.value.labels}`;
  if (wordCache.has(key)) {
    word.value = wordCache.get(key) ?? null;
    wordState.value = word.value ? 'idle' : 'missing';
    return;
  }

  word.value = null;
  wordState.value = 'loading';
  try {
    const found = await $fetch<ShirabeWord>(`/api/shirabe/words/${encodeURIComponent(wid)}`, {
      query: { locale: glossLanguages.value.labels },
    });
    wordCache.set(key, found);
    // The pointer may have moved on while this was in flight; only paint if the
    // answer still belongs to the word under the cursor. Compared against the
    // token that STARTED this request, not against its `wid`: a particle has no
    // id and looks itself up by dictionary form, so comparing ids there meant
    // `undefined !== 'は'` and the answer was fetched and then dropped, every
    // time, which is why grammar words never filled in.
    if (hoveredToken.value !== token) return;
    word.value = found;
    wordState.value = 'idle';
  } catch {
    wordCache.set(key, null);
    if (hoveredToken.value !== token) return;
    wordState.value = 'missing';
  }
  // The card just grew from one line to its full height, so where it fits has
  // changed with it.
  void placeTooltip();
}

async function placeTooltip(): Promise<void> {
  const anchor = hoveredElement;
  if (!anchor?.isConnected) return;
  const tokenRect = anchor.getBoundingClientRect();

  // Work entirely in viewport coordinates (tooltip is position:fixed)
  const idealLeft = tokenRect.left + tokenRect.width / 2;
  tooltipStyle.value = { left: `${idealLeft}px`, top: `${tokenRect.top - GAP}px` };

  await nextTick();
  const tip = tooltipRef.value;
  if (!tip) return;

  const tipRect = tip.getBoundingClientRect();
  let left = idealLeft;

  if (tipRect.left < VIEWPORT_MARGIN) {
    left += VIEWPORT_MARGIN - tipRect.left;
  } else if (tipRect.right > window.innerWidth - VIEWPORT_MARGIN) {
    left -= tipRect.right - (window.innerWidth - VIEWPORT_MARGIN);
  }

  // Above the token by default: it reads with the sentence and covers nothing
  // the reader is mid-way through. Below when the card no longer fits above,
  // because a card clipped by the top of the viewport is a card nobody can read.
  //
  // On a short viewport a full word card fits NEITHER side, and then the choice
  // is which side has more room, not which side it fits. That case is why the
  // height is capped to the room actually there rather than to a constant: a
  // 420px cap against 380px of room puts the headword 28px above the top edge,
  // where the head is pinned and cannot be scrolled back into view.
  const roomAbove = tokenRect.top - GAP - VIEWPORT_MARGIN;
  const roomBelow = window.innerHeight - VIEWPORT_MARGIN - (tokenRect.bottom + GAP);
  const below = tipRect.height > roomAbove && roomBelow > roomAbove;
  const room = Math.max(below ? roomBelow : roomAbove, MIN_CARD_HEIGHT);

  tooltipBelow.value = below;
  tooltipStyle.value = {
    left: `${left}px`,
    top: `${below ? tokenRect.bottom + GAP : Math.max(tokenRect.top - GAP, VIEWPORT_MARGIN + Math.min(tipRect.height, room))}px`,
    maxHeight: `${room}px`,
  };
}

/**
 * Open the card for a token.
 *
 * Click rather than hover: hovering opened a card over every word the pointer
 * crossed on its way somewhere else, which made the sentence hard to read and
 * fired a lookup per word passed over. A click is deliberate, so the card only
 * appears when it was asked for, and it stays put until dismissed -- which is
 * what makes the links inside it reachable.
 */
const onTokenEnter = (token: EnrichedToken, event: MouseEvent) => {
  // Re-clicking the open token closes it, so a click is its own undo.
  if (hoveredToken.value === token) {
    closeTooltip();
    return;
  }
  hoveredToken.value = token;
  hoveredElement = event.currentTarget as HTMLElement;
  tooltipBelow.value = false;
  // A revealed spoiler belongs to the sentence it was revealed on, and the card
  // for the next word is a different set of sentences under the same row keys.
  revealedTranslations.clear();
  void loadWord(token);
  void placeTooltip();
};

const closeTooltip = () => {
  hoveredToken.value = null;
  hoveredElement = null;
  // Reset, so the next open never inherits this one's tail. A request abandoned
  // in flight (the reader closed the card before it answered) returns early
  // without touching `wordState`, which used to leave it reading 'loading'
  // forever -- the card reopened stuck on "Looking up…" until something else
  // happened to reset it.
  word.value = null;
  wordState.value = 'idle';
};

// With the card opened by click it no longer closes when the pointer leaves, so
// it needs its own dismissals. A click anywhere outside it and Escape are the
// two a reader will already try; token clicks stop propagation, so opening one
// card while another is open does not read as an outside click.
const onDocumentPointerDown = (event: Event) => {
  if (!hoveredToken.value) return;
  const target = event.target as Node | null;
  if (target && tooltipRef.value?.contains(target)) return;
  closeTooltip();
};

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && hoveredToken.value) closeTooltip();
};

// The card is position:fixed against the token's viewport rect, which was fine
// while hovering held it open for a moment. Opened by click it outlives the
// scroll that follows, so it has to be re-anchored -- otherwise it sits where
// the word USED to be. Capture phase because the scroll that matters is often an
// inner container's, not the document's, and passive because this only reads.
const onViewportChange = () => {
  if (!hoveredToken.value) return;
  // Scrolled out of sight: the card has nothing left to point at, and one
  // pinned to the edge of the viewport is just in the way.
  if (hoveredElement && !isAnchorVisible(hoveredElement)) {
    closeTooltip();
    return;
  }
  void placeTooltip();
};

function isAnchorVisible(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('scroll', onViewportChange, { capture: true });
  window.removeEventListener('resize', onViewportChange);
});

const POS_CLASS: Record<string, string> = {
  動詞: 'token--verb',
  名詞: 'token--noun',
  形容詞: 'token--adjective',
  副詞: 'token--adverb',
  助詞: 'token--particle',
  助動詞: 'token--auxiliary',
};

// The one word on this card that is prose rather than data, and it is keyed by
// GLOSS language rather than by UI locale, so it cannot come from i18n: `t()`
// answers in the interface language, while this badge sits among definitions the
// reader chose to read in English or Spanish. Reading Nadeshiko in Japanese with
// Spanish glosses on, "常用" over "Frecuente" would be the odd one out.
const COMMON_LABEL: Record<GlossLanguage, string> = { en: 'Common', es: 'Frecuente' };

const { tooltipReadingMode } = useTooltipReadingVisibility();
const { furiganaMode } = useHiraganaVisibility();
const { presets, isDictionaryEnabled } = useDictionaryLinks();

// 1. Head. The headword is the dictionary form and the reading is the
// dictionary's, not the surface's: 焼けた reads やけた, but the word above the
// senses is 焼ける, and printing it over the inflected reading would be a lie.
const headword = computed(() => word.value?.headword ?? hoveredToken.value?.dictForm ?? '');

// Hiragana written the way the reader asked to see it. Everything on this card
// that spells a reading out goes through here, so the head and the pitch row
// cannot end up in two different scripts.
const inPreferredScript = (reading: string): string => {
  switch (tooltipReadingMode.value) {
    case 'katakana':
      return hiraganaToKatakana(reading);
    case 'romaji':
      return hiraganaToRomaji(reading);
    case 'hidden':
      return '';
    default:
      return reading;
  }
};

const headReading = computed(() => {
  const reading = word.value?.reading || hoveredToken.value?.reading || '';
  // For この the reading IS この, so a second copy of it adds nothing.
  if (!reading || reading === headword.value) return '';
  return inPreferredScript(reading);
});

// 2. What this occurrence does to the dictionary form, outermost step first:
// 食べさせられた is "past · potential / passive · causative" rather than one name
// that would be true of only its last step.
// Ruby for the headword. Shirabe aligns it on the word response (`furigana`), so
// this is the dictionary form's own ruby: the token's `f` is aligned to the
// surface it appeared as, which is a different string (焼けた, not 焼ける).
const headFurigana = computed(() =>
  (word.value?.furigana ?? []).filter((seg) => seg.text).map((seg) => ({ text: seg.text, reading: seg.ruby ?? '' })),
);

const inflectionLine = computed(() => {
  const token = hoveredToken.value;
  if (!token || token.inflectionLabels.length === 0) return '';
  return `${token.displaySurface} → ${token.dictForm} · ${token.inflectionLabels.join(' · ')}`;
});

// 3. Badges: how common the word is, in the three ways the dictionary knows.
const badges = computed(() => {
  const found = word.value;
  if (!found) return [];
  const items: Array<{ id: string; text: string; kind: string }> = [];
  if (found.common) items.push({ id: 'common', text: COMMON_LABEL[glossLanguages.value.labels], kind: 'is-common' });
  if (found.jlpt) items.push({ id: 'jlpt', text: found.jlpt, kind: 'is-jlpt' });
  if (typeof found.frequency === 'number') items.push({ id: 'freq', text: `#${found.frequency}`, kind: 'is-freq' });
  return items;
});

// 4. Pitch accent. Two patterns at most: a word read four ways is rare enough
// that it must not push the senses out of a hover card.
// Hidden readings take the pitch row with them: it spells the reading out one
// mora at a time, so leaving it up would print in full what the head was just
// asked to withhold. The morae are split from hiragana and only then written in
// the reader's script, because splitting romaji into morae is not a thing you
// can do afterwards.
const pitchPatterns = computed(() => {
  const reading = word.value?.reading;
  if (!reading || tooltipReadingMode.value === 'hidden') return [];
  return (word.value?.pitch ?? []).slice(0, 2).map((pattern) => ({
    downstep: pattern.downstep,
    morae: pitchMorae(reading, pattern.downstep).map((mora) => ({ ...mora, text: inPreferredScript(mora.text) })),
  }));
});

// 5, 6, 7. Senses, the kanji the headword is written with, and examples.
const senses = computed(() => cardSenses(word.value, glossLanguages.value));
const examples = computed(() => cardExamples(word.value, glossLanguages.value));
const kanjiChips = computed(() =>
  kanjiIn(headword.value).map((character) => ({
    character,
    href: shirabeKanjiUrl(character, glossLanguages.value.labels),
  })),
);

// A translation covered by a spoiler, keyed by the row it sits in. The examples
// belong to whichever word is hovered, so the key is only good for as long as
// the card is: `onTokenEnter` empties it.
const revealedTranslations = reactive(new Set<string>());
const translationKey = (index: number, lang: string) => `${index}-${lang}`;
const isTranslationRevealed = (index: number, lang: string) => revealedTranslations.has(translationKey(index, lang));

const toggleTranslationReveal = (index: number, lang: string) => {
  const key = translationKey(index, lang);
  if (revealedTranslations.has(key)) revealedTranslations.delete(key);
  else revealedTranslations.add(key);
};

// Clicking a word in an example searches Nadeshiko for it, not Shirabe: the
// reader asking about 注意 in an example sentence wants to hear it said, which
// is what this site is for. The dictionary is a click away on the headword.
// Same emit the tokens in the sentence itself use, so it is the router that
// navigates and the page never reloads. The card came off a sentence that is
// about to be replaced, so it closes on the way out.
const searchExampleToken = (query: string) => {
  closeTooltip();
  emit('token-click', query);
};

const dictionaryLinks = computed(() => {
  const token = hoveredToken.value;
  if (!token) return [];
  return presets
    .filter((preset) => isDictionaryEnabled(preset.id))
    .map((preset) => ({
      id: preset.id,
      label: preset.label,
      // Shirabe's id for this word is the slug of its own page, so hand it over
      // once the card has it: it names the homograph the surface cannot.
      href: preset.buildUrl(token.dictForm, token.reading ?? '', word.value?.id),
    }));
});
</script>

<template>
  <span lang="ja" class="token-text">
    <template v-for="token in enrichedTokens" :key="token.b">
      <span
        class="token"
        :class="[
          POS_CLASS[token.p] ?? '',
          {
            'token--match': token.matchType === 'match',
            // A match that covers only part of this token: Elasticsearch found
            // it with its own analyzer, which cuts words where we do not.
            'token--compound': token.matchType === 'partial',
          },
        ]"
        @click.stop="onTokenEnter(token, $event)"
      ><template v-if="furiganaMode !== 'hidden'"><template v-for="(seg, si) in token.furigana" :key="si"><ruby v-if="seg.reading" :class="{ 'furigana--spoiler': furiganaMode === 'spoiler' }">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template><template v-else>{{ token.displaySurface }}</template></span>
    </template>

    <Transition name="tooltip">
      <div
        v-if="hoveredToken"
        ref="tooltipRef"
        class="token-tooltip"
        :class="{ 'token-tooltip--below': tooltipBelow }"
        :style="tooltipStyle"
        @click.stop
      >
        <div class="token-tooltip__head">
          <!-- The headword searches Nadeshiko for the word, in place: the reader
               is here for sentences, and this is the biggest thing on the card.
               The dictionaries live in the chips at the foot, which leave the
               site, so the two kinds of destination never share an appearance. -->
          <component
            :is="hoveredToken ? 'button' : 'span'"
            v-bind="hoveredToken ? { type: 'button' } : {}"
            class="token-tooltip__word"
            :class="{ 'token-tooltip__word--action': hoveredToken }"
            lang="ja"
            @click="hoveredToken && searchExampleToken(hoveredToken.searchText)"
          >
            <template v-if="headFurigana.length > 0"><template v-for="(seg, si) in headFurigana" :key="si"><ruby v-if="seg.reading">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template>
            <template v-else>{{ headword }}</template>
          </component>
          <span v-if="headReading && headFurigana.length === 0" class="token-tooltip__reading">{{ headReading }}</span>
        </div>

        <p v-if="inflectionLine" class="token-tooltip__inflection">{{ inflectionLine }}</p>

        <div v-if="badges.length > 0" class="token-tooltip__badges">
          <span v-for="badge in badges" :key="badge.id" class="token-tooltip__badge" :class="badge.kind">{{ badge.text }}</span>
        </div>

        <div class="token-tooltip__body">
          <div v-if="pitchPatterns.length > 0" class="token-tooltip__pitch">
            <span v-for="(pattern, pi) in pitchPatterns" :key="pi" class="token-tooltip__pitch-pattern">
              <span
                v-for="(mora, mi) in pattern.morae"
                :key="mi"
                class="token-tooltip__mora"
                :class="{ 'is-high': mora.high, 'is-drop': mora.drop }"
              >{{ mora.text }}</span>
              <span class="token-tooltip__downstep">[{{ pattern.downstep }}]</span>
            </span>
          </div>

          <ol v-if="senses.length > 0" class="token-tooltip__senses">
            <li v-for="(sense, si) in senses" :key="si" class="token-tooltip__sense">
              <span v-if="sense.partsOfSpeech.length > 0 || sense.tags.length > 0" class="token-tooltip__chips"><span
                v-for="chip in sense.partsOfSpeech"
                :key="`p-${chip.label}`"
                class="token-tooltip__chip token-tooltip__chip--pos"
                :title="chip.title"
              >{{ chip.label }}</span><span
                v-for="chip in sense.tags"
                :key="`t-${chip.label}`"
                class="token-tooltip__chip"
                :class="`token-tooltip__chip--${chip.category}`"
                :title="chip.title"
              >{{ chip.label }}</span></span>
              <span v-for="row in sense.glosses" :key="row.lang" class="token-tooltip__gloss-row">
                <span class="token-tooltip__lang">{{ row.label }}</span>{{ row.text }}
              </span>
            </li>
          </ol>
          <p v-else-if="wordState === 'loading'" class="token-tooltip__pending">
            <span class="token-tooltip__spinner" aria-hidden="true" />
            <span>{{ $t('tokenTooltip.loading') }}</span>
          </p>

          <div v-if="kanjiChips.length > 0" class="token-tooltip__kanji">
            <a
              v-for="chip in kanjiChips"
              :key="chip.character"
              :href="chip.href"
              target="_blank"
              rel="noopener noreferrer"
              class="token-tooltip__kanji-link"
            >{{ chip.character }}</a>
          </div>

          <div v-if="examples.length > 0" class="token-tooltip__examples">
            <div v-for="(example, ei) in examples" :key="ei" class="token-tooltip__example">
              <span lang="ja" class="token-tooltip__example-jp"><template v-if="example.tokens.length > 0"><template v-for="(token, ti) in example.tokens" :key="ti"><span v-if="token.query" class="token-tooltip__example-token" :class="{ 'is-matched': token.matched }" @click="searchExampleToken(token.query)">{{ token.text }}</span><span v-else :class="{ 'is-matched': token.matched }">{{ token.text }}</span></template></template><template v-else>{{ example.japanese }}</template></span>
              <ul v-if="example.translations.length > 0" class="m-0 mt-1 w-full list-none space-y-1 p-0 text-gray-400">
                <li v-for="row in example.translations" :key="row.lang" class="flex items-center gap-2 text-xs transition-opacity duration-200">
                  <span
                    class="token-tooltip__lang"
                    :class="row.mode === 'spoiler' ? 'is-spoiler' : ''"
                  >{{ row.label }}</span>
                  <div class="min-w-0 flex-1">
                    <span
                      class="group/translation"
                      :class="row.mode === 'spoiler' && !isTranslationRevealed(ei, row.lang) ? 'cursor-pointer' : ''"
                      @click="row.mode === 'spoiler' && toggleTranslationReveal(ei, row.lang)"
                    >
                      <span
                        class="inline rounded-sm px-1 py-1 leading-snug transition-colors duration-200"
                        :class="row.mode === 'spoiler' && !isTranslationRevealed(ei, row.lang)
                          ? 'bg-neutral-700/85 text-transparent [@media(hover:hover)]:group-hover/translation:bg-transparent [@media(hover:hover)]:group-hover/translation:text-gray-400'
                          : 'bg-transparent text-gray-400'"
                      >{{ row.text }}</span>
                    </span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Its own row, not gated on the dictionary list: it is not a
             dictionary, and a reader who turned every dictionary off would
             otherwise lose the one link that stays on this site. Styled apart
             from the chips beside it because it navigates in place while every
             one of them opens a tab. -->
        <div v-if="hoveredToken" class="token-tooltip__actions">
          <button
            type="button"
            class="token-tooltip__action"
            @click="searchExampleToken(hoveredToken.searchText)"
          >{{ $t('tokenTooltip.moreSentences') }}</button>
        </div>

        <div v-if="dictionaryLinks.length > 0" class="token-tooltip__links">
          <span class="token-tooltip__links-label">{{ $t('tokenTooltip.lookupIn') }}</span>
          <a
            v-for="link in dictionaryLinks"
            :key="link.id"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="token-tooltip__link"
          >{{ link.label }}</a>
        </div>
      </div>
    </Transition>
  </span>
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


.token--match {
  color: #df848d;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.token--compound {
  color: #df848d;
  opacity: 0.7;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

/* The word card: head, inflection and badges pinned, the reading matter
   scrolling under them, dictionary links pinned at the foot. */
.token-tooltip {
  --tt-surface: rgb(30 30 30);
  --tt-surface-soft: rgb(24 24 24);
  --tt-line: rgb(60 60 60);
  --tt-ink: rgb(232 232 232);
  --tt-ink-muted: rgb(168 168 168);
  --tt-ink-faint: rgb(138 138 138);
  --tt-accent: #df848d;

  position: fixed;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  width: max-content;
  max-width: min(340px, calc(100vw - 24px));
  max-height: min(52vh, 420px);
  padding: 10px 0;
  background: var(--tt-surface);
  border: 1px solid var(--tt-line);
  border-radius: 12px;
  z-index: 50;
  text-align: left;
  white-space: normal;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.token-tooltip--below {
  transform: translate(-50%, 0);
}

.token-tooltip__head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 14px;
}

.token-tooltip__word {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
  color: white;
  text-decoration: none;
}

a.token-tooltip__word {
  cursor: pointer;
}

a.token-tooltip__word:hover {
  color: var(--tt-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.token-tooltip__reading {
  font-size: 13px;
  color: var(--tt-accent);
}

.token-tooltip__inflection {
  flex: 0 0 auto;
  margin: 4px 0 0;
  padding: 0 14px;
  font-size: 12px;
  color: var(--tt-ink-faint);
}

.token-tooltip__badges {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
  padding: 0 14px;
}

.token-tooltip__badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}

.token-tooltip__badge.is-common {
  background: rgb(34 60 42);
  color: rgb(150 219 170);
}

.token-tooltip__badge.is-jlpt {
  background: rgb(38 52 66);
  color: rgb(158 197 236);
}

.token-tooltip__badge.is-freq {
  background: rgb(48 48 48);
  color: var(--tt-ink-muted);
  font-variant-numeric: tabular-nums;
}

.token-tooltip__body {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px;
}

/* One mora per cell, an overline over the high ones and a fall after the
   downstep: the same reading as Shirabe's own pitch diagram. */
.token-tooltip__pitch {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 8px;
}

.token-tooltip__pitch-pattern {
  display: inline-flex;
  align-items: baseline;
}

.token-tooltip__mora {
  padding: 1px 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--tt-ink);
  border-top: 2px solid transparent;
}

.token-tooltip__mora.is-high {
  border-top-color: var(--tt-accent);
}

.token-tooltip__mora.is-drop {
  border-right: 2px solid var(--tt-accent);
}

.token-tooltip__downstep {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--tt-ink-faint);
  font-variant-numeric: tabular-nums;
}

.token-tooltip__senses {
  margin: 8px 0 0;
  padding-left: 18px;
  list-style: decimal;
}

.token-tooltip__sense {
  margin: 5px 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--tt-ink);
}

.token-tooltip__sense::marker {
  color: var(--tt-ink-faint);
}

/* Chips rather than a run-on line of prose. JMdict's own labels repeat
   themselves ("noun (common) (futsuumeishi)"), so the chip prints the short form
   keyed off the tag code and keeps the full wording in its `title`. Coloured by
   category so a usage qualifier never reads as a part of speech -- the same
   split Shirabe makes between its POS and qualifier chips. */
.token-tooltip__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 3px;
}

.token-tooltip__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  color: var(--tt-ink-faint);
}

.token-tooltip__chip--pos {
  color: var(--tt-accent, #f472b6);
}

.token-tooltip__chip--field {
  color: #60a5fa;
}

.token-tooltip__chip--dialect {
  color: #a78bfa;
}

.token-tooltip__pending {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--tt-ink-faint);
}

.token-tooltip__kanji {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}

.token-tooltip__kanji-link {
  min-width: 30px;
  padding: 3px 7px;
  border: 1px solid var(--tt-line);
  border-radius: 7px;
  font-size: 17px;
  line-height: 1.2;
  text-align: center;
  color: var(--tt-ink);
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__kanji-link:hover {
  background: rgba(223, 132, 141, 0.14);
  border-color: var(--tt-accent);
  color: var(--tt-accent);
}

/* Smaller than the segment's own EN/ES badges: this one sits inside a popup
   that is already a card on top of a card, and at the segment's size it read as
   the loudest thing in it. */
/* A hover is a question, and an empty card for a beat reads as "no answer" when
   it means "asking". Cheap enough to show every time rather than after a delay:
   a cached word never reaches this state at all, it renders straight away. */
.token-tooltip__pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: rgb(150 150 150);
}

.token-tooltip__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgb(90 90 90);
  border-top-color: rgb(190 190 190);
  border-radius: 50%;
  animation: token-tooltip-spin 0.7s linear infinite;
}

@keyframes token-tooltip-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .token-tooltip__spinner {
    animation-duration: 2.4s;
  }
}

.token-tooltip__lang {
  display: inline-flex;
  min-width: 1.55rem;
  justify-content: center;
  margin-right: 6px;
  padding: 1px 4px;
  border: 1px solid var(--tt-line);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 1.4;
  color: rgb(165 165 165);
  vertical-align: 1px;
}

.token-tooltip__lang.is-spoiler {
  color: rgb(140 140 140);
}

.token-tooltip__gloss-row {
  display: block;
}

.token-tooltip__gloss-row + .token-tooltip__gloss-row {
  margin-top: 2px;
}

.token-tooltip__examples {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--tt-line);
}

.token-tooltip__example {
  margin: 6px 0;
}

.token-tooltip__example-jp {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  color: var(--tt-ink);
}

/* A content word in an example: clicking it searches Nadeshiko for that word.
   Punctuation and grammar render bare, so nothing invites a click that would
   answer nothing. */
.token-tooltip__example-token {
  cursor: pointer;
  border-radius: 2px;
  transition: background-color 0.15s ease;
}

.token-tooltip__example-token:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

/* The word the card is about, wherever it sits in the sentence. */
.token-tooltip__example-jp .is-matched {
  color: var(--tt-accent);
  font-weight: 600;
}

/* The one destination that stays on Nadeshiko, so it reads as an action rather
   than as another entry in the dictionary list: full width, filled, above the
   chips instead of among them. */
.token-tooltip__actions {
  flex: 0 0 auto;
  display: flex;
  margin-top: 10px;
  padding: 8px 14px 0;
  border-top: 1px solid var(--tt-line);
}

.token-tooltip__action {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--tt-accent, #f472b6) 34%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--tt-accent, #f472b6) 14%, transparent);
  color: var(--tt-accent, #f472b6);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
}

.token-tooltip__action:hover {
  background: color-mix(in srgb, var(--tt-accent, #f472b6) 24%, transparent);
}

/* The headword navigates too, so it has to look like it does -- but quietly:
   it is the title of the card first and a link second. */
.token-tooltip__word--action {
  border: 0;
  padding: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.token-tooltip__word--action:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.token-tooltip__links {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 14px 0;
  border-top: 1px solid var(--tt-line);
}

.token-tooltip__links-label {
  font-size: 11px;
  color: var(--tt-ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.token-tooltip__link {
  font-size: 12px;
  color: rgb(180 200 230);
  text-decoration: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__link:hover {
  background: rgba(255, 255, 255, 0.14);
  color: white;
}

.tooltip-enter-active {
  transition: opacity 0.12s ease;
}

.tooltip-leave-active {
  transition: opacity 0.08s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
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
