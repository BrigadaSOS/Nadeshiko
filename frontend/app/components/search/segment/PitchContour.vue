<script setup lang="ts">
import type { PitchContour } from '~/utils/pitchContour';

const props = defineProps<{ contour: PitchContour }>();

const width = 360;
const height = 132;
const padding = { top: 10, right: 8, bottom: 22, left: 28 };

const voicedPoints = computed(() => props.contour.points);
const minFrequency = computed(() => {
  const values = voicedPoints.value.map((point) => point.frequencyHz);
  return Math.floor(Math.min(...values) / 10) * 10;
});
const maxFrequency = computed(() => {
  const values = voicedPoints.value.map((point) => point.frequencyHz);
  return Math.ceil(Math.max(...values) / 10) * 10;
});

const pointFor = (point: { timeSeconds: number; frequencyHz: number }) => {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const range = Math.max(20, maxFrequency.value - minFrequency.value);
  return {
    x: padding.left + (point.timeSeconds / Math.max(0.001, props.contour.durationSeconds)) * plotWidth,
    y: padding.top + (1 - (point.frequencyHz - minFrequency.value) / range) * plotHeight,
  };
};

const path = computed(() => {
  let result = '';
  let previousTime = -Infinity;
  for (const point of voicedPoints.value) {
    const coordinates = pointFor(point);
    // Don't imply a pitch through a long unvoiced pause.
    const command = point.timeSeconds - previousTime > 0.18 || result === '' ? 'M' : 'L';
    result += `${command}${coordinates.x.toFixed(2)},${coordinates.y.toFixed(2)} `;
    previousTime = point.timeSeconds;
  }
  return result.trim();
});
</script>

<template>
  <div
    data-testid="sentence-pitch-contour"
    role="img"
    :aria-label="$t('segment.pitchContourLabel')"
    class="mt-2 rounded-md border border-hairline bg-black/10 px-2 pt-2 pb-1"
  >
    <div class="flex items-center justify-between text-xs text-white/60">
      <span>{{ $t('segment.pitchContourTitle') }}</span>
      <span>{{ $t('segment.pitchContourHz', { min: minFrequency, max: maxFrequency }) }}</span>
    </div>
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      class="mt-1 h-28 w-full overflow-visible"
      aria-hidden="true"
      focusable="false"
    >
      <line :x1="padding.left" :x2="width - padding.right" :y1="padding.top" :y2="padding.top" stroke="currentColor" class="text-white/10" />
      <line :x1="padding.left" :x2="width - padding.right" :y1="height - padding.bottom" :y2="height - padding.bottom" stroke="currentColor" class="text-white/10" />
      <path :d="path" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-sky-300" />
      <text :x="padding.left - 4" :y="padding.top + 4" text-anchor="end" class="fill-current text-[9px] text-white/50">{{ maxFrequency }}</text>
      <text :x="padding.left - 4" :y="height - padding.bottom + 3" text-anchor="end" class="fill-current text-[9px] text-white/50">{{ minFrequency }}</text>
    </svg>
    <p class="m-0 text-[11px] text-white/45">{{ $t('segment.pitchContourDisclaimer') }}</p>
  </div>
</template>
