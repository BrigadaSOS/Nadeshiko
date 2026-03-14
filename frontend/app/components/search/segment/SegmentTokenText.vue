<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import { enrichTokens, hiraganaToKatakana, hiraganaToRomaji, type SlimToken, type EnrichedToken } from '~/utils/tokenEnrichment';

type Props = {
  tokens: Token[];
  highlight?: string;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  'token-click': [dictionaryForm: string];
}>();

const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

const enrichedTokens = computed<EnrichedToken[]>(() => {
  return enrichTokens(props.tokens as SlimToken[], props.highlight);
});

const hoveredToken = ref<EnrichedToken | null>(null);
const tooltipStyle = ref<Record<string, string>>({});
const tooltipRef = ref<HTMLElement | null>(null);

const GAP = 8; // px between token top and tooltip bottom
const VIEWPORT_MARGIN = 8; // px from viewport edges

const onTokenEnter = async (token: EnrichedToken, event: MouseEvent) => {
  hoveredToken.value = token;
  const el = event.currentTarget as HTMLElement;
  const tokenRect = el.getBoundingClientRect();

  // Work entirely in viewport coordinates (tooltip is position:fixed)
  const idealLeft = tokenRect.left + tokenRect.width / 2;
  const top = tokenRect.top - GAP;

  tooltipStyle.value = { left: `${idealLeft}px`, top: `${top}px` };

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

  tooltipStyle.value = { left: `${left}px`, top: `${top}px` };
};

const onTokenLeave = () => {
  hoveredToken.value = null;
};

const POS_CLASS: Record<string, string> = {
  '動詞': 'token--verb',
  '名詞': 'token--noun',
  '形容詞': 'token--adjective',
  '副詞': 'token--adverb',
  '助詞': 'token--particle',
  '助動詞': 'token--auxiliary',
};

const { tooltipReadingMode } = useTooltipReadingVisibility();
const { showHiragana } = useHiraganaVisibility();

const tooltipReading = computed(() => {
  if (!hoveredToken.value?.dictReading) return '';
  const reading = hoveredToken.value.dictReading;
  switch (tooltipReadingMode.value) {
    case 'katakana': return hiraganaToKatakana(reading);
    case 'romaji': return hiraganaToRomaji(reading);
    case 'hidden': return '';
    default: return reading;
  }
});
</script>

<template>
  <span class="token-text">
    <template v-for="token in enrichedTokens" :key="token.b">
      <span
        v-if="token.groupId === null || token.isGroupStem"
        class="token"
        :class="[
          POS_CLASS[token.p] ?? '',
          {
            'token--match': token.matchType === 'match',
            'token--compound': token.matchType === 'compound',
          },
        ]"
        @click="emit('token-click', token.searchText)"
        @mouseenter="onTokenEnter(token, $event)"
        @mouseleave="onTokenLeave"
      ><ruby v-if="showHiragana && KANJI_RE.test(token.displaySurface)">{{ token.displaySurface }}<rt>{{ token.reading }}</rt></ruby><template v-else>{{ token.displaySurface }}</template></span>
    </template>

    <Transition name="tooltip">
      <div
        v-if="hoveredToken"
        ref="tooltipRef"
        class="token-tooltip"
        :style="tooltipStyle"
      >
        <div class="token-tooltip__left">
          <span v-if="tooltipReading" class="token-tooltip__reading">{{ tooltipReading }}</span>
          <span class="token-tooltip__word">{{ hoveredToken.dictForm }}</span>
        </div>
        <div class="token-tooltip__divider" />
        <div class="token-tooltip__right">
          <span class="token-tooltip__pos">{{ hoveredToken.posEn }}</span>
          <span v-if="hoveredToken.posSubEn" class="token-tooltip__pos-sub">{{ hoveredToken.posSubEn }}</span>
          <span v-if="hoveredToken.conjClassEn" class="token-tooltip__pos-sub">{{ hoveredToken.conjClassEn }}</span>
          <template v-if="hoveredToken.auxMeanings.length > 0">
            <div class="token-tooltip__meta-divider" />
            <span class="token-tooltip__conj">
              {{ hoveredToken.auxMeanings.map(a => a.en).join(' › ') }}
            </span>
          </template>
          <template v-else-if="hoveredToken.conjFormEn">
            <div class="token-tooltip__meta-divider" />
            <span class="token-tooltip__conj">{{ hoveredToken.conjFormEn }}</span>
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
  position: fixed;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: stretch;
  gap: 0;
  background: rgb(30 30 30);
  border: 1px solid rgb(60 60 60);
  border-radius: 12px;
  padding: 0;
  pointer-events: none;
  z-index: 50;
  white-space: nowrap;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  min-width: 160px;
}

.token-tooltip__left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 18px;
  gap: 3px;
  min-width: 80px;
}

.token-tooltip__reading {
  font-size: 11px;
  color: rgb(150 150 150);
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
  background: rgb(60 60 60);
  align-self: stretch;
}

.token-tooltip__right {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 12px 16px;
  gap: 3px;
}

.token-tooltip__pos {
  font-size: 16px;
  color: rgb(220 220 220);
  font-weight: 500;
}

.token-tooltip__pos-sub {
  font-size: 13px;
  color: rgb(120 120 120);
}

.token-tooltip__meta-divider {
  align-self: stretch;
  height: 1px;
  background: rgb(60 60 60);
  margin: 4px 0;
}

.token-tooltip__conj {
  font-size: 13px;
  color: rgb(140 150 165);
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
