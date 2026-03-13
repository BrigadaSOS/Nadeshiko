<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';

type Props = {
  tokens: Token[];
  highlight?: string;
  content: string;
  showHiragana?: boolean;
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
  posSubJa: string;
  posSubEn: string;
  conjFormJa: string;
  conjFormEn: string;
  auxMeanings: Array<{ ja: string; en: string }>;
}

const STEM_POS = new Set(['動詞', '形容詞']);
const CONJ_POS = new Set(['動詞', '形容詞', '助動詞']);
const HIRAGANA_RE = /^[\u3040-\u309F]+$/;
const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

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

const POS_SUB_LABELS: Record<string, string> = {
  '普通名詞': 'Common Noun',
  '固有名詞': 'Proper Noun',
  '数詞': 'Numeral',
  '代名詞': 'Pronoun',
  '非自立可能': 'Auxiliary-capable',
  '格助詞': 'Case Particle',
  '係助詞': 'Binding Particle',
  '副助詞': 'Adverbial Particle',
  '接続助詞': 'Conjunctive Particle',
  '終助詞': 'Sentence-final Particle',
  '準体助詞': 'Nominalizing Particle',
};

const CONJ_FORM_LABELS: Record<string, string> = {
  '連用形': 'Continuative',
  '終止形': 'Plain Form',
  '連体形': 'Attributive',
  '未然形': 'Irrealis',
  '仮定形': 'Conditional',
  '命令形': 'Imperative',
  '意志推量形': 'Volitional',
  '語幹': 'Stem',
  '音便形': 'Euphonic',
};

const AUX_LABELS: Record<string, { ja: string; en: string }> = {
  'れる': { ja: '受身/可能', en: 'Passive/Potential' },
  'られる': { ja: '受身/可能', en: 'Passive/Potential' },
  'せる': { ja: '使役', en: 'Causative' },
  'させる': { ja: '使役', en: 'Causative' },
  'ない': { ja: '否定', en: 'Negative' },
  'ぬ': { ja: '否定', en: 'Negative' },
  'た': { ja: '過去', en: 'Past' },
  'て': { ja: 'て形', en: 'Te-form' },
  'ます': { ja: '丁寧', en: 'Polite' },
  'たい': { ja: '希望', en: 'Desiderative' },
  'だ': { ja: '断定', en: 'Copula' },
  'です': { ja: '丁寧', en: 'Polite Copula' },
  'ば': { ja: '条件', en: 'Conditional' },
  'ながら': { ja: '同時進行', en: 'While' },
  'ので': { ja: '理由', en: 'Because' },
  'そうだ': { ja: '様態/伝聞', en: 'Hearsay/Seems' },
  'ようだ': { ja: '様態', en: 'Appears (like)' },
  'らしい': { ja: '推定', en: 'Apparently' },
  'べし': { ja: '当然/義務', en: 'Should/Must' },
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

  // Collect aux/particle meanings per group (deduplicated by en label)
  const groupAuxMeanings = new Map<number, Array<{ ja: string; en: string }>>();
  for (const [idx, gid] of groupByIndex) {
    const token = tokens[idx]!;
    if (token.p === '助動詞' || token.p === '助詞') {
      const label = AUX_LABELS[(token as Token & { d?: string }).d ?? ''];
      if (label) {
        const arr = groupAuxMeanings.get(gid) ?? [];
        if (!arr.some(a => a.en === label.en)) {
          arr.push(label);
          groupAuxMeanings.set(gid, arr);
        }
      }
    }
  }

  // Full compound reading (concatenate all token readings in group)
  const groupReadingsKata = new Map<number, string>();
  for (const [idx, gid] of groupByIndex) {
    groupReadingsKata.set(gid, (groupReadingsKata.get(gid) ?? '') + tokens[idx]!.r);
  }

  return tokens.map((token, idx) => {
    const range = matchRanges.find((r) => token.b < r.end && token.e > r.start);
    const gid = groupByIndex.get(idx);
    const isMultiTokenGroup = gid !== undefined && (groupSizes.get(gid) ?? 0) > 1;
    const stemIdx = gid !== undefined ? groupStemIndex.get(gid) : undefined;
    const stemToken = stemIdx !== undefined ? tokens[stemIdx] : undefined;

    const dictForm = isMultiTokenGroup && stemToken ? stemToken.d : token.d;
    const reading = isMultiTokenGroup
      ? katakanaToHiragana(groupReadingsKata.get(gid!) ?? stemToken?.r ?? token.r)
      : katakanaToHiragana(token.r);
    const posForLabel = isMultiTokenGroup && stemToken ? stemToken.p : token.p;

    const tokenForSub = isMultiTokenGroup && stemToken ? stemToken : token;
    const p2 = (tokenForSub as Token & { p2?: string }).p2;
    const posSubJa = p2 ?? '';
    const posSubEn = posSubJa ? (POS_SUB_LABELS[posSubJa] ?? '') : '';

    const cf = (token as Token & { cf?: string }).cf;
    const cfBase = cf?.split('-')[0] ?? '';
    const conjFormJa = !isMultiTokenGroup && CONJ_POS.has(token.p) && cfBase ? cfBase : '';
    const conjFormEn = conjFormJa ? (CONJ_FORM_LABELS[conjFormJa] ?? '') : '';

    const auxMeanings = isMultiTokenGroup ? (groupAuxMeanings.get(gid!) ?? []) : [];

    return {
      ...token,
      matchType: range?.type ?? ('none' as const),
      searchText: isMultiTokenGroup ? groupSurfaces.get(gid!)! : token.d,
      groupId: isMultiTokenGroup ? gid! : null,
      dictForm,
      reading,
      posJa: posForLabel,
      posEn: POS_LABELS[posForLabel] ?? posForLabel,
      posSubJa,
      posSubEn,
      conjFormJa,
      conjFormEn,
      auxMeanings,
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
    ><ruby v-if="showHiragana && token.reading && KANJI_RE.test(token.s)">{{ token.s }}<rt>{{ token.reading }}</rt></ruby><template v-else>{{ token.s }}</template></span>

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
          <template v-if="hoveredToken.posSubEn">
            <span class="token-tooltip__pos-sub">
              {{ hoveredToken.posSubJa }} · {{ hoveredToken.posSubEn }}
            </span>
          </template>
          <template v-if="hoveredToken.auxMeanings.length > 0">
            <div class="token-tooltip__meta-divider" />
            <span v-for="aux in hoveredToken.auxMeanings" :key="aux.en" class="token-tooltip__conj">
              {{ aux.ja }} · {{ aux.en }}
            </span>
          </template>
          <template v-else-if="hoveredToken.conjFormEn">
            <div class="token-tooltip__meta-divider" />
            <span class="token-tooltip__conj">
              {{ hoveredToken.conjFormJa }} · {{ hoveredToken.conjFormEn }}
            </span>
          </template>
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

.token-tooltip__pos-sub {
  font-size: 10px;
  color: rgb(115 115 115);
  margin-top: 1px;
}

.token-tooltip__meta-divider {
  align-self: stretch;
  height: 1px;
  background: rgb(64 64 64);
}

.token-tooltip__conj {
  font-size: 10px;
  color: rgb(147 155 170);
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
</style>
