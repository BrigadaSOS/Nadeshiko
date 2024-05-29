<template>
    <button class="flex items-center w-full gap-x-3.5 py-2 px-3 rounded-lg text-sm text-gray-800 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-300 dark:focus:bg-neutral-700">
        <UiBaseIcon :path="iconPath" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
        {{ text }}
    </button>
</template>

<script setup>
defineProps({
    href: {
        type: String,
        default: '#'
    },
    text: {
        type: String,
        default: 'Item'
    },
    iconPath: {
        type: String,
        default: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0'
    }
});
</script>
