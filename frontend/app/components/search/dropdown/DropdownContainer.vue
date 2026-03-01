<template>
    <div class="nd-dropdown relative inline-flex">
        <slot></slot>
        <div
            :class="dropdownContainerClass"
            :aria-labelledby="resolvedDropdownId"
        >
            <slot name="content"></slot>
        </div>
    </div>
</template>

<script setup>
import { computed, provide, useId } from 'vue';

const props = defineProps({
  dropdownId: {
    type: String,
    default: 'nd-dropdown',
  },
  dropdownContainerClass: {
    type: String,
    default:
      'nd-dropdown-menu absolute top-full z-50 items-center text-center align-middle min-w-60 bg-white shadow-md p-2 mt-1 dark:bg-neutral-800 border-none rounded-lg',
  },
});

const dropdownUid = useId();
const resolvedDropdownId = computed(
  () => `${(props.dropdownId || 'nd-dropdown').trim() || 'nd-dropdown'}-${dropdownUid}`,
);
provide('ndDropdownResolvedId', resolvedDropdownId);
</script>
