<template>
  <div class="relative group/tooltip">
    <button class="nd-menu-item" :class="buttonClass" :disabled="isDisabled && !onDisabledClick" @click="handleClick">
      <UiBaseIcon v-if="iconPath" :path="iconPath" w="w-5 md:w-5" h="h-5 md:h-5" size="20" />
      {{ text }}
    </button>
    <div
      v-if="tooltip && isDisabled"
      class="hidden md:group-hover/tooltip:block absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-1.5 text-xs text-ink bg-surface-soft rounded-md shadow-lg whitespace-nowrap pointer-events-none border border-hairline"
    >
      {{ tooltip }}
      <div class="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-surface-soft"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ click: [] }>();

const props = withDefaults(
  defineProps<{
    href?: string;
    text?: string;
    iconPath?: string | null;
    isDisabled?: boolean;
    tooltip?: string | null;
    selected?: boolean;
    danger?: boolean;
    /** Lets a configuration-required item look disabled while still taking the
     *  reader to the place where they can complete its setup. */
    onDisabledClick?: () => void;
  }>(),
  {
    href: '#',
    text: 'Item',
    iconPath: null,
    isDisabled: false,
    tooltip: null,
    selected: false,
    danger: false,
    onDisabledClick: undefined,
  },
);

const handleClick = () => {
  if (props.isDisabled) {
    props.onDisabledClick?.();
  } else {
    emit('click');
  }
};

const buttonClass = computed(() => ({
  'is-disabled': props.isDisabled,
  'is-selected': props.selected && !props.isDisabled,
  'is-danger': props.danger && !props.isDisabled,
}));
</script>
