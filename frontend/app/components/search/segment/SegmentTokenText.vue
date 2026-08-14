<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import { enrichTokens, type SlimToken, type EnrichedToken } from '~/utils/tokenEnrichment';
import { placeCard } from '~/utils/cardPlacement';
import { tabStop, tokenKeyAction } from '~/utils/tokenNavigation';
import {
  cardSenses,
  glossPreference,
  kanjiIn,
  pitchMorae,
  shirabeKanjiUrl,
  type GlossLanguage,
} from '~/utils/wordCard';
import { fetchWord, peekWord, type WordLookup } from '~/utils/wordLookup';
import { mdiStarCheckOutline, mdiStarPlusOutline } from '@mdi/js';
import type { SearchResult } from '~/types/search';
// The singleton, not `usePostHog()`. That composable resolves through
// `useNuxtApp()`, which throws when it is reached from a detached async
// continuation -- and the outcome below is reported after `await fetchWord`,
// which is exactly one. Same reasoning, and the same import, as `reportError`.
import posthog from 'posthog-js';

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
const { locale } = useI18n();

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
const glossLanguages = computed(() => glossPreference(locale.value, { en: englishMode.value, es: spanishMode.value }));

// Definitions come from Shirabe, which parsed these tokens and stamped each one
// with the id of its own entry. Fetched through our server route so the service
// key stays on the server, and cached in `~/utils/wordLookup` -- a module, so one
// answer serves every segment on the page rather than every segment keeping its
// own copy.
const word = ref<ShirabeWord | null>(null);
// 'missing' is specifically "we asked and there is no entry", which the card
// says out loud. It is not the same as "we never asked" (lookups unconfigured,
// a token that could not be a word) -- claiming no entry for a question nobody
// put would be a lie, so those stay 'idle' and the card simply answers from the
// token alone, which is what it did before any of this loaded.
const wordState = ref<'idle' | 'loading' | 'missing'>('idle');
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
 *  食べる, whatever the sentence inflected it to. Read off the TOKEN rather than
 *  off `headword`, so the probe can start the moment the card opens instead of
 *  waiting for a dictionary lookup it does not depend on -- and so that closing
 *  the card empties it, which is what cancels a probe still in flight. */
const miningWord = computed(() => hoveredToken.value?.dictForm ?? '');

const { minedNoteId, mining, canMine, probeMined, clearMined, openMinedNote, mineSentence } = useWordMining(
  () => props.result,
  () => miningWord.value,
);

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
    word.value = null;
    wordState.value = 'idle';
    return;
  }

  if (!isAskable(token)) {
    word.value = null;
    wordState.value = 'idle';
    return;
  }

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

  word.value = null;
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

/** Paint an answer, whichever of the three it is. Only a dictionary that
 *  answered "no such word" reaches 'missing' and is said out loud; a lookup that
 *  could not be made leaves the card quiet, on what the token itself knows. */
function applyLookup(answer: WordLookup): void {
  word.value = answer.word;
  wordState.value = !answer.word && answer.reason === 'missing' ? 'missing' : 'idle';
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
    outcome: answer.word ? (senses.value.length > 0 ? 'shown' : 'no_senses') : answer.reason,
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
  stopHeadword();
  if (returnTo?.isConnected) returnTo.focus();
  // Reset, so the next open never inherits this one's tail. A request abandoned
  // in flight (the reader closed the card before it answered) returns early
  // without touching `wordState`, which used to leave it reading 'loading'
  // forever -- the card reopened stuck on "Looking up…" until something else
  // happened to reset it.
  word.value = null;
  wordState.value = 'idle';
  pendingLookup = null;
  clearMined();
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

// 1. Head. The headword is the dictionary form and the reading is the
// dictionary's, not the surface's: 焼けた reads やけた, but the word above the
// senses is 焼ける, and printing it over the inflected reading would be a lie.
const headword = computed(() => word.value?.headword ?? hoveredToken.value?.dictForm ?? '');

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
  const fromWord = (word.value?.furigana ?? [])
    .filter((seg) => seg.text)
    .map((seg) => ({ text: seg.text, reading: seg.ruby ?? '' }));
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
          :style="tooltipStyle"
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
              @click="hoveredToken && searchForWord(hoveredToken.dictForm)"
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
            <span v-if="canMine && result" class="token-tooltip__tools">
              <!-- Only when the collection says so. An always-present control
                   that is sometimes a no-op would be the easier thing to build
                   and would throw away the answer: the star's absence is what
                   tells the reader this word is new to them. -->
              <button
                v-if="minedNoteId !== null"
                type="button"
                class="token-tooltip__tool is-mined"
                :aria-label="$t('tokenTooltip.openInAnki')"
                :title="$t('tokenTooltip.openInAnki')"
                @click="viewMinedNote"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="mdiStarCheckOutline" fill="currentColor" /></svg>
              </button>
              <button
                type="button"
                class="token-tooltip__tool"
                :disabled="mining"
                :aria-label="minedNoteId !== null ? $t('tokenTooltip.mineToNote') : $t('tokenTooltip.mineToLastCard')"
                :title="minedNoteId !== null ? $t('tokenTooltip.mineToNote') : $t('tokenTooltip.mineToLastCard')"
                @click="mineThisSentence"
              >
                <span v-if="mining" class="token-tooltip__spinner" />
                <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="mdiStarPlusOutline" fill="currentColor" /></svg>
              </button>
            </span>
          </div>

          <p v-if="inflectionLine" class="token-tooltip__inflection">{{ inflectionLine }}</p>

          <div v-if="badges.length > 0" class="token-tooltip__badges">
            <span v-for="badge in badges" :key="badge.id" class="token-tooltip__badge" :class="badge.kind">{{ badge.text }}</span>
          </div>

          <!-- Live, because the interesting part of this card arrives after it
               opens. A reader who has been dropped into the dialog would
               otherwise sit on "Looking up…" in silence and never be told the
               definition had landed. It changes once per card, so polite
               announcement is not chatty. -->
          <div class="token-tooltip__body" aria-live="polite">
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
            <!-- The lookup came back with nothing: a name, a coinage, or a
                 spelling the corpus preserved and JMdict never had. Said out
                 loud, because a card that just stops after the headword reads as
                 one that is still loading, or broken. The word, its reading and
                 its kanji are all still up there, and the dictionary chips below
                 are exactly where to go next. -->
            <p v-else-if="wordState === 'missing'" class="token-tooltip__pending">{{ $t('tokenTooltip.noEntry') }}</p>

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
              @click="searchForWord(hoveredToken.dictForm)"
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
  outline: 2px solid #df848d;
  outline-offset: 1px;
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

/* The word the open card is about. The hover tint cannot say this on its own: a
   reader who has moved the pointer off the word to read the card loses every
   trace of which word they opened, and in a sentence where several look alike
   that is a real question. Accent rather than a brighter neutral, so the
   highlight and the card it opened read as one thing.

   `.token.token--open` rather than `.token--open`, to match the specificity of
   `.token:hover` above and win on source order -- otherwise pointing at the open
   word would replace the accent with the ordinary hover grey. */
.token.token--open {
  background-color: rgba(223, 132, 141, 0.28);
}

.token.token--open:hover {
  background-color: rgba(223, 132, 141, 0.38);
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
  width: min(340px, calc(100vw - 24px));
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

/* Focus lands here when the card is opened from the keyboard, so it says so.
   Suppressing it would be the tidier-looking choice and the wrong one: the
   reader has just been moved somewhere, and this is what tells them where. */
.token-tooltip:focus-visible {
  outline: 2px solid var(--tt-accent);
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
.token-tooltip__word {
  font-size: 32px;
  font-weight: 600;
  line-height: 1.25;
  color: white;
  text-decoration: none;
  /* Shrinkable, so the Anki buttons that share this row keep their place: a
     flex item's default `min-width: auto` refuses to go below its content, and
     a long headword would push them off the edge of a 340px card. */
  min-width: 0;
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
  background: rgba(255, 255, 255, 0.06);
  color: var(--tt-ink-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__tool:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  color: var(--tt-ink);
}

.token-tooltip__tool:disabled {
  cursor: default;
  opacity: 0.6;
}

/* Lit, not merely present. This one is a statement about the reader's own
   collection -- they have this word -- and it has to be readable as one at a
   glance from across the card, which a grey icon among grey icons is not. */
.token-tooltip__tool.is-mined {
  background: rgba(223, 132, 141, 0.18);
  color: var(--tt-accent);
}

.token-tooltip__tool.is-mined:hover:not(:disabled) {
  background: rgba(223, 132, 141, 0.3);
  color: var(--tt-accent);
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
  background: rgba(255, 255, 255, 0.06);
  color: var(--tt-ink-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__audio:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--tt-ink);
}

.token-tooltip__audio.is-playing {
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
  color: var(--tt-accent, #f472b6);
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
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: color 0.12s ease;
}

.token-tooltip__word--action:hover {
  color: var(--tt-accent, #f472b6);
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
