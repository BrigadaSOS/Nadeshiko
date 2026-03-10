import type { SlimToken } from '../SegmentDocument';

interface CharRange {
  start: number;
  end: number;
}

const COMPOUND_EXTENDING_POS = new Set(['助動詞']);
const COMPOUND_STEM_POS = new Set(['動詞', '形容詞', '名詞']);

export function enhanceHighlight(highlight: string, tokens: SlimToken[]): string {
  if (!highlight || tokens.length === 0) return highlight;

  const highlightedRanges = parseHighlightRanges(highlight);
  if (highlightedRanges.length === 0) return highlight;

  const compoundRanges = buildCompoundRanges(highlightedRanges, tokens);
  return buildEnhancedHighlight(highlight, tokens, highlightedRanges, compoundRanges);
}

function parseHighlightRanges(highlight: string): CharRange[] {
  const ranges: CharRange[] = [];
  let charPos = 0;
  let i = 0;

  while (i < highlight.length) {
    if (highlight.startsWith('<em>', i)) {
      const emStart = charPos;
      i += 4; // skip <em>

      while (i < highlight.length && !highlight.startsWith('</em>', i)) {
        charPos++;
        i++;
      }

      if (highlight.startsWith('</em>', i)) {
        ranges.push({ start: emStart, end: charPos });
        i += 5; // skip </em>
      }
    } else {
      charPos++;
      i++;
    }
  }

  return ranges;
}

function buildCompoundRanges(highlightedRanges: CharRange[], tokens: SlimToken[]): CharRange[] {
  const compoundRanges: CharRange[] = [];

  for (const range of highlightedRanges) {
    const overlappingTokens = tokens.filter(
      (t) => t.b < range.end && t.e > range.start,
    );

    const hasStem = overlappingTokens.some((t) => COMPOUND_STEM_POS.has(t.p));
    if (!hasStem) continue;

    const lastOverlapping = overlappingTokens[overlappingTokens.length - 1];
    const lastIdx = tokens.indexOf(lastOverlapping);
    if (lastIdx === -1) continue;

    let extendEnd = range.end;
    for (let j = lastIdx + 1; j < tokens.length; j++) {
      const next = tokens[j];
      if (next.b !== extendEnd) break;
      if (!COMPOUND_EXTENDING_POS.has(next.p)) break;
      extendEnd = next.e;
    }

    if (extendEnd > range.end) {
      compoundRanges.push({ start: range.end, end: extendEnd });
    }
  }

  return compoundRanges;
}

function buildEnhancedHighlight(
  originalHighlight: string,
  _tokens: SlimToken[],
  _highlightedRanges: CharRange[],
  compoundRanges: CharRange[],
): string {
  if (compoundRanges.length === 0) return originalHighlight;

  const plainText = originalHighlight.replace(/<\/?em>/g, '');

  const tagInsertions: { pos: number; tag: string; priority: number }[] = [];

  let charPos = 0;
  let i = 0;
  while (i < originalHighlight.length) {
    if (originalHighlight.startsWith('<em>', i)) {
      tagInsertions.push({ pos: charPos, tag: '<em>', priority: 2 });
      i += 4;
    } else if (originalHighlight.startsWith('</em>', i)) {
      tagInsertions.push({ pos: charPos, tag: '</em>', priority: 0 });
      i += 5;
    } else {
      charPos++;
      i++;
    }
  }

  for (const range of compoundRanges) {
    tagInsertions.push({ pos: range.start, tag: '<mark>', priority: 3 });
    tagInsertions.push({ pos: range.end, tag: '</mark>', priority: 1 });
  }

  tagInsertions.sort((a, b) => a.pos - b.pos || a.priority - b.priority);

  let result = '';
  let lastPos = 0;
  for (const insertion of tagInsertions) {
    if (insertion.pos > lastPos) {
      result += plainText.slice(lastPos, insertion.pos);
    }
    result += insertion.tag;
    lastPos = insertion.pos;
  }
  if (lastPos < plainText.length) {
    result += plainText.slice(lastPos);
  }

  return result;
}
