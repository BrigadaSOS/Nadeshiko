<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

// useDebounceFn is auto-imported from @vueuse/core via @vueuse/nuxt

const props = defineProps({
  minPosition: {
    type: Number,
    default: 0
  },
  maxPosition: {
    type: Number,
    default: 0
  },
  selectedMediaId: {
    type: [Number, String],
    default: null
  }
});

// Local state for slider values
const minValue = ref(props.minPosition);
const maxValue = ref(props.maxPosition);

// URL parameter values
const urlMinValue = computed(() => {
  if (!route.query.pos_min) return null;
  const val = Number(route.query.pos_min);
  return isNaN(val) ? null : val;
});

const urlMaxValue = computed(() => {
  if (!route.query.pos_max) return null;
  const val = Number(route.query.pos_max);
  return isNaN(val) ? null : val;
});

// Initialize local values from URL or props
onMounted(() => {
  if (urlMinValue.value !== null) {
    minValue.value = urlMinValue.value;
  } else {
    minValue.value = props.minPosition;
  }
  if (urlMaxValue.value !== null) {
    maxValue.value = urlMaxValue.value;
  } else {
    maxValue.value = props.maxPosition;
  }

  // Add global mouseup listener to reset dragging state
  const handleMouseUp = () => {
    isDraggingMin.value = false;
    isDraggingMax.value = false;
  };
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('touchend', handleMouseUp);

  // Cleanup on unmount
  onUnmounted(() => {
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('touchend', handleMouseUp);
  });
});

// Watch for props changes (when media changes)
watch(() => [props.minPosition, props.maxPosition], ([newMin, newMax]) => {
  if (urlMinValue.value === null && urlMaxValue.value === null) {
    minValue.value = newMin;
    maxValue.value = newMax;
  }
});

// Simple debounce implementation
let debounceTimer = null;
const updateUrlParams = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    const query = { ...route.query };

    // Only add params if the range is different from the full range
    if (minValue.value === props.minPosition && maxValue.value === props.maxPosition) {
      delete query.pos_min;
      delete query.pos_max;
    } else {
      query.pos_min = minValue.value.toString();
      query.pos_max = maxValue.value.toString();
    }

    router.push({ query });
    debounceTimer = null;
  }, 300);
};

// Track which slider is currently being dragged
const isDraggingMin = ref(false);
const isDraggingMax = ref(false);

// Handle slider input
const onMinInput = (event) => {
  const val = Number(event.target.value);
  if (val <= maxValue.value) {
    minValue.value = val;
    updateUrlParams();
  }
};

const onMaxInput = (event) => {
  const val = Number(event.target.value);
  if (val >= minValue.value) {
    maxValue.value = val;
    updateUrlParams();
  }
};

// Handle track click - move the closest slider
const onTrackClick = (event) => {
  // Don't handle clicks if we're dragging or if the click is on an input
  if (isDraggingMin.value || isDraggingMax.value) return;
  if (event.target.tagName === 'INPUT') return;

  event.preventDefault();
  event.stopPropagation();

  const rect = event.currentTarget.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percentage = clickX / rect.width;
  const clickValue = props.minPosition + (percentage * (props.maxPosition - props.minPosition));

  // Calculate distances to both thumbs
  const distanceToMin = Math.abs(clickValue - minValue.value);
  const distanceToMax = Math.abs(clickValue - maxValue.value);

  // Move the closest slider
  if (distanceToMin < distanceToMax) {
    if (clickValue <= maxValue.value) {
      minValue.value = Math.round(clickValue);
      updateUrlParams();
    }
  } else {
    if (clickValue >= minValue.value) {
      maxValue.value = Math.round(clickValue);
      updateUrlParams();
    }
  }
};

const clearFilters = () => {
  const query = { ...route.query };
  delete query.pos_min;
  delete query.pos_max;
  router.push({ query });
};

// Check if filter is active
const hasActiveFilter = computed(() => {
  return urlMinValue.value !== null || urlMaxValue.value !== null;
});

// Format position for display (position is in seconds, convert to hh:mm:ss)
const formatPosition = (pos) => {
  const totalSeconds = Math.floor(pos);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Format as hh:mm:ss
  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
};
</script>

<template>
  <div class="relative mx-auto mt-4 overflow-visible">
    <ul
      class="z-20 divide-y divide-white/5 dark:border-white/5 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 rounded-lg dark:bg-button-primary-main border dark:text-white overflow-visible">
      <!-- Header -->
      <div class="flex items-center w-full px-4 py-2 text-center rounded-t-lg rounded-l-lg">
        <span class="font-medium text-sm flex-1 text-center">
          {{ $t('timeRangeFilter.title') }}
        </span>
        <button
          v-if="hasActiveFilter"
          @click="clearFilters"
          class="text-xs text-gray-400 hover:text-gray-200 dark:hover:text-white absolute right-4">
          {{ $t('timeRangeFilter.clear') }}
        </button>
      </div>

      <!-- Slider Container (only show if data is loaded) -->
      <div v-if="maxPosition > 0 || minPosition > 0" class="px-4 py-4 overflow-visible">
        <!-- Double Slider -->
        <div class="relative h-12 flex items-center pt-6" @click="onTrackClick">
          <!-- Track -->
          <div class="absolute w-full h-1 bg-gray-600 rounded-full cursor-pointer"></div>
          <!-- Active Track -->
          <div
            class="absolute h-1 bg-blue-500 rounded-full cursor-pointer"
            :style="{
              left: `${((minValue - minPosition) / (maxPosition - minPosition)) * 100}%`,
              width: `${((maxValue - minValue) / (maxPosition - minPosition)) * 100}%`
            }">
          </div>

          <!-- Min Slider -->
          <input
            type="range"
            :min="minPosition"
            :max="maxPosition"
            :value="minValue"
            @input="onMinInput"
            @mousedown="isDraggingMin = true"
            @mouseup="isDraggingMin = false"
            @touchstart="isDraggingMin = true"
            @touchend="isDraggingMin = false"
            class="absolute w-full h-1 opacity-0 cursor-pointer z-10"
          >
          <!-- Min Thumb with Label -->
          <div
            class="absolute pointer-events-none z-20"
            :style="{
              left: `${((minValue - minPosition) / (maxPosition - minPosition)) * 100}%`,
              transform: 'translateX(-50%)'
            }"
          >
            <!-- Time Label Above -->
            <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-blue-400 dark:text-blue-300 font-medium whitespace-nowrap bg-gray-800 dark:bg-gray-900 px-2 py-1 rounded shadow-lg">
              {{ formatPosition(minValue) }}
            </div>
            <!-- Thumb Circle -->
            <div class="w-4 h-4 bg-white dark:bg-gray-300 border-2 border-blue-500 rounded-full shadow cursor-pointer hover:scale-110 transition-transform"></div>
          </div>

          <!-- Max Slider -->
          <input
            type="range"
            :min="minPosition"
            :max="maxPosition"
            :value="maxValue"
            @input="onMaxInput"
            @mousedown="isDraggingMax = true"
            @mouseup="isDraggingMax = false"
            @touchstart="isDraggingMax = true"
            @touchend="isDraggingMax = false"
            class="absolute w-full h-1 opacity-0 cursor-pointer z-10"
          >
          <!-- Max Thumb with Label -->
          <div
            class="absolute pointer-events-none z-20"
            :style="{
              left: `${((maxValue - minPosition) / (maxPosition - minPosition)) * 100}%`,
              transform: 'translateX(-50%)'
            }"
          >
            <!-- Time Label Above -->
            <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-blue-400 dark:text-blue-300 font-medium whitespace-nowrap bg-gray-800 dark:bg-gray-900 px-2 py-1 rounded shadow-lg">
              {{ formatPosition(maxValue) }}
            </div>
            <!-- Thumb Circle -->
            <div class="w-4 h-4 bg-white dark:bg-gray-300 border-2 border-blue-500 rounded-full shadow cursor-pointer hover:scale-110 transition-transform"></div>
          </div>
        </div>
      </div>
      <!-- Loading state -->
      <div v-else class="px-4 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
        Loading position range data...
      </div>
    </ul>
  </div>
</template>
