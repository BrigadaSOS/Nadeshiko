<template>
    <button
        data-testid="dropdown-toggle"
        :id="resolvedDropdownId"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="dropdown?.isOpen.value ?? false"
        :class="dropdownButtonClass"
        @click="dropdown?.toggle()"
    >
        <slot></slot>
        <svg class="size-4 transition-transform duration-300" :class="{ 'rotate-180': dropdown?.isOpen.value }"
            xmlns="http://www.w3.org/2000/svg"
            width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6" />
        </svg>
    </button>
</template>

<script setup lang="ts">
import { computed, inject, useId, type ComputedRef } from 'vue';
import { injectDropdown } from '~/composables/useDropdownState';

const props = withDefaults(
  defineProps<{
    dropdownId?: string;
    dropdownButtonClass?: string;
  }>(),
  {
    dropdownId: 'nd-dropdown',
    dropdownButtonClass:
      'py-2.5 px-3 text-center flex justify-center items-center gap-x-2 font-semibold rounded-lg border border-transparent  hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-button-primary-main dark:hover:bg-button-primary-hover dark:text-neutral-400 dark:hover:text-neutral-300',
  },
);

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
