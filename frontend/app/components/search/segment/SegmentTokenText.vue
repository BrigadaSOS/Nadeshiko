<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import { enrichTokens, type SlimToken, type EnrichedToken } from '~/utils/tokenEnrichment';
import { tabStop, tokenKeyAction } from '~/utils/tokenNavigation';
import {
  cardHeadword,
  candidatePartOfSpeech,
  candidateName,
  candidateSummary,
  dictionaryKey,
  glossPreference,
  // The same three names that ride out to Shirabe as `utm_content`, reused here
  // rather than restated: the click we record and the visit Shirabe records are
  // then labelled identically, so the two sides reconcile per surface instead of
  // only in total.
  type ShirabeLinkSurface,
} from '~/utils/wordCard';
import type { DictionaryId } from '~/composables/useDictionaryLinks';
import { minedWord } from '~/utils/ankiWord';
import { createSegmentTaps } from '~/utils/segmentTaps';
import { fetchWord, peekWord, type WordLookup } from '~/utils/wordLookup';
// Two different verbs, so two different shapes. These sit side by side at 16px,
// where `mdiStarCheckOutline` and `mdiStarPlusOutline` -- the pair that was here
// -- were one star with a smudge in the corner: the reader could not tell "show
// me the card I already have" from "put this sentence on it" without reading
// both tooltips.
//
// `mdiFileDocumentPlusOutline` is the same mark the segment menu's Anki entries
// use for adding, so the two places that mine agree with each other.
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiFileDocumentCheckOutline,
  mdiFileDocumentPlusOutline,
  mdiImagePlusOutline,
  mdiOpenInNew,
} from '@mdi/js';
import type { SearchResult } from '~/types/search';
// Import the queued singleton: usePostHog needs Nuxt context, which detached post-await continuations do not
// retain.
import { posthog } from '~/utils/posthogClient';
import { NESTED_IN_TOKEN_TOOLTIP_KEY } from '~/composables/useDropdownState';

type Props = {
  tokens: Token[];
  highlight?: string;
  /**
   * The segment these tokens came from, which the card mines into Anki.
   *
   * Optional because the sentence renders perfectly well without it and this
   * component has no other use for it -- a caller that only wants words to be
   * clickable owes nothing. The Anki controls simply do not appear.
   */
  result?: SearchResult;
};

const props = defineProps<Props>();
const { t, locale } = useI18n();
const router = useRouter();
const localePath = useLocalePath();

// This capability flag suppresses requests without a Shirabe key, not token-only cards. Runtime NUXT_PUBLIC_*
// overrides bypass build-time zod parsing, so accept only true or "true", never arbitrary truthy strings.
const isOn = (value: unknown): boolean => value === true || value === 'true';

const config = useRuntimeConfig().public;
const lookupsEnabled = isOn(config.shirabeLookups);
const emit = defineEmits<{
  'token-click': [dictionaryForm: string];
}>();

const enrichedTokens = computed<EnrichedToken[]>(() => {
  return enrichTokens(props.tokens as SlimToken[], props.highlight);
});

const { closeAllDropdowns, tokenTooltipEpoch, isTokenTooltipOpen } = useDropdownState();
provide(NESTED_IN_TOKEN_TOOLTIP_KEY, true);

/** Preserve raw token identity for re-click-to-close. A deep ref proxies immutable tokens and breaks equality
 * with enrichedTokens.
 */
const hoveredToken = shallowRef<EnrichedToken | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
let hoveredElement: HTMLElement | null = null;

const { tooltipStyle, tooltipBelow, placeTooltip } = useCardPlacement(
  () => hoveredElement,
  () => hoveredToken.value !== null,
);

// How long a pointer has to rest on a word before it is worth asking about it.
// Long enough that crossing a sentence costs nothing, short enough that it is
// still ahead of the click that follows.
const PREFETCH_DELAY = 140;

// What the reader reads, which is not what the interface is in: the UI language
// and the translation language are separate settings, and only this one decides
// what a definition is worth showing in. Same preference the segment
// translations obey, so a reader who turned English off gets no English here.
const { englishMode, spanishMode } = useTranslationVisibility();
// The DICTIONARY order, which a linked Shirabe account decides rather than the
// account setting: see `dictionaryGlossLanguages`.
const { dictionaryGlossLanguages: globalGlossLanguages } = useTranslationLanguages();

// How large the definitions are printed, which the reader chooses in settings.
// A CSS variable on the card root rather than a class per size: one declaration
// reads it (`--definition-size`), and the sizes themselves live in one module
// beside the control that offers them.
const definitionFont = computed(() => definitionFontSize(userStore().preferences?.wordPopup?.definitionSize));
const revealDefinitions = ref(false);
const definitionModes = computed(() => ({
  en: revealDefinitions.value ? 'show' : englishMode.value,
  es: revealDefinitions.value ? 'show' : spanishMode.value,
}));
const glossLanguages = computed(() => glossPreference(locale.value, definitionModes.value, globalGlossLanguages.value));
const hiddenDefinitionLanguages = computed(() =>
  globalGlossLanguages.value.filter((language) => definitionModes.value[language] === 'hidden'),
);

/** Shirabe returns ranked candidates, not one definitive word. The server route keeps credentials private;
 * the wordLookup module cache reuses answers across segment instances.
 */

const { showCandidateRows, posInitial, duplicateHeadwords, visibleCandidates, hiddenCandidateCount, isNameCandidate } =
  useCandidateChips(
    () => candidates.value,
    () => picked.value,
    () => glossLanguages.value,
  );

const { candidates, picked, othersOpen, wordState, word, clearLookup, lookUp, cancelPending } =
  useWordLookup(
    () => glossLanguages.value.labels,
    // Ask Anki again, about the word the dictionary just named. The probe fires
    // when the card OPENS, which is before the lookup lands, so it asks about the
    // token's own dictionary form; without this follow-up a word the reader
    // already had read as new whenever AnkiConnect answered before Shirabe did.
    () => void probeMined(),
  );

const headword = computed(() => cardHeadword(word.value, hoveredToken.value?.dictForm));

const {
  headReading,
  headFurigana,
  inflectionLine,
  badges,
  pitchPatterns,
  senses,
  namesSources,
  wordParts,
  forms,
  definitionsAreHidden,
  kanjiChips,
} = useWordCardContent(
  () => word.value,
  () => hoveredToken.value,
  () => headword.value,
  () => glossLanguages.value,
  () => hiddenDefinitionLanguages.value,
  () => userStore().shirabeLinked,
);

/** Mining uses local AnkiConnect and stays hidden without a configured profile; see useWordMining for cache
 * constraints.
 */

/** Mine the current candidate's dictionary form, not the inflected surface. headword falls back to the token
 * until lookup resolves.
 */
const miningWord = computed(() => headword.value);

/** Render the note from the card's live refs so it matches visible languages, senses and caps. useWordMining
 * reads a getter because lookup results can arrive after the card opens.
 */
const minedCard = computed(() =>
  // The sentence goes in so the note can mark WHICH word was mined. Taken from
  // the result rather than from the tokens, because the token offsets address
  // exactly this string.
  minedWord(
    word.value,
    hoveredToken.value,
    glossLanguages.value,
    props.result?.segment.textJa.content ?? '',
    pickedForExport.value,
  ),
);

const {
  minedNoteId,
  mining,
  canConfigureMine,
  mineBlockedReason,
  mineReady,
  mapsDefinition,
  probeMined,
  clearMined,
  openMinedNote,
  mineSentence,
} = useWordMining(
  () => props.result,
  () => miningWord.value,
  () => minedCard.value,
);

/** How many distinct words the reader has opened in THIS sentence, which is the
 *  number that decides whether the lookup should batch. One per component
 *  instance, and there is one instance per segment. */
const segmentTaps = createSegmentTaps();

const NOT_A_WORD = new Set(['symbol', 'whitespace']);
const HAS_JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

/** Ask with lemma plus surface: grammar such as なら must not resolve only to its lemma だ. Skip punctuation,
 * whitespace and bare digits, which cannot have dictionary entries.
 */
function isAskable(token: EnrichedToken): boolean {
  return !NOT_A_WORD.has(token.kind ?? '') && HAS_JAPANESE.test(token.d ?? '');
}

async function loadWord(token: EnrichedToken): Promise<void> {
  // Not configured: no key on the server, so there is nothing to ask. Leaving
  // the request out entirely beats firing one that 503s on every hover and
  // caching the failure, and the card still answers from the token alone.
  if (!lookupsEnabled || !isAskable(token)) {
    clearLookup();
    return;
  }

  // A card opening on a token is standing at the start of its own trail, however
  // far the previous card wandered.
  clearTrail();

  const outcome = await lookUp(token.lookupRef);
  // Null means a later word superseded this one; that is not an outcome to
  // record, and the request that replaced it owns the card now.
  if (outcome) reportCardOutcome(token, outcome.answer, outcome.fromCache);
  // Deliberately no re-placement here. The card has just grown from one line to
  // its full height, but where it goes was settled against its maximum size when
  // it opened, so it grows into room already reserved for it.
}

/** Measure rendered definitions, not fetch success: gloss filtering can leave a valid entry with no visible
 * senses. Exclude disabled/unaskable tokens because no dictionary lookup occurred.
 */
function reportCardOutcome(token: EnrichedToken, answer: WordLookup, fromCache: boolean): void {
  const ref = token.lookupRef;
  posthog.capture('word_card_opened', {
    outcome: answer.candidates.length > 0 ? (senses.value.length > 0 ? 'shown' : 'no_senses') : answer.reason,
    // How much ambiguity the reader was handed. A card that led with the right
    // word out of one is not the same result as a card that led with the right
    // word out of five, and only this separates them.
    candidate_count: answer.candidates.length,
    // The work queue for dictionary coverage lives in this field: the words that
    // come back 'missing' most often, weighted by how often they turn up.
    lemma: ref.lemma,
    // Whether a miss is a proper noun (expected, uninteresting) or a verb the
    // dictionary should have had.
    pos: ref.pos || null,
    // The language the DEFINITIONS were wanted in, which is what decides whether
    // an entry renders at all. `labels` is only the language of the chips, and
    // reading the rates by it would attribute an empty card to the wrong
    // preference.
    gloss_locale: glossLanguages.value.order[0] ?? null,
    label_locale: glossLanguages.value.labels,
    // A reader re-opening a word the page already answered is not the dictionary
    // answering again. Left unmarked it flatters every rate here, because the
    // cache only ever holds the answers that succeeded.
    from_cache: fromCache,
    // How many DISTINCT words the reader has opened in this sentence, this one
    // included. The whole batching question is the share of opens where this is
    // 2 or more: identify costs about the same for a sentence as for a word, so
    // batching is free in latency and expensive in bytes, and only a reader who
    // opens several words per sentence makes that trade worth taking.
    taps_in_segment: segmentTaps.record(props.result?.segment.textJa.content ?? '', ref.lemma),
    // The denominator. A sentence of four words that gets two taps is a very
    // different result from a sentence of twenty that gets two, and only this
    // separates them.
    askable_tokens: enrichedTokens.value.filter(isAskable).length,
  });
}

/** Warm the shared, deduplicated cache on a resting pointer so clicks can open with an answer already
 * available.
 */
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

const onTokenHover = (token: EnrichedToken) => {
  if (!lookupsEnabled) return;

  // Delay until the pointer rests; fetching every crossed token would queue the clicked word behind unwanted
  // requests.
  if (prefetchTimer !== null) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    if (!isAskable(token)) return;
    const ref = token.lookupRef;
    const locale = glossLanguages.value.labels;
    if (peekWord(ref, locale) !== undefined) return;
    void fetchWord(ref, locale);
  }, PREFETCH_DELAY);
};

const onTokenHoverEnd = () => {
  if (prefetchTimer === null) return;
  clearTimeout(prefetchTimer);
  prefetchTimer = null;
};

const onTokenEnter = (token: EnrichedToken, event: MouseEvent | KeyboardEvent) => {
  // Was a `.stop` on the template binding, moved here because a modifier cannot
  // be conditional and this must not swallow a click the card is not going to
  // use: the search dropdowns close on a document click, so stopping one on
  // behalf of a card that never opens would leave one hanging. Mouse only, which
  // is all the modifier ever covered; the keyboard path reaches here from
  // `onTokenKeydown`.
  if (event instanceof MouseEvent) event.stopPropagation();

  // Re-clicking the open token closes it, so a click is its own undo.
  if (hoveredToken.value === token) {
    closeTooltip();
    return;
  }
  // Token clicks stop before they reach the document, so an open search
  // dropdown would not see this as an outside click. Close it here instead,
  // otherwise the word card and the Add/Copy/… menu sit on screen together.
  closeAllDropdowns();
  isTokenTooltipOpen.value = true;
  revealDefinitions.value = false;
  hoveredToken.value = token;
  hoveredElement = event.currentTarget as HTMLElement;
  stopHeadword();
  // Placed before the lookup rather than after it: `loadWord` paints a cached
  // answer synchronously, and the card should already know where it lives by
  // then. Either way the side is the same, because it does not depend on what
  // is in it.
  placeTooltip();
  void loadWord(token);
  // Alongside the dictionary lookup rather than after it: the two answer
  // different services (ours, and Anki on this machine) and neither waits on the
  // other, so a card whose definition is still in flight can already say the
  // word is mined.
  void probeMined();

  // Only a keyboard opener gets its focus moved. Doing it for a mouse click
  // would paint a focus ring on a card nobody navigated to, and take focus off
  // whatever the reader had it on.
  if (openedByKeyboard) {
    void nextTick(() => tooltipRef.value?.focus());
  }
};

/** How the open card was opened, which decides whether closing it owes the
 *  reader their focus back. Reset by `closeTooltip`, so it never leaks from a
 *  keyboard open into the next pointer one. */
let openedByKeyboard = false;

const closeTooltip = () => {
  // Hand focus back to the word it came from, so Escape returns the reader
  // where they were rather than dropping them at the top of the document. Only
  // for a card they navigated into: a mouse user's focus was never taken.
  const returnTo = openedByKeyboard ? hoveredElement : null;
  openedByKeyboard = false;

  hoveredToken.value = null;
  hoveredElement = null;
  isTokenTooltipOpen.value = false;
  stopHeadword();
  if (returnTo?.isConnected) returnTo.focus();
  // Reset, so the next open never inherits this one's tail. A request abandoned
  // in flight (the reader closed the card before it answered) returns early
  // without touching `wordState`, which used to leave it reading 'loading'
  // forever -- the card reopened stuck on "Looking up…" until something else
  // happened to reset it.
  clearLookup();
  clearTrail();
  clearPicked();
  revealDefinitions.value = false;
  cancelPending();
  clearMined();
};

/** A pick controls both displayed word and mined note. Do not persist it: dictionary rankings and identity
 * rules evolve.
 */
const pickCandidate = (index: number) => {
  if (index === picked.value) return;
  const chosen = candidates.value[index];
  if (!chosen) return;

  posthog.capture('word_card_candidate_picked', {
    // The rate of this against `candidates[0]` is the direct measure of how
    // often Shirabe's leading answer was the right one, and it is the one
    // signal their side cannot get from its own traffic.
    lemma: hoveredToken.value?.lookupRef.lemma ?? null,
    pos: hoveredToken.value?.lookupRef.pos || null,
    from_index: picked.value,
    to_index: index,
    candidate_count: candidates.value.length,
  });

  picked.value = index;
  // Another candidate is another word, with its own senses behind the same row
  // numbers. Whatever was ticked described the word the reader just moved off.
  clearPicked();

  // Deliberately does NOT scroll. The definition lives at the top of the card
  // and the list at the bottom, so following the pick would take the reader off
  // the list they are still choosing from -- and following it back on the next
  // arrow key would fight them. The highlight moving IS the feedback that the
  // pick landed; reading the result is one scroll they chose to make.

  // Ask Anki again, about the word the reader just chose. `useWordMining` reads
  // `currentWord` through a getter at call time rather than watching it, so
  // moving the pick does not re-probe on its own -- and a star left over from
  // the previous candidate is a claim about the reader's collection that is
  // simply untrue. Its own staleness guards drop whichever probe lands late.
  void probeMined();
};

/** Clicking a list choice collapses to chips; arrow-key picks keep the list mounted so keyboard focus is not
 * destroyed.
 */
function pickFromList(index: number): void {
  pickCandidate(index);
  othersOpen.value = false;
}

/** Reuse tokenKeyAction for both axes and non-wrapping ends. Selection follows focus so arrowing reads each
 * definition.
 */
const onCandidateKeydown = (index: number, event: KeyboardEvent) => {
  const action = tokenKeyAction(
    event.key,
    candidates.value.map((_, position) => position),
    index,
  );
  if (!action) return;

  // 'hold' included: an arrow at the end of the row is still this widget's key,
  // and letting it through would scroll the card out from under the reader.
  event.preventDefault();
  if (action.type === 'open') {
    pickCandidate(index);
  } else if (action.type === 'move') {
    pickCandidate(action.to);
    void nextTick(() => {
      tooltipRef.value?.querySelector<HTMLElement>(`[data-candidate="${action.to}"]`)?.focus();
    });
  }
};

// A search menu (Add, Copy, visibility, recents, …) opened elsewhere. The Anki
// menu inside this card opts out via `preserveTokenTooltip`, so it does not
// bump the generation and does not land here.
watch(tokenTooltipEpoch, () => {
  if (hoveredToken.value) closeTooltip();
});

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

// Nothing re-anchors on scroll. The card is placed on the page, so it moves with
// the sentence and scrolls out of sight like any other content -- which is what
// a reader expects of something attached to a word, and it means scrolling can
// never leave it pointing at a word that has moved. Resize is the exception, and
// only in one dimension -- and it is not registered here, because one listener
// serves the whole page rather than one per sentence.
//
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  // Unconditional: `removeEventListener` for a listener that was never added is
  // a no-op, and matching the flag here would strand the listeners if it ever
  // changed between mount and unmount.
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
});

/** Rove one tab stop per sentence with arrow keys; making every word tabbable would impose thousands of stops.
 * Only askable tokens participate.
 */
const rootRef = ref<HTMLElement | null>(null);

// Both the roving tab stop and the button role hang off this, which is what we
// want: punctuation and grammar open no dialog, so they must not announce
// themselves as controls that do. They stay text -- still clickable, as they
// have always been, but not focusable and not `aria-expanded`.
const isLookupable = (token: EnrichedToken): boolean => isAskable(token);

// `b` is the token's byte offset in the sentence: unique within it, stable
// across the re-renders that rebuild the token objects, and already the v-for
// key. So it is what the roving tab stop is tracked by.
const navigableKeys = computed(() => enrichedTokens.value.filter(isLookupable).map((token) => token.b));

/** Which token currently holds the sentence's tab stop. Null until the reader
 *  has moved, and then the first navigable word answers -- so a sentence never
 *  has zero tab stops, which would drop it out of the tab order entirely. */
const rovingKey = ref<number | null>(null);

const tabStopKey = computed(() => tabStop(navigableKeys.value, rovingKey.value));

function focusToken(key: number): void {
  rovingKey.value = key;
  // Focus after the tabindex has actually moved: an element still carrying
  // tabindex="-1" would take focus but leave the tab order pointing elsewhere.
  void nextTick(() => {
    rootRef.value?.querySelector<HTMLElement>(`[data-token="${key}"]`)?.focus();
  });
}

/** The DOM half of the walk. Which token a press means is `tokenKeyAction`,
 *  where it can be tested; this only carries the answer out. */
const onTokenKeydown = (token: EnrichedToken, event: KeyboardEvent) => {
  const action = tokenKeyAction(event.key, navigableKeys.value, token.b);
  if (!action) return;

  // Everything the widget claims is claimed fully, 'hold' included: an arrow at
  // the end of a sentence must not fall through and scroll the page.
  event.preventDefault();
  if (action.type === 'open') {
    openedByKeyboard = true;
    onTokenEnter(token, event);
  } else if (action.type === 'move') {
    focusToken(action.to);
  }
};

const POS_CLASS: Record<string, string> = {
  動詞: 'token--verb',
  名詞: 'token--noun',
  形容詞: 'token--adjective',
  副詞: 'token--adverb',
  助詞: 'token--particle',
  助動詞: 'token--auxiliary',
};

const { furiganaMode } = useHiraganaVisibility();
const { presets, isDictionaryEnabled } = useDictionaryLinks();

const { playingUrl, playHeadword, stopHeadword } = useHeadwordAudio();

/** Track dictionary picks by key, not sense index: gloss-language changes can drop and renumber senses. Clear
 * picks whenever the word changes so one word's selection cannot trim another word's exported definition.
 */
const {
  pickedDictionaries,
  clearPicked,
  togglePick,
  selectAllDictionaries,
  deselectAllDictionaries,
  canSelectAllDictionaries,
  canPickDictionaries,
  pickedForExport,
  pickSummary,
} = useDictionarySelection(
  () => senses.value,
  // A pick with nowhere to go is a control that does nothing: a reader with no
  // Anki profile would be ticking dictionaries into the void, and so would one
  // whose profile writes no definition anywhere.
  () => canConfigureMine.value && !!props.result && mapsDefinition.value,
  (count, total) => t('tokenTooltip.pickedDictionaries', { count, total }),
);

/** The card's own lookup, shared by the parts row and both history controls, so
 *  all three paint an answer the same way and guard staleness the same way. */
async function loadLocation(location: CardLocation): Promise<void> {
  // Before the cache hit as well as after it: walking into a part is a different
  // word whether or not we already had it, and a pick carried across would trim
  // the new word's definition to the old word's sense numbers.
  clearPicked();

  // Guarded like the hover path, and by the same guard: a slow answer for a word
  // the reader has since navigated away from must not paint over whatever they
  // are looking at now.
  await lookUp(location);
}

/** The token the card opened on, which is where an empty trail points. */
function openedOn(): CardLocation | null {
  const ref = hoveredToken.value?.lookupRef;
  return ref ? { lemma: ref.lemma, surface: ref.surface, reading: ref.reading, pos: ref.pos } : null;
}

const { canGoBack, canGoForward, showPart, goBack, goForward, clearTrail } = useCardTrail(
  loadLocation,
  openedOn,
);

const revealHiddenDefinitions = () => {
  revealDefinitions.value = true;
};

// Searching Nadeshiko for a word, which is what both the headword and "More
// sentences" do: a reader asking about 注意 wants to hear it said, and that is
// what this site is for. The dictionaries are a click away in the chips at the
// foot, and they leave the site -- so the two kinds of destination never share
// an appearance. Same emit the tokens in the sentence itself use, so it is the
// router that navigates and the page never reloads. The card came off a
// sentence that is about to be replaced, so it closes on the way out.
const searchForWord = (query: string) => {
  closeTooltip();
  emit('token-click', query);
};

/**
 * Open the note this word is already on, in Anki.
 *
 * Deliberately does NOT close the card. The reader is being sent to another
 * application and will come back to the same sentence -- most often to press the
 * button beside this one and put it on the note they have just looked at -- so
 * dismissing the card would make them find the word again to do it.
 */
const viewMinedNote = () => {
  posthog.capture('anki_note_viewed_from_card', { lemma: miningWord.value });
  void openMinedNote();
};

const mineThisSentence = () => {
  void mineSentence();
};

/** The sentence, its audio and its still, without touching the word's own
 *  fields -- for a card whose definition the reader wrote themselves. */
const addContextOnly = () => {
  void mineSentence({ wordFields: false });
};

/**
 * What the disabled Anki control says, which is the whole point of it being
 * there rather than absent: a control that vanishes when Anki is closed teaches
 * the reader nothing, and one that just greys out teaches them slightly less.
 * Every branch leads to the same place -- the Anki settings page -- because
 * every one of them is fixed there, including starting Anki, which is where the
 * server address and the add-on are explained.
 */
const mineBlockedMessage = computed(() => {
  switch (mineBlockedReason.value) {
    case 'offline':
      return t('anki.notRunning');
    case 'no-key':
      return t('anki.keyFieldRequired');
    default:
      return t('anki.configRequired');
  }
});

const openAnkiSettings = () => {
  closeTooltip();
  void router.push(localePath('/user/sync'));
};

const dictionaryLinks = computed(() => {
  const token = hoveredToken.value;
  if (!token) return [];
  return (
    presets
      .filter((preset) => isDictionaryEnabled(preset.id))
      // Shirabe first: it is the dictionary this card is already showing, so it is
      // where "more than fits here" leads. The rest keep their configured order.
      // `filter` has already made a fresh array, so the broadly-supported
      // mutating sort cannot alter the presets held by the composable. `toSorted`
      // is newer than browsers we still receive reader traffic from.
      .sort((a, b) => Number(b.required ?? false) - Number(a.required ?? false))
      .map((preset) => ({
        id: preset.id,
        label: preset.label,
        // Shirabe's id for this word is the slug of its own page, so hand it over
        // once the card has it: it names the homograph the surface cannot.
        href: preset.buildUrl(token.dictForm, token.readingHiragana, word.value?.id, glossLanguages.value.labels),
      }))
  );
});

/** Classify the current rendered card at click time; revealing definitions can change no_senses to shown
 * without a fetch. Keep loading separate: leaving before an answer is not a dictionary-coverage failure.
 */
const cardOutcome = computed<'shown' | 'name' | 'no_senses' | 'missing' | 'unavailable' | 'loading' | 'idle'>(() => {
  if (wordState.value === 'loading') return 'loading';
  if (wordState.value === 'missing') return 'missing';
  // Its own bucket, and worth one: a name is neither a definition shown nor a
  // gap in the dictionary, and folding it into either would move a rate that is
  // really a fact about the corpus. Subtitles are full of names.
  if (wordState.value === 'name') return 'name';
  // Reported apart from 'missing' on purpose: one is the dictionary's answer
  // about the word and the other is our failure to ask, and folding them
  // together would read as dictionary coverage collapsing whenever Shirabe has
  // a bad five minutes.
  if (wordState.value === 'unavailable') return 'unavailable';
  if (word.value === null) return 'idle';
  return senses.value.length > 0 ? 'shown' : 'no_senses';
});

/** Capture outcome on each dictionary click to distinguish second opinions from missing-entry handoffs. Include
 * chip position because first-place bias affects Shirabe's share. Links open new tabs, so no beacon is needed.
 */
function reportDictionaryClick(dictionary: DictionaryId, surface: ShirabeLinkSurface, position: number): void {
  const ref = hoveredToken.value?.lookupRef;
  posthog.capture('dictionary_link_clicked', {
    dictionary,
    surface,
    // Whether the reader was leaving the dictionary the card is built from, or
    // leaving it FOR something else. Derivable from `dictionary`, but only if
    // you know which preset is `required`, and that has moved once already.
    left_shirabe: dictionary !== 'shirabe',
    outcome: cardOutcome.value,
    position,
    // How many other dictionaries this reader had switched on. A reader with
    // five enabled leaves for one of them more often than a reader with none
    // does, and that is a preference setting rather than a verdict on the card.
    alternatives_enabled: dictionaryLinks.value.filter((link) => link.id !== 'shirabe').length,
    lemma: ref?.lemma ?? null,
    pos: ref?.pos || null,
    // Same pair `word_card_opened` carries, so the two can be sliced together:
    // an empty card is usually a gloss-language story, and so is leaving one.
    gloss_locale: glossLanguages.value.order[0] ?? null,
    label_locale: glossLanguages.value.labels,
  });
}
</script>

<template>
  <span ref="rootRef" lang="ja" class="token-text">
    <template v-for="token in enrichedTokens" :key="token.b">
      <!-- A button, not a span with a click handler: the whole dictionary used
           to be pointer-only. `aria-label` is the plain surface because the
           ruby inside would otherwise be read out interleaved with it, one
           kana at a time. Only the words worth asking about take a tab stop,
           and only one of them at a time -- see the roving tabindex above. -->
      <!-- biome-ignore lint/a11y/noStaticElementInteractions: role and keys are bound dynamically -->
      <span
        class="token"
        :class="[
          POS_CLASS[token.p] ?? '',
          {
            // Pulled in by an expansion, from the sentence before or after this
            // one. The tint says which half of what is on screen the reader
            // actually searched for -- the job the cyan wrapper span does for the
            // translations, done per token here because the offsets these carry
            // have to keep addressing plain text. See `concatJapanese`.
            'token--context': token.origin === 'before' || token.origin === 'after',
            'token--match': token.matchType === 'match',
            // A match that covers only part of this token: Elasticsearch found
            // it with its own analyzer, which cuts words where we do not.
            'token--compound': token.matchType === 'partial',
            // The word the open card is about. Same condition as `aria-expanded`
            // below, which is the point: the two say the same thing to two
            // different readers.
            'token--open': hoveredToken?.b === token.b,
          },
        ]"
        :data-token="token.b"
        :role="isLookupable(token) ? 'button' : undefined"
        :tabindex="isLookupable(token) ? (token.b === tabStopKey ? 0 : -1) : undefined"
        :aria-label="isLookupable(token) ? token.displaySurface : undefined"
        :aria-expanded="isLookupable(token) ? hoveredToken?.b === token.b : undefined"
        @click="onTokenEnter(token, $event)"
        @keydown="isLookupable(token) && onTokenKeydown(token, $event)"
        @focus="onTokenHover(token)"
        @blur="onTokenHoverEnd"
        @mouseenter="onTokenHover(token)"
        @mouseleave="onTokenHoverEnd"
      ><template v-if="furiganaMode !== 'hidden'"><template v-for="(seg, si) in token.furigana" :key="si"><ruby v-if="seg.reading" :class="{ 'furigana--spoiler': furiganaMode === 'spoiler' }">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template><template v-else>{{ token.displaySurface }}</template></span>
    </template>

    <!-- Teleported to the body so the card escapes the sentence's stacking and
         overflow: it is positioned against the viewport, and a parent that
         clipped it would cut it off at the edge of the row it opened from. -->
    <Teleport to="body">
      <Transition name="tooltip">
        <!-- A dialog, but deliberately not a modal one: the page behind it stays
             readable and usable, which is the point of a word card. `tabindex`
             so a keyboard opener can be dropped into it and Tab can reach the
             links inside; `aria-label` names it by the word it is about. -->
        <!-- biome-ignore lint/a11y/useKeyWithClickEvents: keeps clicks inside from closing the card -->
        <div
          v-if="hoveredToken"
          ref="tooltipRef"
          class="token-tooltip"
          :class="{ 'token-tooltip--below': tooltipBelow }"
          :style="[tooltipStyle, { '--definition-size': definitionFont }]"
          role="dialog"
          aria-modal="false"
          :aria-label="headword"
          tabindex="-1"
          @click.stop
        >
          <div class="token-tooltip__head">
            <!-- The headword searches Nadeshiko for the word, in place: the reader
                 is here for sentences, and this is the biggest thing on the card.
                 The dictionaries live in the chips at the foot, which leave the
                 site, so the two kinds of destination never share an appearance. -->
            <button
              type="button"
              class="token-tooltip__word token-tooltip__word--action"
              lang="ja"
              @click="searchForWord(headword)"
            >
              <template v-if="headFurigana.length > 0"><template v-for="(seg, si) in headFurigana" :key="si"><ruby v-if="seg.reading">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template>
              <template v-else>{{ headword }}</template>
            </button>
            <span v-if="headReading && headFurigana.length === 0" class="token-tooltip__reading">{{ headReading }}</span>

            <!-- Anki, in the corner. Inside the head's flex row and pushed over
                 rather than absolutely positioned, so a long headword can never
                 run underneath the buttons. Nothing renders here without a
                 configured profile, which needs an account -- so this is the one
                 part of the card a signed-out reader never sees.

                 `result` gates it too: the mine sends this SENTENCE, and a
                 caller that did not hand one over has nothing to send. -->
            <!-- Back and forward through the parts the reader has opened. Shown
                 only once there is somewhere to go: a card opened on a word and
                 never navigated is the ordinary case, and two dead arrows on it
                 would be chrome that never does anything.

                 Forward is rendered even when it is dead, but only while back is
                 alive, so the pair does not appear and disappear a control at a
                 time under the cursor. -->
            <span v-if="canGoBack || canGoForward" class="token-tooltip__nav">
              <button
                type="button"
                data-testid="word-back"
                class="token-tooltip__nav-button"
                :disabled="!canGoBack"
                :aria-label="$t('tokenTooltip.back')"
                :title="$t('tokenTooltip.back')"
                @click="goBack"
              >
                <UiBaseIcon :path="mdiChevronLeft" :size="18" />
              </button>
              <button
                type="button"
                data-testid="word-forward"
                class="token-tooltip__nav-button"
                :disabled="!canGoForward"
                :aria-label="$t('tokenTooltip.forward')"
                :title="$t('tokenTooltip.forward')"
                @click="goForward"
              >
                <UiBaseIcon :path="mdiChevronRight" :size="18" />
              </button>
            </span>
            <span v-if="canConfigureMine && result" class="token-tooltip__tools">
              <!--
                One control, whose shape says which situation the reader is in.

                A word that is new to them has exactly one thing to do, so it is
                a button and clicking it does that thing. A word they already
                have has two, and they are easy to confuse at 16px -- looking at
                the card and adding this sentence to it are different verbs with
                no obvious icons -- so those become a menu that names them in
                words. Two bare icons side by side was the version that made
                nobody sure which one they were about to press.
              -->
              <template v-if="mineReady">
              <SearchDropdownContainer
                v-if="minedNoteId !== null"
                dropdownId="nd-word-mine"
                dropdown-container-class="absolute top-full right-0 z-50 w-64 mt-1.5">
                <template #default="{ toggle, isOpen }">
                  <button
                    type="button"
                    data-testid="word-mined-menu"
                    class="token-tooltip__tool is-mined"
                    :disabled="mining"
                    :aria-expanded="isOpen"
                    :aria-label="$t('tokenTooltip.minedActions')"
                    :title="$t('tokenTooltip.minedActions')"
                    @click="toggle()">
                    <span v-if="mining" class="token-tooltip__spinner" />
                    <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="mdiFileDocumentCheckOutline" fill="currentColor" /></svg>
                  </button>
                </template>

                <!-- No `close()` here: the container closes itself on any
                     button clicked inside the menu. -->
                <template #content>
                  <SearchDropdownItem
                    :text="$t('tokenTooltip.openInAnki')"
                    :iconPath="mdiOpenInNew"
                    @click="viewMinedNote" />
                  <SearchDropdownItem
                    :text="$t('tokenTooltip.mineContextOnly')"
                    :iconPath="mdiImagePlusOutline"
                    @click="addContextOnly" />
                  <SearchDropdownItem
                    :text="$t('tokenTooltip.mineToNote')"
                    :iconPath="mdiFileDocumentPlusOutline"
                    @click="mineThisSentence" />
                </template>
              </SearchDropdownContainer>

              <!-- New to them: nothing to choose between, so clicking makes the card. -->
              <button
                v-else
                type="button"
                data-testid="word-mine"
                class="token-tooltip__tool"
                :disabled="mining"
                :aria-label="$t('tokenTooltip.mineToLastCard')"
                :title="$t('tokenTooltip.mineToLastCard')"
                @click="mineThisSentence">
                <span v-if="mining" class="token-tooltip__spinner" />
                <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="mdiFileDocumentPlusOutline" fill="currentColor" /></svg>
              </button>
              </template>

              <button
                v-else
                type="button"
                data-testid="word-mine-blocked"
                class="token-tooltip__tool is-configuration-required"
                aria-disabled="true"
                :aria-label="mineBlockedMessage"
                :title="mineBlockedMessage"
                @click="openAnkiSettings">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="mdiFileDocumentPlusOutline" fill="currentColor" /></svg>
              </button>
            </span>
          </div>

          <!-- Live, because the interesting part of this card arrives after it
               opens. A reader who has been dropped into the dialog would
               otherwise sit on "Looking up…" in silence and never be told the
               definition had landed. It changes once per card, so polite
               announcement is not chatty. -->
          <div class="token-tooltip__body" aria-live="polite">
            <p v-if="inflectionLine" class="token-tooltip__inflection">{{ inflectionLine }}</p>

            <div v-if="badges.length > 0" class="token-tooltip__badges">
              <span v-for="badge in badges" :key="badge.id" class="token-tooltip__badge" :class="badge.kind">{{ badge.text }}</span>
            </div>

            <!-- The play buttons sit on the pitch row because both are about how
                 the word SOUNDS, and one leads each pattern because each pattern
                 is a different recording: a word read two ways gets a button per
                 accent, in front of the diagram that names the accent it plays. -->
            <div v-if="pitchPatterns.length > 0" class="token-tooltip__pitch">
              <span v-for="(pattern, pi) in pitchPatterns" :key="pi" class="token-tooltip__pitch-pattern">
                <button
                  v-if="pattern.audioUrl"
                  type="button"
                  class="token-tooltip__audio"
                  :class="{ 'is-playing': playingUrl === pattern.audioUrl }"
                  :aria-label="$t('tokenTooltip.playAudio')"
                  :title="$t('tokenTooltip.playAudio')"
                  @click="playHeadword(pattern.audioUrl)"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M8.5 2.75 4.9 5.75H2.4v4.5h2.5l3.6 3z" fill="currentColor" stroke="none" />
                    <path d="M11 6a3 3 0 0 1 0 4" />
                    <path d="M13 4a6 6 0 0 1 0 8" />
                  </svg>
                </button>
                <span
                  v-for="(mora, mi) in pattern.morae"
                  :key="mi"
                  class="token-tooltip__mora"
                  :class="{ 'is-high': mora.high, 'is-drop': mora.drop }"
                >{{ mora.text }}</span>
                <span class="token-tooltip__downstep">[{{ pattern.downstep }}]</span>
              </span>
            </div>

            <!-- What this expression is made of, and the only way to reach those
                 words: the chip spans them, so they cannot be hovered, and a
                 merged expression is the only candidate, so the picker offers no
                 way in either.

                 Above the senses rather than below them because it is navigation,
                 not detail. Underneath it sat past every gloss of every
                 dictionary the reader has stacked -- the one row on the card that
                 goes somewhere, reachable only by scrolling to the end of the one
                 thing they were already reading. Forms and kanji stay below: those
                 describe THIS word, and the reader who wants them is finished
                 reading. -->
            <div v-if="wordParts.length > 0" class="token-tooltip__parts">
              <span class="token-tooltip__parts-label">{{ $t('tokenTooltip.parts') }}</span>
              <button
                v-for="part in wordParts"
                :key="part.id"
                type="button"
                class="token-tooltip__part"
                lang="ja"
                @click="showPart(part)"
              >{{ part.text }}</button>
            </div>

            <!-- Before the senses, not after, because a name HAS a gloss: the
                 JMnedict entry for 明日香 reads "Asuka", a romanisation of the
                 word already at the top of the card. Rendering it as sense 1 is
                 the noise this whole change removes, so the state answers first.
                 
                 Not "no entry" either: the dictionary HAS this, we dropped the
                 name rows because a name competing with a word is noise. With no
                 word to compete with, being a name IS the answer -- the question
                 a reader has at 明日香 is "is this vocabulary or a person?", not
                 "what does it mean". One line, not a picker: several people
                 sharing a spelling are all the same answer. -->
            <p v-if="wordState === 'name'" class="token-tooltip__pending">{{ $t('tokenTooltip.isName') }}</p>

            <ol v-else-if="senses.length > 0" class="token-tooltip__senses">
              <template v-for="(sense, si) in senses" :key="si">
                <!-- The dictionary named ONCE above the senses it wrote, on a row
                     of its own, the way Shirabe's own word page does it. Inline
                     on the first sense it read as something that sense was
                     saying, and it pushed that sense's number out of line with
                     the rest of the run.

                     Only when the card mixes several, which is only ever true
                     for a reader who linked a Shirabe account: repeating
                     "JMdict" down a JMdict-only word is the noise this avoids. -->
                <li
                  v-if="namesSources && sense.dictionary !== senses[si - 1]?.dictionary"
                  class="token-tooltip__source-row"
                  :class="{ 'is-picked': pickedDictionaries.has(dictionaryKey(sense)) }"
                >
                  <!-- The dictionary's own name is the tick target: it is
                       already the thing that labels the run of senses below it,
                       so the control lands exactly where a reader would point
                       when they say "just this one". -->
                  <button
                    v-if="canPickDictionaries"
                    type="button"
                    class="token-tooltip__source token-tooltip__source-toggle"
                    :data-testid="`word-dictionary-toggle-${dictionaryKey(sense)}`"
                    :aria-pressed="pickedDictionaries.has(dictionaryKey(sense))"
                    :aria-label="$t('tokenTooltip.pickDictionary', { dictionary: sense.dictionary })"
                    :title="$t('tokenTooltip.pickDictionary', { dictionary: sense.dictionary })"
                    @click="togglePick(dictionaryKey(sense))"
                  >{{ sense.dictionary }}</button>
                  <span v-else class="token-tooltip__source">{{ sense.dictionary }}</span>
                </li>
                <li
                  class="token-tooltip__sense"
                  :class="[
                    `token-tooltip__sense--indent-${sense.indent}`,
                    { 'is-picked': pickedDictionaries.has(dictionaryKey(sense)) },
                  ]"
                >
                  <!-- The number as a cell of the row rather than an `::marker`
                       out in the list's own gutter: it sits inside the section,
                       flush under the dictionary that owns it, and each
                       dictionary counts from one. `items-baseline` because a
                       definition carrying furigana opens a taller line box, and
                       a number aligned to the top of it floats level with the
                       ruby instead of with the word it numbers. -->
                  <span class="token-tooltip__sense-number">{{ sense.number }}</span>
                  <div class="token-tooltip__sense-body">
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
                      <span v-if="row.label" class="token-tooltip__lang">{{ row.label }}</span>{{ row.text }}
                    </span>
                    <!-- On the sense it qualifies, never carried down to the next:
                         "usu. in kana" on sense 3 and not on sense 4 is a real
                         difference between those two senses. -->
                    <span v-for="(note, ni) in sense.notes" :key="`n-${ni}`" class="token-tooltip__note">{{ note }}</span>
                  </div>
                </li>
              </template>
            </ol>

            <button
              v-else-if="definitionsAreHidden"
              type="button"
              class="token-tooltip__pending token-tooltip__reveal"
              @click="revealHiddenDefinitions"
            >
              {{ $t('tokenTooltip.definitionsHidden') }} — {{ $t('tokenTooltip.showDefinitions') }}
            </button>
            <p v-else-if="wordState === 'loading'" class="token-tooltip__pending">
              <span class="token-tooltip__spinner" aria-hidden="true" />
              <span>{{ $t('tokenTooltip.loading') }}</span>
            </p>
            <!-- The lookup came back with nothing: a name, a coinage, or a
                 spelling the corpus preserved and JMdict never had. Said out
                 loud, because a card that just stops after the headword reads as
                 one that is still loading, or broken. The word, its reading and
                 its kanji are all still up there, and the dictionary chips below
                 are exactly where to go next. -->
            <p v-else-if="wordState === 'missing'" class="token-tooltip__pending">{{ $t('tokenTooltip.noEntry') }}</p>
            <!-- Shirabe would not answer. Said plainly, and deliberately NOT as
                 "no entry": the word may well be in the dictionary, and blaming
                 it for our failed request would be a lie the reader cannot
                 check. The headword, reading and inflection above are all still
                 true, and the dictionary chips below still work. -->
            <p v-else-if="wordState === 'unavailable'" class="token-tooltip__pending">{{ $t('tokenTooltip.unavailable') }}</p>


            <!-- The other spellings. The reader may well have met one of these
                 rather than the headword above, and nothing else on the card
                 connects the two. -->
            <div v-if="forms.length > 0" class="token-tooltip__forms">
              <span class="token-tooltip__forms-label">{{ $t('tokenTooltip.alsoWritten') }}</span>
              <span v-for="form in forms" :key="form" class="token-tooltip__form" lang="ja">{{ form }}</span>
            </div>

            <div v-if="kanjiChips.length > 0" class="token-tooltip__kanji">
              <a
                v-for="(chip, index) in kanjiChips"
                :key="chip.character"
                :href="chip.href"
                target="_blank"
                rel="noopener noreferrer"
                class="token-tooltip__kanji-link"
                @click="reportDictionaryClick('shirabe', 'kanji-chip', index)"
              >{{ chip.character }}</a>
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
              @click="searchForWord(headword)"
            >{{ $t('tokenTooltip.moreSentences') }}</button>
          </div>

          <!-- Keep candidate choices outside scrolling definitions so they remain discoverable. Chips serve a
               glance; expanding replaces them with gloss-bearing rows rather than duplicating the same
               candidates.
               -->
          <div v-if="showCandidateRows" class="token-tooltip__others">
            <!-- Chips. `pickerChips` keeps the picked one in the row however far
                 down the ranking it is, so collapsing the list never leaves the
                 card showing a word with no chip. -->
            <div v-if="!othersOpen" class="token-tooltip__others-row">
              <button
                v-for="chip in visibleCandidates"
                :key="chip.candidate.id"
                type="button"
                class="token-tooltip__chip-candidate"
                :class="{ 'is-picked': chip.index === picked }"
                :aria-current="chip.index === picked"
                :tabindex="chip.index === picked ? 0 : -1"
                :data-candidate="chip.index"
                @click="pickCandidate(chip.index)"
                @keydown="onCandidateKeydown(chip.index, $event)"
              >
                <!-- Spelling only. Every candidate here is one the token could
                     be read as, so the reading is the one thing they have in
                     common -- printing it on each chip spends the row's width
                     repeating what the word above the card already says. It
                     stays in the list below, where there is room for it to do
                     the job it can still do: telling きみ's きび from the rest. -->
                <span class="token-tooltip__candidate-word" lang="ja">{{ candidateName(chip.candidate) }}</span>
                <!-- Only where the spelling alone cannot choose: see
                     `duplicateHeadwords`. -->
                <span
                  v-if="duplicateHeadwords.has(candidateName(chip.candidate))"
                  class="token-tooltip__candidate-kind"
                  :title="candidatePartOfSpeech(chip.candidate, glossLanguages)"
                >{{ posInitial(chip.candidate) }}</span>
                <!-- Says WHY an unfamiliar spelling is here: it is somebody's
                     name, not a word the reader has never met. -->
                <span v-if="isNameCandidate(chip.candidate)" class="token-tooltip__candidate-kind">{{ $t('tokenTooltip.nameEntry') }}</span>
              </button>

              <button
                v-if="hiddenCandidateCount > 0"
                type="button"
                class="token-tooltip__chip-candidate is-more"
                :aria-expanded="false"
                @click="othersOpen = true"
              >{{ $t('tokenTooltip.otherMatches', { count: hiddenCandidateCount }) }}</button>
            </div>

            <!-- The list, where a row can say what its word means. -->
            <template v-else>
              <div class="token-tooltip__others-list">
                <button
                  v-for="(candidate, index) in candidates"
                  :key="candidate.id"
                  type="button"
                  class="token-tooltip__candidate"
                  :class="{ 'is-picked': index === picked }"
                  :aria-current="index === picked"
                  :tabindex="index === picked ? 0 : -1"
                  :data-candidate="index"
                  @click="pickFromList(index)"
                  @keydown="onCandidateKeydown(index, $event)"
                >
                  <span class="token-tooltip__candidate-word" lang="ja">{{ candidateName(candidate) }}</span>
                  <span v-if="candidate.reading && candidate.reading !== candidateName(candidate)" class="token-tooltip__candidate-reading" lang="ja">{{ candidate.reading }}</span>
                  <span v-if="isNameCandidate(candidate)" class="token-tooltip__candidate-kind">{{ $t('tokenTooltip.nameEntry') }}</span>
                  <span class="token-tooltip__candidate-gloss">{{ candidateSummary(candidate, glossLanguages) }}</span>
                </button>
              </div>

              <button
                type="button"
                class="token-tooltip__others-less"
                :aria-expanded="true"
                @click="othersOpen = false"
              >{{ $t('tokenTooltip.showLess') }}</button>
            </template>
          </div>

          <!-- No picks exports all dictionaries. Place the pick summary in the footer, outside the senses'
               v-else-if chain.
               -->
          <div
            v-if="canPickDictionaries && pickedDictionaries.size > 0"
            class="token-tooltip__pick"
            data-testid="word-pick-summary"
          >
            <span class="token-tooltip__pick-text">{{ pickSummary }}</span>
            <button
              v-if="canSelectAllDictionaries"
              type="button"
              class="token-tooltip__pick-action"
              data-testid="word-pick-select-all"
              @click="selectAllDictionaries"
            >{{ $t('tokenTooltip.pickSelectAll') }}</button>
            <button
              type="button"
              class="token-tooltip__pick-action"
              data-testid="word-pick-deselect-all"
              @click="deselectAllDictionaries"
            >{{ $t('tokenTooltip.pickDeselectAll') }}</button>
          </div>

          <div v-if="dictionaryLinks.length > 0" class="token-tooltip__links">
            <span class="token-tooltip__links-label">{{ $t('tokenTooltip.lookupIn') }}</span>
            <a
              v-for="(link, index) in dictionaryLinks"
              :key="link.id"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="token-tooltip__link"
              @click="reportDictionaryClick(link.id, 'word-card', index)"
            >{{ link.label }}</a>
          </div>
        </div>
      </Transition>
    </Teleport>
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

/* The keyboard's version of the hover above. Without it the arrow keys move a
   focus nobody can see, which is the same as not having them: the ring IS the
   feature for a reader walking a sentence a word at a time. `focus-visible`
   rather than `focus` so a mouse click does not leave one behind. */
.token:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
  background-color: rgba(255, 255, 255, 0.15);
}


/* Context tint matches translations. Keep this before the equally specific .token--match so search matches
 * win.
 */
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

/* Keep the open word marked after the pointer moves away. Match .token:hover specificity so source order
 * preserves the accent.
 */
.token.token--open {
  background-color: color-mix(in srgb, var(--accent-soft) 28%, transparent);
}

.token.token--open:hover {
  background-color: color-mix(in srgb, var(--accent-soft) 38%, transparent);
}

/* The word card: head, inflection and badges pinned, the reading matter
   scrolling under them, dictionary links pinned at the foot. */
.token-tooltip {
  /* absolute, not fixed: the card belongs to the page, so it scrolls away with
     the sentence rather than following the reader. Teleported to <body> so these
     coordinates are page coordinates whatever the segment sits inside. */
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  /* Fixed width avoids shifting after lookup and makes viewport clamping stable. Keep these dimensions in sync
   * with BOX in ~/utils/cardPlacement.
   */
  width: min(480px, calc(100vw - 24px));
  max-height: min(52vh, 420px);
  padding: 10px 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  /* Above `BaseModal`'s z-[60]. The card teleports to <body>, so a z-index
     inside the modal's stacking context cannot save it: at 50 it opened
     behind the context dialog and the word looked unclickable. */
  z-index: 70;
  text-align: left;
  white-space: normal;
  box-shadow: var(--shadow-menu);
  overflow: hidden;
}

.token-tooltip--below {
  transform: translate(-50%, 0);
}

/* Focus lands here when the card is opened from the keyboard, so it says so.
   Suppressing it would be the tidier-looking choice and the wrong one: the
   reader has just been moved somewhere, and this is what tells them where. */
.token-tooltip:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.token-tooltip__head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 14px;
}

/* The word is what the card is about, so it is the one thing sized to be read
   at a glance rather than to fit. `ruby rt` is 0.55em, so the furigana grows
   with it and the head keeps its proportions. */
/* Navigation owns the header's auto margin when present; two auto margins split free space rather than
 * stacking.
 */
.token-tooltip__nav {
  flex: 0 0 auto;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 3px;
  margin-left: auto;
}
.token-tooltip__nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--ink-muted);
  background: transparent;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}
.token-tooltip__nav-button:hover:not(:disabled) {
  background: var(--surface-lift);
  color: var(--ink);
}
.token-tooltip__nav-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.token-tooltip__word {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.25;
  color: white;
  text-decoration: none;
  /* Shrinkable, so the Anki buttons that share this row keep their place: a
     flex item's default `min-width: auto` refuses to go below its content, and
     a long headword would push them off the edge of the card. */
  min-width: 0;
}

a.token-tooltip__word {
  cursor: pointer;
}

a.token-tooltip__word:hover {
  color: var(--accent-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.token-tooltip__reading {
  font-size: 13px;
  color: var(--accent-soft);
}

/* The alternatives, pinned under the scrolling body rather than inside it:
   `flex: 0 0 auto` beside a body that is `0 1 auto`, so the body gives up room
   and this keeps its place whatever the definition's length.

   Set apart by a rule, because it is about a DIFFERENT word than everything
   above -- a reader who does not notice the boundary reads the first chip as
   part of the entry. */
.token-tooltip__others {
  flex: 0 0 auto;
  margin-top: 10px;
  border-top: 1px solid var(--line);
}

/* The glance. One line, no wrap: a row that wraps has stopped being a glance,
   which is what the four-chip cap is for. */
.token-tooltip__others-row {
  display: flex;
  align-items: center;
  gap: 3px;
  /* Even above and below. The row sits between two rules, so an uneven pad reads
     as the chips belonging to whichever side they are nearer. */
  padding: 8px 14px;
  overflow: hidden;
}

/* Quiet until picked. The unpicked ones are alternatives rather than actions, so
   they must not compete with the headword -- but they have to look pressable,
   which a bare word does not. */
.token-tooltip__chip-candidate {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-muted);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.token-tooltip__chip-candidate:hover {
  background: var(--surface-lift);
  color: var(--ink);
}

/* The one the card is showing. An outline rather than a fill: the chips sit
   directly under the definition they belong to, and a filled chip down there
   pulls harder than the word it is describing. The accent still matches
   `.token--open` on the word in the sentence -- the same relationship said the
   same way, just quieter. */
.token-tooltip__chip-candidate.is-picked {
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

.token-tooltip__chip-candidate:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

/* Not a word, so it does not wear a word's chip: no border, and it never gets
   squeezed by the chips beside it. */
.token-tooltip__chip-candidate.is-more {
  flex: 0 0 auto;
  border-color: transparent;
  color: var(--ink-faint);
  font-size: 11px;
}

/* Back to the glance, at the end of the list it collapses. */
.token-tooltip__others-less {
  width: 100%;
  padding: 6px 14px 8px;
  border: 0;
  background: transparent;
  color: var(--ink-faint);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.token-tooltip__others-less:hover {
  color: var(--ink);
}

.token-tooltip__others-list {
  /* Its own scroll, because it is no longer inside the body's. A ceiling in `em`
     rather than rows: it holds about five, which is enough to read as a list
     that continues without the fold eating the definition it belongs to. The
     card's own height is clamped by `placeCard`, so an unbounded list here would
     be one the reader could not reach the bottom of. */
  max-height: 11em;
  overflow-y: auto;
  /* Same reason as the body: this one sits at the very bottom of the card, so
     it is the likeliest place to scroll past the end by accident. */
  overscroll-behavior: contain;
  padding-bottom: 4px;
  scrollbar-width: thin;
  scrollbar-color: #555 transparent;
}

/* A row, not a chip. Full width so the gloss has somewhere to go, and a rule
   between rows rather than a border around each: a bordered stack of nine reads
   as nine buttons, while a ruled one reads as a list -- which is what a reader
   scans. */
.token-tooltip__candidate {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 6px;
  padding: 5px 14px;
  border: 0;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--ink-muted);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

/* The first row sits under the fold's own toggle, which is boundary enough. */
.token-tooltip__candidate:first-child {
  border-top: 0;
}

.token-tooltip__candidate:hover {
  background: var(--surface-lift);
  color: var(--ink);
}

/* The one already open above. It stays IN the list rather than being filtered
   out of it, so picking moves a highlight instead of making the row under the
   cursor vanish and the rest reshuffle beneath it. Accent matches `.token--open`
   on the word in the sentence: the same relationship said the same way. */
.token-tooltip__candidate.is-picked {
  color: var(--accent-soft);
  background: color-mix(in srgb, var(--accent-soft) 10%, transparent);
}

.token-tooltip__candidate:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.token-tooltip__candidate-word {
  font-size: 13px;
  font-weight: 600;
}

.token-tooltip__candidate-reading {
  font-size: 11px;
  opacity: 0.75;
}

/* The part of speech, on a chip whose spelling is not enough to choose by.
   Quiet: it is a tiebreak, not something to read. */
.token-tooltip__candidate-kind {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  white-space: nowrap;
}

.token-tooltip__candidate-gloss {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ink-faint);
}

/* Not a row about a word, so it does not pretend to be one. */
.token-tooltip__candidate.is-more {
  justify-content: center;
  font-size: 11px;
  color: var(--ink-faint);
}

/* A usage note, which is not a definition and must not read as one: indented
   under the glosses it qualifies and set apart from them. */
.token-tooltip__note {
  display: block;
  font-size: 11px;
  font-style: italic;
  color: var(--ink-muted);
  margin-top: 2px;
}

/* What the expression is made of. Styled as the forms row is, because it is the
   same kind of thing to the eye -- a label and a row of words -- and different
   chrome for the two would suggest a difference that is not there. Pressable,
   unlike a form: each one opens. */
.token-tooltip__parts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}

.token-tooltip__parts-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.token-tooltip__part {
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.token-tooltip__part:hover {
  background: var(--surface-lift);
}

.token-tooltip__part:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

/* The other spellings, on one wrapping row. */
.token-tooltip__forms {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}

.token-tooltip__forms-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.token-tooltip__form {
  font-size: 13px;
  color: var(--ink);
}

/* The rest of the ranked list, one click away. Styled as a chip because it sits
   in the row and takes the same click, but with no headword to show. */
.token-tooltip__candidate.is-more {
  font-size: 12px;
  color: var(--ink-muted);
}

/* The Anki corner. `flex: 0 0 auto` against a headword that may shrink, so a
   long word wraps rather than pushing the buttons off the card -- they are the
   fixed thing here and the word is the elastic one, which is the opposite of
   how the head reads. `flex-start` because the head aligns on the baseline of a
   32px word, and centring against that would drop the buttons halfway down the
   card. */
.token-tooltip__tools {
  flex: 0 0 auto;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  margin-left: auto;
}

/* The arrows already pushed the group right; a second auto here would take half
   the free space back. Tools keep their own auto for the ordinary card, which
   has no arrows at all. */
.token-tooltip__nav + .token-tooltip__tools {
  margin-left: 4px;
}

/* The same quiet circle as the pronunciation button below, because they are the
   same kind of thing: a small action hanging off the word rather than part of
   what the card says about it. */
.token-tooltip__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--surface-lift);
  color: var(--ink-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__tool:hover:not(:disabled) {
  background: color-mix(in srgb, white 14%, transparent);
  color: var(--ink);
}

.token-tooltip__tool:disabled {
  cursor: default;
  opacity: 0.6;
}

.token-tooltip__tool.is-configuration-required {
  cursor: pointer;
  opacity: 0.6;
}

/* Lit, not merely present. This one is a statement about the reader's own
   collection -- they have this word -- and it has to be readable as one at a
   glance from across the card, which a grey icon among grey icons is not. */
.token-tooltip__tool.is-mined {
  background: color-mix(in srgb, var(--accent-soft) 18%, transparent);
  color: var(--accent-soft);
}

.token-tooltip__tool.is-mined:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-soft) 30%, transparent);
  color: var(--accent-soft);
}

/* Quiet beside the pitch until pointed at, and accented while a clip runs so a
   second click reads as "again" rather than "did that do anything". Sized to a
   comfortable tap target rather than to the 14px glyph inside it, which is why
   it centres against a row of morae rather than sitting on their baseline. */
.token-tooltip__audio {
  flex: 0 0 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--surface-lift);
  color: var(--ink-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__audio:hover {
  background: color-mix(in srgb, white 14%, transparent);
  color: var(--ink);
}

.token-tooltip__audio.is-playing {
  color: var(--accent-soft);
}

.token-tooltip__inflection {
  flex: 0 0 auto;
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-faint);
}

/* The body supplies the shared 14px inset; repeating it here would double-pad badges relative to adjacent
 * rows.
 */
.token-tooltip__badges {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
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
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.token-tooltip__body {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Contain scroll chaining so reading the last sense does not move the page; retain local overscroll
   * feedback.
   */
  overscroll-behavior: contain;
  padding: 0 14px;
  /* Thumb only. The default track is a filled gutter with a border, which
     reads as a second column on this card. */
  scrollbar-width: thin;
  scrollbar-color: #555 transparent;
}

.token-tooltip__body::-webkit-scrollbar {
  width: 8px;
}

.token-tooltip__body::-webkit-scrollbar-track {
  background: transparent;
  border: none;
}

.token-tooltip__body::-webkit-scrollbar-thumb {
  background-color: #555;
  border: none;
  border-radius: 4px;
}

/* One mora per cell, an overline over the high ones and a fall after the
   downstep: the same reading as Shirabe's own pitch diagram. */
.token-tooltip__pitch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 8px;
}

.token-tooltip__pitch-pattern {
  display: inline-flex;
  align-items: baseline;
}

/* Spaced off its own diagram, but by less than the 12px between two patterns:
   the button has to read as belonging to the accent on its right rather than
   floating between two of them. The margin goes here rather than a `gap` on the
   pattern, because the morae are a continuous overline and must stay touching. */
.token-tooltip__pitch-pattern .token-tooltip__audio {
  margin-right: 6px;
}

.token-tooltip__mora {
  padding: 1px 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink);
  border-top: 2px solid transparent;
}

.token-tooltip__mora.is-high {
  border-top-color: var(--accent-soft);
}

.token-tooltip__mora.is-drop {
  border-right: 2px solid var(--accent-soft);
}

.token-tooltip__downstep {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

/* Share number-column and gap variables across grid and indentation; each sub-sense step is one column plus
 * gap.
 */
.token-tooltip__senses {
  --sense-number-column: 1rem;
  --sense-number-gap: 4px;
  margin: 8px 0 0;
  padding-left: 0;
  list-style: none;
}

/* Number and body, the same two-column row Shirabe's word page uses. Baseline
   rather than top: a definition carrying furigana opens a taller line box, and a
   number aligned to its top floats level with the ruby instead of with the word
   it numbers. */
.token-tooltip__sense {
  display: grid;
  grid-template-columns: var(--sense-number-column) 1fr;
  align-items: baseline;
  gap: var(--sense-number-gap);
  margin: 5px 0;
  font-size: var(--definition-size);
  line-height: 1.5;
  color: var(--ink);
}

.token-tooltip__sense-number {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

/* The dictionary's name doubles as the tick target when a pick is possible.

   Reusing the heading rather than adding a checkbox column is what keeps this
   from costing horizontal space on a card that is already narrow, and the name
   is what a reader would point at anyway when they say "just this one".
   Everything but the interaction is inherited from `__source`, so a picked and
   an unpicked card are the same shape and the list does not reflow when the
   first dictionary is ticked. */
.token-tooltip__source-toggle {
  padding: 0;
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.token-tooltip__source-toggle:hover,
.token-tooltip__source-toggle:focus-visible {
  color: var(--accent);
}

/* The picked dictionaries keep full contrast and the rest drop back, rather
   than the other way round: what the reader is building is the SHORTLIST, so the
   card should read as the shortlist the moment there is one. Nothing is hidden
   -- a pick is reversible, and the dictionaries left out are still the answer to
   "what else does this mean". */
.token-tooltip__senses:has(.is-picked) .token-tooltip__sense:not(.is-picked) {
  color: var(--ink-faint);
}

/* The last row of the body, directly above the LOOK UP IN rule. Its own padding
   matches the links row below it, so the two footer bands line up on the same
   left edge as everything else in the card. */
.token-tooltip__pick {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 0 14px;
}

.token-tooltip__pick-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ink-faint);
}

/* Text buttons rather than pills. They are a way to undo a fiddly bit of
   ticking, not a thing to reach for on the way in, so they should read as the
   quietest controls on the card -- and the disabled state is doing most of the
   work anyway: on a card nobody has touched, "Select all" is already done. */
.token-tooltip__pick-action {
  flex: none;
  padding: 0;
  font-size: 11px;
  color: var(--ink-soft);
  background: none;
  border: 0;
  cursor: pointer;
}

.token-tooltip__pick-action:hover:not(:disabled),
.token-tooltip__pick-action:focus-visible:not(:disabled) {
  color: var(--accent);
}

.token-tooltip__pick-action:disabled {
  color: var(--ink-faint);
  cursor: default;
  opacity: 0.5;
}

/* One step per tier the dictionary actually used, and the step is the number
   column plus its gap -- so a sub-sense's number lands exactly where its
   parent's TEXT starts. Any other value and it hangs between the two. Same
   arithmetic as `SearchHelper::SENSE_INDENT`, in this card's units. */
.token-tooltip__sense--indent-1 {
  padding-left: calc(var(--sense-number-column) + var(--sense-number-gap));
}

.token-tooltip__sense--indent-2 {
  padding-left: calc((var(--sense-number-column) + var(--sense-number-gap)) * 2);
}

/* `min-width: 0` so a long unbroken definition wraps inside its column instead
   of widening the grid and pushing the number off the card. */
.token-tooltip__sense-body {
  min-width: 0;
}

/* The dictionary's own row, and the run of senses under it reads as one column:
   no left indent, so its name sits flush above the numbers it owns. */
.token-tooltip__source-row {
  margin-top: 10px;
}

.token-tooltip__source-row:first-child {
  margin-top: 0;
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
  color: var(--ink-faint);
}

.token-tooltip__chip--pos {
  color: var(--accent-soft);
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
  color: var(--ink-faint);
}

.token-tooltip__reveal {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.token-tooltip__reveal:hover,
.token-tooltip__reveal:focus-visible {
  color: var(--accent-soft);
  text-decoration: underline;
  text-underline-offset: 2px;
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
  border: 1px solid var(--line);
  border-radius: 7px;
  font-size: 17px;
  line-height: 1.2;
  text-align: center;
  color: var(--ink);
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__kanji-link:hover {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

/* Show pending immediately; cached answers bypass this state. */
.token-tooltip__pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: var(--ink-faint);
}

.token-tooltip__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--line);
  border-top-color: var(--ink-muted);
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
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 1.4;
  color: var(--ink-muted);
  vertical-align: 1px;
}

.token-tooltip__lang.is-spoiler {
  color: var(--ink-faint);
}

/* Display names can be Japanese; slug-era tiny uppercase styling is not readable for them. */
.token-tooltip__source {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-faint);
}

.token-tooltip__source-row.is-picked .token-tooltip__source {
  color: var(--accent);
  font-weight: 700;
}

.token-tooltip__gloss-row {
  display: block;
}

.token-tooltip__gloss-row + .token-tooltip__gloss-row {
  margin-top: 2px;
}

/* A link, not a button: it navigates, and dressing it as a control put a filled
   box and a rule across a card that is otherwise text. Accent colour is enough
   to say it is clickable. */
.token-tooltip__actions {
  flex: 0 0 auto;
  display: flex;
  margin-top: 8px;
  padding: 0 14px;
}

.token-tooltip__action {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-soft);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.token-tooltip__action:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* The headword navigates too, so it says so on hover -- in the same accent as
   the link below, since they lead to the same place. Quiet until then: it is the
   title of the card first and a link second. */
.token-tooltip__word--action {
  border: 0;
  padding: 0;
  background: none;
  /* Do not use the `font` shorthand here: it resets the title size from
     `.token-tooltip__word` along with the browser button's font family. */
  font-family: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: color 0.12s ease;
}

.token-tooltip__word--action:hover {
  color: var(--accent-soft);
}

.token-tooltip__links {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  /* 10 to match the card's own 10px padding-bottom, which is the whole gap
     under this row -- the pills are the last thing in the card. It was 8, so
     they sat 8 below the rule and 10 above the edge and read as having slipped
     down. Bottom stays 0: the card supplies that half, and setting it here
     would add to it rather than replace it. */
  padding: 10px 14px 0;
  border-top: 1px solid var(--line);
}

/* The links row brings its own 10px above its rule, which is right when it
   follows the body and wrong when it follows the pill row: there the reader sees
   8px above the pills and 18px below them, and the row reads as belonging to the
   dictionaries under it rather than sitting between the two. Its own padding is
   symmetric; this is what makes the gap look it. */
.token-tooltip__others + .token-tooltip__links {
  margin-top: 0;
}

/* 10px and faint like the PARTS and ALSO WRITTEN labels above it. These three
   rows are the same shape -- a small caps label, then its values -- and they
   were drawn at three different weights of the same idea: 10/faint, 10/muted
   and 11/faint. */
.token-tooltip__links-label {
  font-size: 10px;
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.token-tooltip__link {
  font-size: 13px;
  color: var(--ink);
  text-decoration: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-lift);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__link:hover {
  background: color-mix(in srgb, white 14%, transparent);
  color: var(--ink);
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
