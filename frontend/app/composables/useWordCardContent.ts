import { computed } from 'vue';
import {
  cardForms,
  cardSenses,
  headwordFurigana,
  kanjiIn,
  pitchMorae,
  shirabeKanjiUrl,
  type GlossLanguage,
  type GlossPreference,
} from '~/utils/wordCard';
import type { EnrichedToken } from '~/utils/tokenEnrichment';

// Use gloss language, not UI locale, so the badge matches the definitions around it.
const COMMON_LABEL: Record<GlossLanguage, string> = { en: 'Common', es: 'Frecuente' };

/**
 * Everything the word card PRINTS, derived from the word it is showing.
 *
 * Pure: no state, no requests, no side effects -- each value is a function of
 * the picked word, the token the card opened on, and the reader's gloss
 * preference. That is what makes the card's rendering decisions testable without
 * mounting it, and it is why the lookup that produces `word` lives elsewhere.
 */
export function useWordCardContent(
  word: () => ShirabeWord | null,
  token: () => EnrichedToken | null,
  headword: () => string,
  glossLanguages: () => GlossPreference,
  hiddenDefinitionLanguages: () => readonly GlossLanguage[],
  shirabeLinked: () => boolean,
) {
  // 1. Head. The reading is the dictionary's, not the surface's: 焼けた reads
  // やけた, but the word above the senses is 焼ける, and printing it over the
  // inflected reading would be a lie.
  const headReading = computed(() => {
    const reading = word()?.reading || token()?.readingHiragana || '';
    // For この the reading IS この, so a second copy of it adds nothing.
    if (reading === headword()) return '';
    return reading;
  });

  /**
   * Use token furigana until Shirabe's alignment arrives so the headword does not change layout
   * mid-read.
   */
  const headFurigana = computed(() => {
    // Guarded: Shirabe's per-candidate furigana does not always spell that
    // candidate's headword. See `headwordFurigana`.
    const fromWord = headwordFurigana(word());
    if (fromWord.length > 0) return fromWord;

    // Only when the head IS the token's own surface. An inflected token shows its
    // dictionary form up here (食べている → 食べる), and the surface's ruby does not
    // align with a word it does not spell.
    const current = token();
    if (!current || current.displaySurface !== headword()) return [];
    return current.furigana.filter((seg) => seg.text).map((seg) => ({ text: seg.text, reading: seg.reading ?? '' }));
  });

  // 2. What this occurrence does to the dictionary form, outermost step first:
  // 食べさせられた is "past · potential / passive · causative" rather than one name
  // that would be true of only its last step.
  const inflectionLine = computed(() => {
    const current = token();
    if (!current || current.inflectionLabels.length === 0) return '';
    // Show Shirabe's inflection labels verbatim. Surface and headword are already visible, so
    // omit the redundant conversion arrow.
    return current.inflectionLabels.join(' · ');
  });

  // 3. Badges: how common the word is, in the three ways the dictionary knows.
  const badges = computed(() => {
    const found = word();
    if (!found) return [];
    const items: Array<{ id: string; text: string; kind: string }> = [];
    if (found.common) items.push({ id: 'common', text: COMMON_LABEL[glossLanguages().labels], kind: 'is-common' });
    if (found.jlpt) items.push({ id: 'jlpt', text: found.jlpt, kind: 'is-jlpt' });
    if (typeof found.frequency === 'number') items.push({ id: 'freq', text: `#${found.frequency}`, kind: 'is-freq' });
    return items;
  });

  /**
   * Limit pitch to two patterns so senses stay visible. Audio is per reading/accent on
   * Shirabe's public CDN; show a button only when that pattern has a recording.
   */
  const pitchPatterns = computed(() => {
    const reading = word()?.reading;
    if (!reading) return [];
    return (word()?.pitch ?? []).slice(0, 2).map((pattern) => ({
      downstep: pattern.downstep,
      audioUrl: pattern.audioUrl ?? '',
      morae: pitchMorae(reading, pattern.downstep),
    }));
  });

  // 5 and 6. The senses, and the kanji the headword is written with.
  const senses = computed(() => cardSenses(word(), glossLanguages()));

  /** How many dictionaries this card is made of. One for every reader who has not
   *  linked a Shirabe account, which is what decides whether the senses are worth
   *  attributing at all. */
  const sourceCount = computed(() => new Set(senses.value.map((sense) => sense.dictionary)).size);

  /**
   * Name sources for multiple dictionaries or any linked account, where an unexpected fallback
   * dictionary otherwise appears unexplained.
   */
  const namesSources = computed(() => sourceCount.value > 1 || shirabeLinked());

  /**
   * Merged expressions hide their constituent tokens; the parts row restores access. Offer only
   * resolved parts with ids, not inert chips.
   */
  const wordParts = computed(() => (word()?.parts ?? []).filter((part) => part.id));

  /** The other spellings this word is written with. Only from the detail call:
   *  identify carries them behind `include=forms`, which we do not send yet. */
  const forms = computed(() => cardForms(word()));

  /** An entry that exists but says nothing the reader can read, because they
   *  turned that language off. The card offers to show it anyway rather than
   *  looking empty for no visible reason. */
  const definitionsAreHidden = computed(
    () => word() !== null && senses.value.length === 0 && hiddenDefinitionLanguages().length > 0,
  );

  const kanjiChips = computed(() =>
    kanjiIn(headword()).map((character) => ({
      character,
      href: shirabeKanjiUrl(character, glossLanguages().labels),
    })),
  );

  return {
    headReading,
    headFurigana,
    inflectionLine,
    badges,
    pitchPatterns,
    senses,
    sourceCount,
    namesSources,
    wordParts,
    forms,
    definitionsAreHidden,
    kanjiChips,
  };
}
