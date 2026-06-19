<script setup lang="ts">
import type { Token } from '@brigadasos/nadeshiko-sdk';
import {
  enrichTokens,
  hiraganaToKatakana,
  hiraganaToRomaji,
  segmentFurigana,
  type SlimToken,
  type EnrichedToken,
} from '~/utils/tokenEnrichment';
import { useLabsStore } from '@/stores/labs';

type Props = {
  tokens: Token[];
  highlight?: string;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  'token-click': [dictionaryForm: string];
}>();

const enrichedTokens = computed<EnrichedToken[]>(() => {
  return enrichTokens(props.tokens as SlimToken[], props.highlight);
});

const hoveredToken = ref<EnrichedToken | null>(null);
const tooltipStyle = ref<Record<string, string>>({});
const tooltipRef = ref<HTMLElement | null>(null);

const GAP = 8; // px between token top and tooltip bottom
const VIEWPORT_MARGIN = 8; // px from viewport edges
const HIDE_DELAY = 120; // ms grace period for cursor to bridge token → tooltip

let hideTimer: ReturnType<typeof setTimeout> | null = null;
const cancelHide = () => {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

const onTokenEnter = async (token: EnrichedToken, event: MouseEvent) => {
  cancelHide();
  if (!showHoverDefinitions.value) return;
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

const scheduleHide = () => {
  cancelHide();
  hideTimer = setTimeout(() => {
    hoveredToken.value = null;
    hideTimer = null;
  }, HIDE_DELAY);
};

const onTokenLeave = scheduleHide;
const onTooltipEnter = cancelHide;
const onTooltipLeave = scheduleHide;

const POS_CLASS: Record<string, string> = {
  動詞: 'token--verb',
  名詞: 'token--noun',
  形容詞: 'token--adjective',
  副詞: 'token--adverb',
  助詞: 'token--particle',
  助動詞: 'token--auxiliary',
};

const labsStore = useLabsStore();
const showHoverDefinitions = computed(() => labsStore.isFeatureEnabled('showTokenHoverDefinitions'));

const { tooltipReadingMode } = useTooltipReadingVisibility();
const { furiganaMode } = useHiraganaVisibility();
const { presets, enabledDictionaries } = useDictionaryLinks();

const tooltipReading = computed(() => {
  if (!hoveredToken.value?.dictReading) return '';
  const reading = hoveredToken.value.dictReading;
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
});

const dictionaryLinks = computed(() => {
  const token = hoveredToken.value;
  if (!token) return [];
  return presets
    .filter((preset) => enabledDictionaries.value.includes(preset.id))
    .map((preset) => ({
      id: preset.id,
      label: preset.label,
      href: preset.buildUrl(token.dictForm, token.dictReading ?? ''),
    }));
});
</script>

<template>
  <span lang="ja" class="token-text">
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
      ><template v-if="furiganaMode !== 'hidden'"><template v-for="(seg, si) in segmentFurigana(token.displaySurface, token.reading)" :key="si"><ruby v-if="seg.reading" :class="{ 'furigana--spoiler': furiganaMode === 'spoiler' }">{{ seg.text }}<rt>{{ seg.reading }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template><template v-else>{{ token.displaySurface }}</template></span>
    </template>

    <Transition name="tooltip">
      <div
        v-if="hoveredToken && showHoverDefinitions"
        ref="tooltipRef"
        class="token-tooltip"
        :class="{ 'token-tooltip--with-links': dictionaryLinks.length > 0 }"
        :style="tooltipStyle"
        @mouseenter="onTooltipEnter"
        @mouseleave="onTooltipLeave"
      >
        <div class="token-tooltip__body">
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
        <div v-if="dictionaryLinks.length > 0" class="token-tooltip__links">
          <span class="token-tooltip__links-label">{{ $t('tokenTooltip.lookupIn') }}</span>
          <a
            v-for="link in dictionaryLinks"
            :key="link.id"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="token-tooltip__link"
            @click.stop
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

.token-tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
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

.token-tooltip--with-links {
  pointer-events: auto;
}

.token-tooltip__body {
  display: flex;
  align-items: stretch;
}

.token-tooltip__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid rgb(60 60 60);
  background: rgb(24 24 24);
}

.token-tooltip__links-label {
  font-size: 11px;
  color: rgb(140 140 140);
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
  transition: background-color 0.12s ease, color 0.12s ease;
}

.token-tooltip__link:hover {
  background: rgba(255, 255, 255, 0.14);
  color: white;
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

.furigana--spoiler rt {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.token:hover .furigana--spoiler rt {
  opacity: 1;
}
</style>
