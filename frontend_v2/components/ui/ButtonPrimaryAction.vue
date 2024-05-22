<template>
    <button
        type="button"
        class=" py-2 px-4 inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg border border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-white/10 dark:hover:bg-white/30 dark:text-neutral-400 dark:hover:text-neutral-300"
    >
    <slot></slot>
    </button>
</template>



<style>
.hs-dropdown-toggle svg {
    transition: transform 0.3s;
}

.hs-dropdown-open .hs-dropdown-toggle svg {
    transform: rotate(180deg);
}
</style>
