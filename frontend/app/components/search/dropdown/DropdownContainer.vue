<template>
    <div class="nd-dropdown relative inline-flex">
        <slot></slot>
        <div
            :class="dropdownContainerClass"
            :aria-labelledby="dropdownId"
        >
            <slot name="content"></slot>
        </div>
    </div>
</template>

<script setup>
defineProps({
  dropdownId: {
    type: String,
    required: true,
  },
  dropdownContainerClass: {
    type: String,
    default:
      'nd-dropdown-menu absolute top-full z-50 items-center text-center align-middle min-w-60 bg-white shadow-md p-2 mt-1 dark:bg-neutral-800 border-none rounded-lg',
  },
});
</script>

<style>
.nd-dropdown-menu {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 150ms ease, transform 150ms ease;
    transform: translateY(-4px);
}

.nd-dropdown-open > .nd-dropdown-menu {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0);
}
</style>
