<template>
    <div class="hs-dropdown relative z-50 inline-flex">
        <slot></slot>
        <div
            class="hs-dropdown-menu transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-60 bg-white shadow-md  p-2 mt-2 dark:bg-neutral-800 dark:border dark:border-neutral-700"
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
    }
});
</script>

<style>
.hs-dropdown-open .hs-dropdown-menu {
    opacity: 1 !important;
    display: block !important;
}
</style>
