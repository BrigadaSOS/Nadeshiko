<template>
    <button
        :id="resolvedDropdownId"
        type="button"
        :class="dropdownButtonClass"
    >
        <slot></slot>
        <svg class="nd-dropdown-open:rotate-180 size-4" xmlns="http://www.w3.org/2000/svg"
            width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6" />
        </svg>
    </button>
</template>

<script setup>
import { computed, inject, useId } from 'vue';

const props = defineProps({
  dropdownId: {
    type: String,
    default: 'nd-dropdown',
  },
  dropdownButtonClass: {
    type: String,
    default:
      'nd-dropdown-toggle py-2.5 px-3 text-center flex justify-center items-center gap-x-2 font-semibold rounded-lg border border-transparent  hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-button-primary-main dark:hover:bg-button-primary-hover dark:text-neutral-400 dark:hover:text-neutral-300',
  },
});

const dropdownUid = useId();
const providedDropdownId = inject('ndDropdownResolvedId', null);
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

<style>
.nd-dropdown-toggle svg {
    transition: transform 0.3s;
}

.nd-dropdown-open .nd-dropdown-toggle svg {
    transform: rotate(180deg);
}
</style>
