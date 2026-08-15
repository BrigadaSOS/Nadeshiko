<template>
    <button
        :data-testid="testId"
        :id="resolvedDropdownId"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="dropdown?.isOpen.value ?? false"
        :class="resolvedButtonClass"
        @click="dropdown?.toggle()"
    >
        <slot></slot>
        <svg
            v-if="showChevron"
            class="size-4 transition-transform duration-300"
            :class="{ 'rotate-180': dropdown?.isOpen.value }"
            xmlns="http://www.w3.org/2000/svg"
            width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        >
            <path d="m6 9 6 6 6-6" />
        </svg>
    </button>
</template>

<script setup lang="ts">
import { computed, inject, useId, type ComputedRef } from 'vue';
import { injectDropdown } from '~/composables/useDropdownState';

const DEFAULT_BUTTON_CLASS =
  'py-2.5 px-3 text-center flex justify-center items-center gap-x-2 font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-button-primary-main dark:hover:bg-button-primary-hover dark:text-neutral-400 dark:hover:text-neutral-300';

const props = withDefaults(
  defineProps<{
    dropdownId?: string;
    dropdownButtonClass?: string;
    testId?: string;
    /** False for icon-only triggers (row ⋮ menus) that have no labelled chevron. */
    showChevron?: boolean;
    /** Omit `border-hairline`. Ignored when `dropdownButtonClass` is set. */
    borderless?: boolean;
    /** Reveal the toolbar outline when its containing segment is hovered. */
    segmentHoverBorder?: boolean;
  }>(),
  {
    dropdownId: 'nd-dropdown',
    dropdownButtonClass: undefined,
    testId: 'dropdown-toggle',
    showChevron: true,
    borderless: false,
    segmentHoverBorder: false,
  },
);

const resolvedButtonClass = computed(() => {
  if (props.dropdownButtonClass) return props.dropdownButtonClass;
  if (props.segmentHoverBorder) return `${DEFAULT_BUTTON_CLASS} border border-transparent group-hover:border-hairline`;
  return props.borderless ? DEFAULT_BUTTON_CLASS : `${DEFAULT_BUTTON_CLASS} border border-hairline`;
});

const dropdown = injectDropdown();

const dropdownUid = useId();
const providedDropdownId = inject<ComputedRef<string> | string | null>('ndDropdownResolvedId', null);
const resolvedDropdownId = computed(() => {
  if (providedDropdownId && typeof providedDropdownId === 'object' && 'value' in providedDropdownId) {
    return providedDropdownId.value;
  }
  if (typeof providedDropdownId === 'string' && providedDropdownId) {
    return providedDropdownId;
  }
  return `${(props.dropdownId || 'nd-dropdown').trim() || 'nd-dropdown'}-${dropdownUid}`;
});
</script>
