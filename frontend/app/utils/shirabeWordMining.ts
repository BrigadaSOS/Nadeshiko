import {
  escapeHtml,
  pitchCategory,
  renderDefinitionHtml,
  renderPitchHtml,
  type Definition,
  type Sense,
} from '@shirabe-org/card/word-card';
import { furiganaSegments } from '@shirabe-org/card/word-card/furigana';
import type { MinedWord } from '~/utils/ankiWord';
import type { EnrichedToken } from '~/utils/tokenEnrichment';
import { furiganaNotation } from '~/utils/tokenEnrichment';

const definitionHtml = (senses: Sense[]): string => renderDefinitionHtml(senses, 'nd');

function highlightedSentence(text: string, token: EnrichedToken | null): string {
  if (!text) return '';
  if (!token || text.slice(token.b, token.e) !== token.s) return `<div>${escapeHtml(text)}</div>`;
  return `<div>${escapeHtml(text.slice(0, token.b))}<b class="nd-target">${escapeHtml(token.s)}</b>${escapeHtml(text.slice(token.e))}</div>`;
}

function audioFilename(reading: string, downstep: number, url: string): string {
  const safe = reading.replace(/[^\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z0-9ー]/gu, '') || 'word';
  const extension = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase() ?? 'mp3';
  return `nadeshiko-word-${safe}-${downstep}.${extension}`;
}

/** Render the definition shown by the SDK into Nadeshiko's existing Anki fields. */
export function minedWordFromShirabeCard(
  definition: Definition | null,
  token: EnrichedToken | null,
  sentence: string,
  selectedDictionaries: ReadonlySet<string> | null = null,
): MinedWord | null {
  if (!token) return null;
  const word = definition?.headword ?? token.dictForm;
  const reading = definition?.reading ?? token.readingHiragana;
  const groups = new Map<string, Sense[]>();
  for (const sense of definition?.senses ?? []) {
    const slug = sense.ref?.split('#')[0] ?? sense.dictionary ?? '';
    if (selectedDictionaries && !selectedDictionaries.has(slug)) continue;
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug)?.push(sense);
  }
  const definitionsByDictionary = Object.fromEntries(
    [...groups].filter(([slug]) => slug).map(([slug, senses]) => [slug, definitionHtml(senses)]),
  );
  const allDefinitions = definitionHtml([...groups.values()].flat());
  const firstGroup = groups.values().next().value as Sense[] | undefined;
  const source =
    allDefinitions && definition?.url
      ? `<div class="nd-source"><a class="nd-source-link" href="${escapeHtml(definition.url)}">View on shirabe.org</a></div>`
      : '';
  const aligned = definition?.furigana?.map((part) => ({ text: part.text, reading: part.ruby ?? '' }));
  const usableRuby = aligned?.map((part) => part.text).join('') === word ? aligned : null;
  const ruby =
    usableRuby ??
    (definition && reading
      ? furiganaSegments(word, reading).map((part) => ({ text: part.text, reading: part.ruby ?? '' }))
      : [{ text: word, reading: '' }]);
  const recording = definition?.pitch.find((pitch) => pitch.audioUrl);
  const badges = [
    definition?.common ? 'Common' : '',
    definition?.jlpt ?? '',
    definition?.frequency != null ? `#${definition.frequency}` : '',
  ]
    .filter(Boolean)
    .map((badge) => `<span class="nd-badge">${escapeHtml(badge)}</span>`)
    .join('');

  return {
    word,
    reading: reading === word ? '' : reading,
    furigana: furiganaNotation(ruby),
    definition: allDefinitions + source,
    definitionFirst: firstGroup ? definitionHtml(firstGroup) + source : '',
    definitionsByDictionary,
    pickedDictionaries: selectedDictionaries?.size ?? 0,
    frequency: definition?.frequency != null ? String(definition.frequency) : '',
    jlpt: definition?.jlpt ?? '',
    pitchCategories: definition?.pitch.map((pitch) => pitchCategory(reading, pitch.downstep)).join(', ') ?? '',
    pitch: definition?.pitch[0] ? renderPitchHtml(reading, definition.pitch[0].downstep, 'nd') : '',
    pitchPositions: definition?.pitch.map((pitch) => pitch.downstep).join(', ') ?? '',
    info: badges ? `<span class="nd-badges">${badges}</span>` : '',
    sentenceHighlight: highlightedSentence(sentence, token),
    audioUrl: recording?.audioUrl ?? null,
    audioFilename: recording?.audioUrl ? audioFilename(reading, recording.downstep, recording.audioUrl) : null,
  };
}
