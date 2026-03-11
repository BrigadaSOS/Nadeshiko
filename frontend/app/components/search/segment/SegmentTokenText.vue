<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';

type Props = {
  tokens: Token[];
  highlight?: string;
  content: string;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  'token-click': [dictionaryForm: string];
}>();

interface EnrichedToken extends Token {
  matchType: 'match' | 'compound' | 'none';
  searchText: string;
  groupId: number | null;
  dictForm: string;
  reading: string;
  posJa: string;
  posEn: string;
}

const STEM_POS = new Set(['動詞', '形容詞']);
const HIRAGANA_RE = /^[\u3040-\u309F]+$/;

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

const POS_LABELS: Record<string, string> = {
  '動詞': 'Verb',
  '名詞': 'Noun',
  '形容詞': 'Adjective',
  '副詞': 'Adverb',
  '助詞': 'Particle',
  '助動詞': 'Auxiliary',
  '連体詞': 'Adnominal',
  '接続詞': 'Conjunction',
  '感動詞': 'Interjection',
  '接頭辞': 'Prefix',
  '接尾辞': 'Suffix',
  '記号': 'Symbol',
  '補助記号': 'Punctuation',
  '空白': 'Whitespace',
};

const enrichedTokens = computed<EnrichedToken[]>(() => {
  const tokens = props.tokens;
  if (tokens.length === 0) return [];

  const highlight = props.highlight;
  const matchRanges: Array<{ start: number; end: number; type: 'match' | 'compound' }> = [];

  if (highlight) {
    let charPos = 0;
    let i = 0;

    while (i < highlight.length) {
      if (highlight.startsWith('<em>', i)) {
        const start = charPos;
        i += 4;
        while (i < highlight.length && !highlight.startsWith('</em>', i)) {
          charPos++;
          i++;
        }
        if (highlight.startsWith('</em>', i)) {
          matchRanges.push({ start, end: charPos, type: 'match' });
          i += 5;
        }
      } else if (highlight.startsWith('<mark>', i)) {
        const start = charPos;
        i += 6;
        while (i < highlight.length && !highlight.startsWith('</mark>', i)) {
          charPos++;
          i++;
        }
        if (highlight.startsWith('</mark>', i)) {
          matchRanges.push({ start, end: charPos, type: 'compound' });
          i += 7;
        }
      } else {
        charPos++;
        i++;
      }
    }
  }

  // Build compound groups: stem (verb/adjective) + consecutive auxiliaries/particles
  const groupByIndex = new Map<number, number>();
  const groupStemIndex = new Map<number, number>();
  let groupId = 0;
  let groupStart = -1;
  let groupStemPos = '';

  for (let idx = 0; idx < tokens.length; idx++) {
    const pos = tokens[idx]!.p;
    if (STEM_POS.has(pos)) {
      if (groupStart !== -1) groupId++;
      groupStart = idx;
      groupStemPos = pos;
      groupByIndex.set(idx, groupId);
      groupStemIndex.set(groupId, idx);
    } else if (groupStart !== -1 && HIRAGANA_RE.test(tokens[idx]!.s) && (pos === '助動詞' || (pos === '助詞' && STEM_POS.has(groupStemPos)))) {
      groupByIndex.set(idx, groupId);
    } else {
      if (groupStart !== -1) {
        groupId++;
        groupStart = -1;
      }
    }
  }

  // Build search text per group
  const groupSurfaces = new Map<number, string>();
  for (const [idx, gid] of groupByIndex) {
    const prev = groupSurfaces.get(gid) ?? '';
    groupSurfaces.set(gid, prev + tokens[idx]!.s);
  }

  // Count tokens per group to skip single-token groups
  const groupSizes = new Map<number, number>();
  for (const gid of groupByIndex.values()) {
    groupSizes.set(gid, (groupSizes.get(gid) ?? 0) + 1);
  }

  return tokens.map((token, idx) => {
    const range = matchRanges.find((r) => token.b < r.end && token.e > r.start);
    const gid = groupByIndex.get(idx);
    const isMultiTokenGroup = gid !== undefined && (groupSizes.get(gid) ?? 0) > 1;
    const stemIdx = gid !== undefined ? groupStemIndex.get(gid) : undefined;
    const stemToken = stemIdx !== undefined ? tokens[stemIdx] : undefined;

    const dictForm = isMultiTokenGroup && stemToken ? stemToken.d : token.d;
    const reading = isMultiTokenGroup && stemToken ? stemToken.r : token.r;
    const posForLabel = isMultiTokenGroup && stemToken ? stemToken.p : token.p;

    return {
      ...token,
      matchType: range?.type ?? ('none' as const),
      searchText: isMultiTokenGroup ? groupSurfaces.get(gid!)! : token.d,
      groupId: isMultiTokenGroup ? gid! : null,
      dictForm,
      reading: katakanaToHiragana(reading),
      posJa: posForLabel,
      posEn: POS_LABELS[posForLabel] ?? posForLabel,
    };
  });
});

const hoveredToken = ref<EnrichedToken | null>(null);
const hoveredGroup = ref<number | null>(null);
const tooltipStyle = ref<Record<string, string>>({});

const onTokenEnter = (token: EnrichedToken, event: MouseEvent) => {
  hoveredToken.value = token;
  hoveredGroup.value = token.groupId;
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const parentRect = el.closest('.token-text')!.getBoundingClientRect();
  tooltipStyle.value = {
    left: `${rect.left - parentRect.left + rect.width / 2}px`,
    top: `${rect.top - parentRect.top}px`,
  };
};

const onTokenLeave = () => {
  hoveredToken.value = null;
  hoveredGroup.value = null;
};

const posClass = (pos: string) => {
  switch (pos) {
    case '動詞': return 'token--verb';
    case '名詞': return 'token--noun';
    case '形容詞': return 'token--adjective';
    case '副詞': return 'token--adverb';
    case '助詞': return 'token--particle';
    case '助動詞': return 'token--auxiliary';
    default: return '';
  }
};
</script>

<template>
  <span class="token-text">
    <span
      v-for="token in enrichedTokens"
      :key="token.b"
      class="token"
      :class="[
        posClass(token.p),
        {
          'token--match': token.matchType === 'match',
          'token--compound': token.matchType === 'compound',
          'token--group-hover': token.groupId !== null && hoveredGroup === token.groupId,
        },
      ]"
      @click="emit('token-click', token.searchText)"
      @mouseenter="onTokenEnter(token, $event)"
      @mouseleave="onTokenLeave"
    >{{ token.s }}</span>

    <Transition name="tooltip">
      <div
        v-if="hoveredToken"
        class="token-tooltip"
        :style="tooltipStyle"
      >
        <div class="token-tooltip__left">
          <span class="token-tooltip__reading">{{ hoveredToken.reading }}</span>
          <span class="token-tooltip__word">{{ hoveredToken.dictForm }}</span>
        </div>
        <div class="token-tooltip__divider" />
        <div class="token-tooltip__right">
          <span class="token-tooltip__pos-ja">{{ hoveredToken.posJa }}</span>
          <span class="token-tooltip__pos-en">{{ hoveredToken.posEn }}</span>
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

.token--group-hover {
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

.token-tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  margin-top: -10px;
  display: flex;
  align-items: stretch;
  gap: 0;
  background: rgb(38 38 38);
  border: 1px solid rgb(64 64 64);
  border-radius: 10px;
  padding: 0;
  pointer-events: none;
  z-index: 50;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.token-tooltip__left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  gap: 2px;
}

.token-tooltip__reading {
  font-size: 11px;
  color: rgb(163 163 163);
  line-height: 1;
}

.token-tooltip__word {
  font-size: 20px;
  color: white;
  font-weight: 600;
  line-height: 1.2;
}

.token-tooltip__divider {
  width: 1px;
  background: rgb(64 64 64);
  align-self: stretch;
}

.token-tooltip__right {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  gap: 2px;
}

.token-tooltip__pos-ja {
  font-size: 13px;
  color: rgb(212 212 212);
  font-weight: 500;
}

.token-tooltip__pos-en {
  font-size: 11px;
  color: rgb(115 115 115);
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
</style>
