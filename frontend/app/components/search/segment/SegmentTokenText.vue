<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import { enrichTokens, type SlimToken, type EnrichedToken } from '~/utils/tokenEnrichment';
import { placeCard } from '~/utils/cardPlacement';
import { tabStop, tokenKeyAction } from '~/utils/tokenNavigation';
import {
  cardForms,
  cardHeadword,
  headwordFurigana,
  lookupState,
  candidatePartOfSpeech,
  candidateName,
  candidateSummary,
  cardSenses,
  dictionaryKey,
  pickerChips,
  glossPreference,
  kanjiIn,
  pitchMorae,
  shirabeKanjiUrl,
  type GlossLanguage,
  // The same three names that ride out to Shirabe as `utm_content`, reused here
  // rather than restated: the click we record and the visit Shirabe records are
  // then labelled identically, so the two sides reconcile per surface instead of
  // only in total.
  type ShirabeLinkSurface,
  type ShirabeCandidate,
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
// The singleton, not `usePostHog()`. That composable resolves through
// `useNuxtApp()`, which throws when it is reached from a detached async
// continuation -- and the outcome below is reported after `await fetchWord`,
// which is exactly one. Same reasoning, and the same import, as `reportError`.
import posthog from 'posthog-js';
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

// Whether the card, once open, can carry real definitions. Not a rollout switch
// -- the card itself ships to everyone now -- but a capability one: it is
// derived from whether a Shirabe key is configured at all, and with none there
// is nothing to ask. It only suppresses the REQUEST, so an unconfigured
// environment still opens a card on the headword and inflection the token
// already knows.
//
// Read strictly, because it does not arrive the way the schema in config/env.ts
// left it. That schema runs at `nuxt build`; a NUXT_PUBLIC_* variable set on the
// deployed container overrides the baked value afterwards, through Nuxt rather
// than through zod. Nuxt parses what it finds, so "false", "0" and "" all land
// falsy -- but an unrecognised value lands as the STRING it was, and
// `Boolean('yes')` is true. Requiring exactly `true` means a misspelled flag
// reads as off, which is the direction a doomed-request gate has to fail in.
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

const hoveredToken = ref<EnrichedToken | null>(null);
const tooltipStyle = ref<Record<string, string>>({});
const tooltipRef = ref<HTMLElement | null>(null);
// Which side of the token the card hangs off. Decided once when it opens and
// never revisited -- see `placeTooltip`.
const tooltipBelow = ref(false);
let hoveredElement: HTMLElement | null = null;

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

/**
 * Which words this token could be, and which of them the card is showing.
 *
 * A LIST, not a word, and that is the change. Shirabe answers
 * `POST /api/v1/words/identify` with every word a spelling can name, ranked --
 * きみ is 君, 黄身 or 黍 -- because one answer is a claim it often cannot
 * support. `candidates[0]` is its best reading of the sentence and where the
 * card opens; `picked` is where the reader moved it.
 *
 * Fetched through our server route so the service key stays on the server, and
 * cached in `~/utils/wordLookup` -- a module, so one answer serves every segment
 * on the page rather than every segment keeping its own copy.
 */
const candidates = ref<ShirabeCandidate[]>([]);
const picked = ref(0);

/**
 * Whether there is anything to offer at all.
 *
 * One candidate is not a choice, and a row of one is a control that asks the
 * reader to consider something already settled.
 */
const showCandidateRows = computed(() => candidates.value.length > 1);

/**
 * How many chips the glance shows before it stops.
 *
 * Four, not six. The row is no longer the only way to reach a candidate -- what
 * it does not fit opens as a list a click away -- so it can be sized for what is
 * READABLE at the card's width rather than for what is reachable. Four chips
 * hold one line at the widths these words run to; six wrapped, and a wrapped
 * glance is not one.
 */
const PICKER_VISIBLE = 4;

/**
 * Whether a candidate is a person or a place rather than a word.
 *
 * Read off the flag Shirabe publishes, never off the dictionary slug: JMdict
 * carries ~7,300 JMnedict rows under its own name, so a slug test keeps every
 * one of them and never says so. あれ is the case that shows it -- 亜礼, 阿礼 and
 * 安礼 all arrive under `jmdict`.
 *
 * Names are normally filtered out of an answer entirely (see
 * `withoutNameEntries`), so this only has anything to mark in the one case where
 * they survive: a token that resolves to nothing BUT names. Then the tag is what
 * stops six unfamiliar spellings reading as six words the reader has never met.
 */
const isNameCandidate = (candidate: ShirabeCandidate): boolean => candidate.name === true;

/**
 * The one letter that tells two same-spelling candidates apart, with the whole
 * word on hover.
 *
 * PRONOUN and INTERJECTION spelled out cost more row than the words they were
 * disambiguating -- あれ PRONOUN / あれ INTERJECTION pushed 有れ and 我 to the
 * edge, so a tiebreak between two chips was crowding out the other four. An
 * initial is enough to tell them apart, which is the whole job; `title` carries
 * the rest for anyone who wants it, the same way the sense chips do.
 *
 * A collision (two candidates whose labels share a letter) is not worth guarding
 * against: if two spellings have the SAME part of speech then the full word
 * would not separate them either, and the list below -- where every row carries
 * its gloss -- is what answers that.
 *
 * Localized by construction: it is the first character of the label the card
 * would print, so Spanish gets P/I too and Japanese gets 代/感.
 */
function posInitial(candidate: ShirabeCandidate): string {
  return [...candidatePartOfSpeech(candidate, glossLanguages.value)][0] ?? '';
}

/**
 * The spellings more than one candidate answers to.
 *
 * Only these get a part of speech on their chip. あれ is two words -- the
 * pronoun and the interjection -- and without it the row shows あれ twice with
 * nothing to choose by; every other chip is already distinct, and a label on all
 * of them would be noise charged to the many for the sake of the few.
 */
const duplicateHeadwords = computed(() => {
  const counts = new Map<string, number>();
  // Counted over what is PRINTED (`candidateName`), not over the headword: two
  // chips are indistinguishable to a reader when they carry the same label, and
  // a word shown under its kanji is no longer a duplicate of the kana it shares
  // a headword with.
  for (const candidate of candidates.value) {
    const name = candidateName(candidate);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
});

/** The chips to draw. The decision, and why the index travels with the
 *  candidate, is `pickerChips`. */
const visibleCandidates = computed(() => pickerChips(candidates.value, picked.value, false, PICKER_VISIBLE));

const hiddenCandidateCount = computed(() => Math.max(0, candidates.value.length - PICKER_VISIBLE));

/**
 * Shut by default, and reset per card.
 *
 * A reader who opened the list on ここ was asking about ここ. Carrying that open
 * state to the next word they hover would answer a question they have not asked
 * yet, on a card where the alternatives are usually noise.
 */
const othersOpen = ref(false);

/**
 * The word the card renders: whichever candidate the reader has picked.
 *
 * There used to be a second ref here holding a follow-up
 * `GET /api/v1/words/{id}`, and a computed spreading it over the candidate,
 * because identify carried enough to CHOOSE but not enough to finish the card.
 * It carries both now (`include=pitch,frequency,furigana,jlpt,forms,notes`), so
 * the second call, its cache, the spread and the id-guard that kept a late
 * answer off the wrong word are all gone.
 */
const word = computed<ShirabeWord | null>(() => candidates.value[picked.value] ?? null);

const headword = computed(() => cardHeadword(word.value, hoveredToken.value?.dictForm));

// 'missing' is specifically "we asked and there is no entry", which the card
// says out loud. It is not the same as "we never asked" (lookups unconfigured,
// a token that could not be a word) -- claiming no entry for a question nobody
// put would be a lie, so those stay 'idle' and the card simply answers from the
// token alone, which is what it did before any of this loaded.
const wordState = ref<'idle' | 'loading' | 'name' | 'missing' | 'unavailable'>('idle');
// The word this card is currently waiting on, so a late answer for a word the
// reader has moved off can be told apart from the one they are looking at.
// Deliberately not the token object: those are rebuilt by a computed.
let pendingLookup: string | null = null;

/**
 * The Anki half of the card, which is the other question a reader has about a
 * word they just looked up: is it already in my collection, and can this
 * sentence go on it.
 *
 * It answers against AnkiConnect on the reader's own machine and shows nothing
 * at all without a configured profile -- so for everyone else the card is
 * exactly what it was. See `useWordMining` for why none of it is cached.
 */

/** What the card mines, and what it asks Anki about: the dictionary form rather
 *  than the surface, because that is what a mine puts in the expression field --
 *  食べる, whatever the sentence inflected it to.
 *
 *  `headword`, so it follows the reader's pick. This read off the token alone,
 *  which was right when a card was about one word and wrong the moment it could
 *  be about several: the star said "you have this" about きみ while the button
 *  beside it wrote 黄身. It still answers immediately and still empties on close,
 *  because the token is `headword`'s own fallback. */
const miningWord = computed(() => headword.value);

/**
 * The open card, rendered for a note: headword, reading, ruby, definitions,
 * pitch and badges.
 *
 * Computed off the same refs the card itself renders from, so what lands on the
 * note is what the reader was looking at when they pressed the button -- in
 * their gloss languages, with the same senses and the same six-sense cap. It
 * recomputes when the lookup lands, which is why `useWordMining` reads it
 * through a getter rather than being handed a value when the card opened.
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

/**
 * Worth asking the dictionary about.
 *
 * One rule for every token, which it did not used to be. A stored `wid` only
 * ever reached content words -- Shirabe pools the words a reader studies, and
 * particles are grammar -- so grammar needed a second path, and that path had to
 * send the SURFACE rather than the lemma, because なら reduces to the copula だ
 * and looking that up answers "to be" to a reader who pointed at "if".
 *
 * Resolving from the lemma plus the shape it took here settles both: Shirabe
 * picks the entry, so `なら` finds なら and 食べました finds 食べる, and neither
 * caller has to know which kind of word it is holding. What is left out is only
 * what could not have an entry -- punctuation, whitespace, bare digits -- where
 * a request would spend a round trip to be told 404.
 */
function isAskable(token: EnrichedToken): boolean {
  return !NOT_A_WORD.has(token.kind ?? '') && HAS_JAPANESE.test(token.d ?? '');
}

async function loadWord(token: EnrichedToken): Promise<void> {
  // Not configured: no key on the server, so there is nothing to ask. Leaving
  // the request out entirely beats firing one that 503s on every hover and
  // caching the failure, and the card still answers from the token alone.
  if (!lookupsEnabled) {
    clearLookup();
    return;
  }

  if (!isAskable(token)) {
    clearLookup();
    return;
  }

  // A card opening on a token is standing at the start of its own trail, however
  // far the previous card wandered.
  clearTrail();

  const ref = token.lookupRef;
  // Staleness below is judged on this string, so it has to be the same identity
  // the cache uses: two tokens for the same word in the same shape are
  // interchangeable, two spellings of it are not.
  const asked = `${ref.lemma}|${ref.surface}|${ref.reading}|${ref.pos}`;
  const locale = glossLanguages.value.labels;

  // Already answered, from this card or any other on the page: paint it now.
  // Synchronously, with no intermediate 'loading', so a word the reader has
  // seen before (or that hovering prefetched a moment ago) opens filled in
  // rather than flashing "Looking up…" for a frame first.
  const cached = peekWord(ref, locale);
  if (cached !== undefined) {
    applyLookup(cached);
    reportCardOutcome(token, cached, true);
    return;
  }

  clearLookup();
  wordState.value = 'loading';
  pendingLookup = asked;

  const found = await fetchWord(ref, locale);

  // Staleness is judged on the WORD being looked up, not on the token object
  // that asked for it.
  //
  // This compared `hoveredToken.value !== token` by identity, and that is what
  // left cards reading "Looking up…" over a request that had already returned
  // 200. `enrichedTokens` is a computed: any re-evaluation builds fresh token
  // objects, so the one captured when the card opened can quietly stop being the
  // one the ref holds, and an answer for exactly the word on screen was thrown
  // away as belonging to something else. Nothing then cleared the loading state,
  // because the guard that would have cleared it compared the same way.
  //
  // A word is a string and two tokens for the same word are interchangeable
  // here, so this holds however often the list re-renders.
  if (pendingLookup !== asked) return;
  pendingLookup = null;

  applyLookup(found);
  reportCardOutcome(token, found, false);
  // Deliberately no re-placement here. The card has just grown from one line to
  // its full height, but where it goes was settled against its maximum size when
  // it opened, so it grows into room already reserved for it.
}

/** Empty the lookup, so nothing from the last word survives into the next one.
 *  `picked` resets with the rest: a reader who chose 黄身 on one token must not
 *  find the next one opening on its second candidate. */
function clearLookup(): void {
  candidates.value = [];
  picked.value = 0;
  othersOpen.value = false;
  wordState.value = 'idle';
}

/** Paint an answer, whichever of the four it is. Only a dictionary that
 *  answered "no such word" reaches 'missing' and is said out loud; a lookup that
 *  could not be made leaves the card quiet, on what the token itself knows. */
function applyLookup(answer: WordLookup): void {
  candidates.value = answer.candidates;
  picked.value = 0;
  othersOpen.value = false;
  // 'shown' becomes 'idle' here: with candidates in hand the card has something
  // to draw and needs no state of its own. The other three are things it says.
  const state = lookupState(answer.candidates.length, answer.reason, answer.nameOnly);
  wordState.value = state === 'shown' ? 'idle' : state;

  /**
   * Ask Anki again, about the word the dictionary just named.
   *
   * The probe fires when the card OPENS, which is before the lookup lands, so it
   * asks about the token's own dictionary form -- あんた for a token the
   * dictionary will resolve to 手加減. `useWordMining` then discards that answer
   * on arrival because the open word has changed under it, which is right: an
   * answer about あんた says nothing about 手加減. What was missing is the
   * follow-up. Nothing re-asked, so a word the reader already had read as new
   * whenever AnkiConnect answered before Shirabe did -- a race between two
   * services that do not wait on each other, and one the local stub wins every
   * time.
   *
   * Same reason `pickCandidate` re-probes, and the same staleness guards drop
   * whichever of the two lands late.
   */
  void probeMined();
}

/**
 * What the card ended up telling the reader, once per open.
 *
 * Read off what RENDERED, not off what the fetch returned, and the difference is
 * the whole point. An entry can come back perfectly well and still leave a
 * headword over blank space: `cardSenses` drops every sense with no gloss in a
 * language the reader reads, so a Spanish-only reader meeting an English-only
 * entry gets nothing under the word. A fetch-level metric scores that as
 * success.
 *
 * That gap is not hypothetical. It is the exact shape of the wrong-API-path bug
 * (`server/api/shirabe/words/[lemma].get.ts`), which rendered every card empty
 * and survived as long as it did because -- in the words of the comment left
 * there -- nothing alerted, since an empty card is not an error. `no_senses` is
 * the bucket that makes it loud.
 *
 * Called only where a lookup actually happened. A token nobody can ask about
 * (punctuation, bare digits) and a build with no Shirabe key configured both
 * return before this, because neither is the dictionary answering and counting
 * them would move rates that are supposed to be about the dictionary.
 */
function reportCardOutcome(token: EnrichedToken, answer: WordLookup, fromCache: boolean): void {
  if (!posthog.__loaded) return;

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

/**
 * Put the card where the word is, once and for good.
 *
 * The decision itself is `placeCard`, which measures nothing: see the reasoning
 * there for why the side is settled before the card has any content, and why it
 * is never revisited when the content arrives.
 *
 * All this adds is the page scroll, because the card is placed on the PAGE
 * rather than on the screen. It therefore scrolls away with the sentence it
 * belongs to instead of following the reader down the page, and nothing has to
 * re-run on scroll to keep it honest.
 */
function placeTooltip(): void {
  const anchor = hoveredElement;
  if (!anchor?.isConnected) return;
  const tokenRect = anchor.getBoundingClientRect();

  const placement = placeCard(tokenRect, { width: window.innerWidth, height: window.innerHeight });

  tooltipBelow.value = placement.below;
  tooltipStyle.value = {
    left: `${placement.left + window.scrollX}px`,
    top: `${placement.top + window.scrollY}px`,
    maxHeight: `${placement.maxHeight}px`,
  };
}

// Re-place an open card when the viewport is resized. One listener serves every
// sentence on the page, and it fires only on a WIDTH change -- see
// `onViewportWidthChange` for why a height-only change must not reach here.
onViewportWidthChange(() => {
  if (!hoveredToken.value) return;
  placeTooltip();
});

/**
 * Open the card for a token.
 *
 * Click rather than hover: hovering opened a card over every word the pointer
 * crossed on its way somewhere else, which made the sentence hard to read and
 * fired a lookup per word passed over. A click is deliberate, so the card only
 * appears when it was asked for, and it stays put until dismissed -- which is
 * what makes the links inside it reachable.
 */
/**
 * Warm the cache for a word the pointer is resting on.
 *
 * The card opens on click, and a lookup takes a round trip -- so without this
 * the reader clicks and then waits, every time. Hovering is a good signal they
 * are about to: the answer is usually here before the click lands, and the card
 * opens filled in rather than on "Looking up…".
 *
 * Cheap to be wrong about. The cache is shared and deduped, so a pointer sweeping
 * a sentence costs one request per distinct word and none at all for words
 * already seen; a hover that never becomes a click has warmed the cache for the
 * next reader of that word on the page.
 */
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

const onTokenHover = (token: EnrichedToken) => {
  if (!lookupsEnabled) return;

  // Only for a pointer that has STOPPED. Firing on every mouseenter meant a
  // pointer crossing a sentence on its way to one word started a request for
  // every token it passed over -- and with a browser capping concurrent requests
  // per host, the word actually clicked then queued behind a dozen nobody asked
  // for. That made the click slower than no prefetching at all, which is the
  // opposite of the point.
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
  pendingLookup = null;
  clearMined();
};

/**
 * The reader saying which word they actually meant.
 *
 * The pick is the whole reason the card offers a list. Shirabe ranks, never
 * filters -- a token it read badly costs a word its place in the list, never its
 * place in the dictionary -- so the reader is the one who settles it, and what
 * they settle is what gets carded: `minedCard` reads through `word`, which reads
 * through `picked`.
 *
 * Not remembered anywhere. Which word a token is depends on the dictionary and
 * on rules Shirabe keeps improving, so storing a pick would materialise a
 * decision that moves underneath it -- the same reasoning that took the id off
 * the token in the first place.
 */
const pickCandidate = (index: number) => {
  if (index === picked.value) return;
  const chosen = candidates.value[index];
  if (!chosen) return;

  if (posthog.__loaded) {
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
  }

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

/**
 * Picking from the LIST, which closes it.
 *
 * The list is a place to choose from, not a place to stay: the answer it was
 * opened to settle is the card above, and leaving it open leaves the reader
 * looking at the menu rather than the meal. Collapsing back to the chip row also
 * keeps the picked word on screen, since `pickerChips` guarantees it a chip.
 *
 * Only on CLICK. Arrow keys go on calling `pickCandidate` directly, because
 * closing the list under a keyboard reader would take away the thing their focus
 * is in and end the walk after one step.
 */
function pickFromList(index: number): void {
  pickCandidate(index);
  othersOpen.value = false;
}

/**
 * Walking the candidates from the keyboard.
 *
 * `tokenKeyAction` decides, which looks like reuse for its own sake and is not:
 * it is written over an arbitrary list of numeric keys, and the candidate
 * indices are one. It already settles the two things that go quietly wrong here
 * -- both axes move (Down is the list's own direction now, and Right still reads
 * as "next" to anyone who learned the row),
 * and the ends hold rather than wrapping, so arrowing off the last candidate
 * does not teleport the reader back to the first.
 *
 * Selection follows focus, which is the right call here whatever the widget is
 * called: each move opens that row's entry, so a reader arrowing down the list
 * is reading the definitions as they go rather than committing blind.
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

/**
 * Reaching the words without a mouse.
 *
 * The lookup was pointer-only: the tokens were plain `<span>`s with a click
 * handler, so nothing in a sentence could be focused and the whole dictionary
 * was unreachable from a keyboard. They are buttons now.
 *
 * One tab stop per sentence, not one per word. Making every token tabbable would
 * be the obvious fix and a bad one: a page of results is thousands of words, and
 * a reader tabbing to the footer would pay for every one of them. So the
 * sentence is the stop and the arrow keys walk it -- the roving-tabindex pattern
 * a composite widget is supposed to use. Exactly one token is tabbable at a time
 * and the arrows move which.
 *
 * Only the words worth asking about take part. Punctuation and whitespace are
 * skipped, because a stop on 、 is a stop on something the card has nothing to
 * say about.
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

// The one word on this card that is prose rather than data, and it is keyed by
// GLOSS language rather than by UI locale, so it cannot come from i18n: `t()`
// answers in the interface language, while this badge sits among definitions the
// reader chose to read in English or Spanish. Reading Nadeshiko in Japanese with
// Spanish glosses on, "常用" over "Frecuente" would be the odd one out.
const COMMON_LABEL: Record<GlossLanguage, string> = { en: 'Common', es: 'Frecuente' };

const { furiganaMode } = useHiraganaVisibility();
const { presets, isDictionaryEnabled } = useDictionaryLinks();

// 1. Head. The reading is the dictionary's, not the surface's: 焼けた reads
// やけた, but the word above the senses is 焼ける, and printing it over the
// inflected reading would be a lie. `headword` itself is declared up beside
// `word`, because the mining probe needs it too.
const headReading = computed(() => {
  const reading = word.value?.reading || hoveredToken.value?.readingHiragana || '';
  // For この the reading IS この, so a second copy of it adds nothing.
  if (reading === headword.value) return '';
  return reading;
});

/** The clip playing right now, by URL, so that only the button that started it
 *  lights up. A word read two ways has a button per accent, and a plain boolean
 *  lit both of them over a recording of one. */
const playingUrl = ref('');
let headAudio: HTMLAudioElement | null = null;

/** Stop whatever is playing and forget it was. The clip belongs to the word on
 *  the card, so it must not outlive it: leaving it to finish would light up the
 *  play button on the NEXT word the reader opens, over a recording of the last
 *  one. */
const stopHeadword = () => {
  headAudio?.pause();
  playingUrl.value = '';
};

const playHeadword = (src: string) => {
  if (!src) return;

  // One element, reused across every word on the page: clips are under a second
  // and a fresh Audio per click leaks one per lookup. Assigning `src` on an
  // element that is already playing replaces the clip, which is what re-clicking
  // should do anyway.
  if (!headAudio) {
    headAudio = new Audio();
    headAudio.addEventListener('ended', () => {
      playingUrl.value = '';
    });
    headAudio.addEventListener('error', () => {
      playingUrl.value = '';
    });
  }

  if (headAudio.src !== src) headAudio.src = src;
  headAudio.currentTime = 0;
  playingUrl.value = src;
  // A clip the CDN has lost, or a browser that declines to play, must not leave
  // the button stuck mid-play. Only if this clip is still the one playing,
  // though: switching accents mid-clip rejects the FIRST play() with an abort,
  // and clearing on that would darken the button of the clip that just started.
  headAudio.play().catch(() => {
    if (playingUrl.value === src) playingUrl.value = '';
  });
};

onBeforeUnmount(() => {
  stopHeadword();
  headAudio = null;
});

// 2. What this occurrence does to the dictionary form, outermost step first:
// 食べさせられた is "past · potential / passive · causative" rather than one name
// that would be true of only its last step.
// Ruby for the headword. Shirabe aligns it on the word response (`furigana`), so
// this is the dictionary form's own ruby: the token's `f` is aligned to the
// surface it appeared as, which is a different string (焼けた, not 焼ける).
/**
 * Ruby for the headword: Shirabe's alignment once the card has it, and the
 * token's own until then.
 *
 * Falling back matters for more than completeness. With only Shirabe's, the head
 * had NO furigana while the lookup was in flight, so the reading rendered as a
 * separate label beside the word -- and then jumped to ruby above it the moment
 * the answer arrived. The card visibly rebuilt itself mid-read. The token was
 * carrying furigana the whole time; using it keeps the head one shape from the
 * first frame, and Shirabe's replaces it invisibly because it is the same
 * alignment of the same word.
 */
const headFurigana = computed(() => {
  // Guarded: Shirabe's per-candidate furigana does not always spell that
  // candidate's headword. See `headwordFurigana`.
  const fromWord = headwordFurigana(word.value);
  if (fromWord.length > 0) return fromWord;

  // Only when the head IS the token's own surface. An inflected token shows its
  // dictionary form up here (食べている → 食べる), and the surface's ruby does not
  // align with a word it does not spell.
  const token = hoveredToken.value;
  if (!token || token.displaySurface !== headword.value) return [];
  return token.furigana.filter((seg) => seg.text).map((seg) => ({ text: seg.text, reading: seg.reading ?? '' }));
});

const inflectionLine = computed(() => {
  const token = hoveredToken.value;
  if (!token || token.inflectionLabels.length === 0) return '';
  // The chain alone -- "progressive · te-form" -- and not "食らって → 食らう ·
  // te-form". Both ends of that arrow are already on screen: the surface is the
  // word the reader just pointed at in the sentence, and the dictionary form is
  // the headword directly above this line. Spelling the conversion out again
  // pushed the one thing this line is FOR to the far right of it.
  //
  // The labels are Shirabe's own, verbatim from the parse, so a form reads the
  // same here as it does there: its wording carries the detail a bare name
  // would lose ("potential / passive", "provisional (〜ば)").
  return token.inflectionLabels.join(' · ');
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

/**
 * 4. Pitch accent. Two patterns at most: a word read four ways is rare enough
 * that it must not push the senses out of a hover card.
 *
 * Each pattern carries its own clip, which Shirabe pre-generates per (reading,
 * accent) and serves off its public CDN -- there is nothing to request, nothing
 * to authorize, and no work for our own API to do. The clip is per pattern and
 * not per word on purpose: a word read two ways is two recordings, and one
 * button in front of both would play whichever happened to exist while pointing
 * at an accent it might not be. Coverage lights up batch by batch, so a pattern
 * with no recording simply has no button -- a dead speaker icon invites a click
 * that does nothing.
 */
const pitchPatterns = computed(() => {
  const reading = word.value?.reading;
  if (!reading) return [];
  return (word.value?.pitch ?? []).slice(0, 2).map((pattern) => ({
    downstep: pattern.downstep,
    audioUrl: pattern.audioUrl ?? '',
    morae: pitchMorae(reading, pattern.downstep),
  }));
});

// 5 and 6. The senses, and the kanji the headword is written with.
const senses = computed(() => cardSenses(word.value, glossLanguages.value));

/** How many dictionaries this card is made of. One for every reader who has not
 *  linked a Shirabe account, which is what decides whether the senses are worth
 *  attributing at all. */
const sourceCount = computed(() => new Set(senses.value.map((sense) => sense.dictionary)).size);

/**
 * Whether to name the dictionary above its senses.
 *
 * More than one on the card, obviously. But also whenever the reader has LINKED
 * an account, even for a single dictionary, and that second case is the useful
 * one: their stack does not have every word in it, so a word none of their
 * dictionaries carries falls back to the one that resolved it -- and unlabelled,
 * that card is an English definition appearing among Japanese ones for no
 * visible reason. Naming it answers the question before it is asked.
 *
 * A reader who linked nothing always reads one dictionary, so a label on every
 * card would be noise charged to everybody for a case they cannot be in.
 */
const namesSources = computed(() => sourceCount.value > 1 || userStore().shirabeLinked);

/**
 * The words this one is made of, when it is a merged expression.
 *
 * The row exists because a merge DELETES what it spans. 男を知っている is one
 * chip covering 男 (rank 156) and 知る (69), and the expression is the only
 * candidate the resolver returns -- so without this there is no way to reach
 * either word: not by hovering, since the chip covers them, and not through the
 * picker, since there is nothing else in it.
 *
 * Only the ones Shirabe could resolve to a word. A part with no id is a spelling
 * we cannot open, and a chip that does nothing when clicked is worse than no
 * chip.
 */
const wordParts = computed(() => (word.value?.parts ?? []).filter((part) => part.id));

/**
 * Open a part in the card that is showing its parent.
 *
 * The same lookup the card already makes for a hovered token, asked about a
 * different word: the part becomes the card, with its own senses, pitch and
 * picker. Nothing is pushed or navigated, so the reader is one hover away from
 * the sentence they were reading.
 */
/**
 * Which DICTIONARIES the reader has ticked, by `dictionaryKey`.
 *
 * This replaced a drag-to-highlight capture that read `window.getSelection()`
 * off the card. Dragging could say more -- half a sense, one gloss out of three
 * -- but it said it invisibly: nothing on screen indicated a selection was
 * armed, so the feature was undiscoverable to everyone who had not read the
 * field list in settings, and a stray drag while reading silently changed what
 * the next mine wrote. Ticking is coarser and legible, and legible wins on a
 * control whose mistakes are only ever found weeks later on a review card.
 *
 * The dictionary is the unit a reader actually chooses in. A stack is assembled
 * deliberately -- a monolingual pack on top, JMdict underneath as a safety net
 * -- so "this word gets 大辞泉 only" re-applies a decision they have already
 * made once, where "senses 1 and 3" is one they would have to make again for
 * every word. It is also the unit the exported note already speaks in: the
 * markup names its dictionaries above the senses they wrote.
 *
 * Keyed rather than indexed, so a pick survives the list re-rendering under it:
 * turning a gloss language off drops senses and renumbers the rest.
 *
 * Cleared whenever the card changes which word it is ABOUT -- closing, walking
 * into a part, stepping back, or picking another candidate. Carrying a pick to
 * a different word would put one word's definition on another word's note.
 */
/** Shared, so `pickedForExport` returns the same identity on every card that is
 *  not trimming rather than a fresh set per evaluation. */
const NO_PICK: ReadonlySet<string> = new Set<string>();

const pickedDictionaries = ref<Set<string>>(new Set());

const clearPicked = () => {
  if (pickedDictionaries.value.size > 0) pickedDictionaries.value = new Set();
};

/** Reassigned rather than mutated: a `Set` is not deeply reactive, so a card
 *  that ticked in place would not repaint. */
const togglePick = (key: string) => {
  const next = new Set(pickedDictionaries.value);
  if (!next.delete(key)) next.add(key);
  pickedDictionaries.value = next;
};

/**
 * The dictionaries on the card, in the order they are printed.
 *
 * Deduplicated on the key rather than the name for the reason `dictionaryKey`
 * exists: two of a reader's own uploads can share a title, and fusing them into
 * one toggle would hand somebody who ticked one the senses of both.
 */
const cardDictionaries = computed(() => {
  const seen = new Map<string, string>();
  for (const sense of senses.value) {
    const key = dictionaryKey(sense);
    if (!seen.has(key)) seen.set(key, sense.dictionary);
  }
  return [...seen].map(([key, name]) => ({ key, name }));
});

const deselectAllDictionaries = () => {
  pickedDictionaries.value = new Set();
};

/**
 * Whether to offer the toggles at all.
 *
 * Gated on the same configuration the mine button is, because a pick with
 * nowhere to go is a control that does nothing: a reader with no Anki profile
 * would be ticking dictionaries into the void, and so would one whose profile
 * writes no definition anywhere.
 *
 * And never for a single-dictionary card, which is most of them: ticking the
 * only dictionary there is means the same thing as ticking nothing, so the
 * control would be a checkbox that cannot change the outcome.
 */
const canPickDictionaries = computed(
  () => canConfigureMine.value && !!props.result && mapsDefinition.value && cardDictionaries.value.length > 1,
);

/**
 * What actually reaches the note.
 *
 * All of them and none of them are the same instruction -- "do not trim" -- and
 * both hand `minedWord` an empty set, so `{definition}` keeps the whole stack it
 * has always held. That is what makes "Deselect all" safe: it is how a reader
 * starts a pick over, not a way to mine a card with no definition on it.
 */
const pickedForExport = computed(() => {
  const size = pickedDictionaries.value.size;
  if (size === 0 || size === cardDictionaries.value.length) return NO_PICK;
  return pickedDictionaries.value;
});

/** The card stating what it will export. */
const pickSummary = computed(() =>
  t('tokenTooltip.pickedDictionaries', {
    count: pickedDictionaries.value.size,
    total: cardDictionaries.value.length,
  }),
);

type CardLocation = { lemma: string; surface: string; reading: string; pos: string };

/**
 * Where the card is standing, relative to the token it opened on.
 *
 * `trail` is the parts the reader has opened, deepest last; empty means they are
 * on the word the card opened on, which is why the original never needs storing
 * -- `hoveredToken.lookupRef` still holds it. `forward` is what they have stepped
 * back out of, discarded the moment they walk somewhere new, which is what every
 * back/forward pair does and what stops the two disagreeing.
 */
const trail = ref<CardLocation[]>([]);
const forward = ref<CardLocation[]>([]);
const canGoBack = computed(() => trail.value.length > 0);
const canGoForward = computed(() => forward.value.length > 0);

/** The card's own lookup, shared by the parts row and both history controls, so
 *  all three paint an answer the same way and guard staleness the same way. */
async function loadLocation(location: CardLocation): Promise<void> {
  const locale = glossLanguages.value.labels;

  // Before the cache hit as well as after it: walking into a part is a different
  // word whether or not we already had it, and a pick carried across would trim
  // the new word's definition to the old word's sense numbers.
  clearPicked();

  const cached = peekWord(location, locale);
  if (cached !== undefined) return applyLookup(cached);

  clearLookup();
  wordState.value = 'loading';
  // Guarded like the hover path: a slow answer for a word the reader has since
  // navigated away from must not paint over whatever they are looking at now.
  const asked = `${location.lemma}|${location.surface}|${location.reading}|${location.pos}`;
  pendingLookup = asked;
  const found = await fetchWord(location, locale);
  if (pendingLookup !== asked) return;
  pendingLookup = null;
  applyLookup(found);
}

/** The token the card opened on, which is where an empty trail points. */
function openedOn(): CardLocation | null {
  const ref = hoveredToken.value?.lookupRef;
  return ref ? { lemma: ref.lemma, surface: ref.surface, reading: ref.reading, pos: ref.pos } : null;
}

function currentLocation(): CardLocation | null {
  return trail.value[trail.value.length - 1] ?? openedOn();
}

async function showPart(part: { lemma: string; text: string; reading?: string }): Promise<void> {
  const location = { lemma: part.lemma, surface: part.text, reading: part.reading ?? '', pos: '' };
  trail.value = [...trail.value, location];
  forward.value = [];
  await loadLocation(location);
}

async function goBack(): Promise<void> {
  const left = trail.value[trail.value.length - 1];
  if (!left) return;
  trail.value = trail.value.slice(0, -1);
  forward.value = [...forward.value, left];
  const target = currentLocation();
  if (target) await loadLocation(target);
}

async function goForward(): Promise<void> {
  const next = forward.value[forward.value.length - 1];
  if (!next) return;
  forward.value = forward.value.slice(0, -1);
  trail.value = [...trail.value, next];
  await loadLocation(next);
}

/** Nothing survives the card closing or moving to another word: the trail is
 *  about one card's worth of wandering, not a page-level history. */
function clearTrail(): void {
  trail.value = [];
  forward.value = [];
}

/** The other spellings this word is written with. Only from the detail call:
 *  identify carries them behind `include=forms`, which we do not send yet. */
const forms = computed(() => cardForms(word.value));
const definitionsAreHidden = computed(
  () => word.value !== null && senses.value.length === 0 && hiddenDefinitionLanguages.value.length > 0,
);
const revealHiddenDefinitions = () => {
  revealDefinitions.value = true;
};
const kanjiChips = computed(() =>
  kanjiIn(headword.value).map((character) => ({
    character,
    href: shirabeKanjiUrl(character, glossLanguages.value.labels),
  })),
);

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
  if (posthog.__loaded) {
    posthog.capture('anki_note_viewed_from_card', { lemma: miningWord.value });
  }
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
      .toSorted((a, b) => Number(b.required ?? false) - Number(a.required ?? false))
      .map((preset) => ({
        id: preset.id,
        label: preset.label,
        // Shirabe's id for this word is the slug of its own page, so hand it over
        // once the card has it: it names the homograph the surface cannot.
        href: preset.buildUrl(token.dictForm, token.readingHiragana, word.value?.id, glossLanguages.value.labels),
      }))
  );
});

/**
 * What the card is showing RIGHT NOW, in the same buckets `word_card_opened`
 * reports.
 *
 * Derived from rendered state rather than remembered from the fetch, which is
 * the point: this is read at the moment a reader gives up on the card and
 * leaves, so it has to say what was in front of them then. `revealDefinitions`
 * can turn a `no_senses` card into a `shown` one without any fetch happening.
 *
 * 'loading' is a real bucket and not a gap in the others -- a reader who clicks
 * out while the spinner is still up never saw a definition to be dissatisfied
 * with, and folding those into `no_senses` would blame the dictionary for the
 * lookup being slow.
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

/**
 * A reader leaving the card for a dictionary, classified by which one.
 *
 * The question this exists to answer is not "how much traffic do we send
 * Shirabe" -- it is "when the card had an answer, how often did the reader go
 * looking for a second opinion anyway". That needs `outcome` on the click
 * itself: a click on Jisho off a `missing` card is the card working as intended
 * and handing the reader on, while the same click off a `shown` card is the
 * definition not being good enough. Reading either one without the other tells
 * you nothing, and joining back to `word_card_opened` in a funnel would drop
 * every reader who opened the card more than once.
 *
 * `position` because the row is ordered and the first chip is clicked more for
 * being first. Without it, Shirabe's share is unreadable -- it always leads.
 *
 * No `sendBeacon` dance: every one of these links is `target="_blank"`, so the
 * page it fires from is still there when the request goes out.
 */
function reportDictionaryClick(dictionary: DictionaryId, surface: ShirabeLinkSurface, position: number): void {
  if (!posthog.__loaded) return;

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
            <component
              :is="hoveredToken ? 'button' : 'span'"
              v-bind="hoveredToken ? { type: 'button' } : {}"
              class="token-tooltip__word"
              :class="{ 'token-tooltip__word--action': hoveredToken }"
              lang="ja"
              @click="hoveredToken && searchForWord(headword)"
            >
              <template v-if="headFurigana.length > 0"><template v-for="(seg, si) in headFurigana" :key="si"><ruby v-if="seg.reading">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template>
              <template v-else>{{ headword }}</template>
            </component>
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

          <!-- The other words this spelling can name.
               
               Pinned under the scrolling body rather than inside it, the way the
               chip row used to be pinned above it, and for the reason that put
               the chips there: a choice the reader cannot see without scrolling
               is a choice they will not know they have. This list sits at the END
               of a card whose body is often taller than the card, so inside the
               scroll it would be invisible exactly when a word has enough senses
               to be worth doubting.

               Two states, because the two questions are different sizes. "Is it
               one of a couple of obvious others?" is a glance, and a row of
               chips answers it without spending height. "Which of these nine is
               it?" needs to know what each one MEANS, which a chip cannot say --
               so the overflow opens a list where every row carries its gloss.
               The row is not shown beside the list: they are the same candidates,
               and printing both reads as two different sets. -->
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

          <!--
            What the mine is about to write, and the way back out of it.

            Absent until the reader ticks something, because until then there is
            nothing to say: an untouched card exports every dictionary, which is
            what it has always done and what the senses above already show. The
            row is the pick's own footprint -- it appears with the first tick,
            and "Deselect all" is what makes it go away again.

            In the footer rather than under the senses, because it is a summary
            of the whole list rather than a note on its last row -- and because
            the alternative put it between the senses and the "no definitions"
            branch that follows them, which broke that `v-else-if` chain.
          -->
          <div
            v-if="canPickDictionaries && pickedDictionaries.size > 0"
            class="token-tooltip__pick"
            data-testid="word-pick-summary"
          >
            <span class="token-tooltip__pick-text">{{ pickSummary }}</span>
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

/* The word the open card is about. The hover tint cannot say this on its own: a
   reader who has moved the pointer off the word to read the card loses every
   trace of which word they opened, and in a sentence where several look alike
   that is a real question. Accent rather than a brighter neutral, so the
   highlight and the card it opened read as one thing.

   `.token.token--open` rather than `.token--open`, to match the specificity of
   `.token:hover` above and win on source order -- otherwise pointing at the open
   word would replace the accent with the ordinary hover grey. */
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
  /* A fixed width, not `max-content`. Shrink-to-fit meant the card was one width
     while it said "Looking up…" and another once the senses arrived, so it slid
     sideways under the reader as it filled in -- and `placeTooltip` could not
     clamp it to the viewport in one pass, because the width it was clamping was
     not the final one. These four numbers are `BOX` in ~/utils/cardPlacement;
     keep them in step. */
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
/* The back/forward pair, in the header's right-hand group beside the mine
   button rather than in front of the headword: this is where the reader came
   from, not what the card is about, and the word has to be the first thing read.

   `margin-left: auto` pushes the group right, and the sibling rule below takes
   that auto OFF the tools when these arrows precede them. Two auto margins on one
   flex line do not stack the way it reads: the free space is split EQUALLY
   between them, which would have parked the arrows halfway across the header. */
.token-tooltip__nav {
  flex: 0 0 auto;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 3px;
  margin-left: auto;
}
/* The arrows already pushed the group right; a second auto here would take half
   the free space back. Tools keep their own auto for the ordinary card, which
   has no arrows at all. */
.token-tooltip__nav + .token-tooltip__tools {
  margin-left: 4px;
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

/* The candidate row. Pinned like the head above it -- `flex: 0 0 auto` so a long
   list never eats the senses' share of a capped-height card -- and allowed to
   wrap, because a long list does not fit across one line and a horizontal
   scroller hides the ones a reader most needs to see. */
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

/* The links row brings its own 10px above its rule, which is right when it
   follows the body and wrong when it follows the pill row: there the reader sees
   8px above the pills and 18px below them, and the row reads as belonging to the
   dictionaries under it rather than sitting between the two. Its own padding is
   symmetric; this is what makes the gap look it. */
.token-tooltip__others + .token-tooltip__links {
  margin-top: 0;
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

/* What the row is FOR. Takes the rest of the line and truncates rather than
   wrapping: two-line rows stop being a list you can run your eye down, and the
   full text is one click away by definition. */
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

/* No padding of its own: `.token-tooltip__body` already insets every row by
   14px, and repeating it here pushed the badges 28px in while the senses, parts
   and kanji beside them sat at 14 -- measured 485 against 471, the one row on
   the card that did not line up with the word it describes. The inflection line
   above and the forms row below carried the same leftover, from before these
   three were moved inside the scrolling body. */
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
  /* Scrolling to the end of the card does not then start scrolling the page
     behind it. Without this the reader reaches the last sense and the sentence
     they were reading slides away underneath -- and on a card opened by HOVER,
     the page moving is enough to take the word out from under the cursor and
     dismiss the thing they were reading. `contain` rather than `none` so the
     card still rubber-bands at its own ends, which is the feedback that says
     "this is the end" rather than "this is stuck". */
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

/* No markers and no gutter: the numbers are cells of their own rows below, so
   the list needs neither the indent nor the counter it used to draw.

   The number column and its gap are variables because three rules depend on
   them and they have to agree: the row's own grid, and the two indent steps,
   which are exactly one column-plus-gap each so a sub-sense's number lands where
   its parent's text starts. Spelling the arithmetic out three times is how a
   sub-sense ends up hanging between its parent's number and its text. */
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

.token-tooltip__source-row.is-picked .token-tooltip__source {
  color: var(--accent);
  font-weight: 700;
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

/* Which dictionary the senses under it came from. Quieter than the language
   badge beside the glosses: it is an answer to "where is this from", asked
   rarely, and it must not compete with the definition it introduces. */
/* Sized and cased for a NAME, which is what this now holds. It was 9px
   uppercase with letter-spacing back when it printed a slug (`jmdict`); at that
   size 精選版　日本国語大辞典 is a smudge, and uppercasing does nothing to
   Japanese but does strand the styling on a rule that no longer applies. */
.token-tooltip__source {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-faint);
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
