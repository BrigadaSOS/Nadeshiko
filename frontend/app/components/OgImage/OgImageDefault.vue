<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: 'Nadeshiko',
    description:
      'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.',
  },
);
</script>

<template>
  <div class="h-full w-full flex flex-col bg-[#141414] py-12 pr-14 pl-16 border-l-[48px] border-[#ef5552]" style="font-family: 'Space Grotesk', 'Noto Sans JP', sans-serif;">

    <!-- Top section: logo mark + site name -->
    <div class="flex flex-row items-center">
      <div class="flex items-center justify-center w-[52px] h-[52px] rounded-xl bg-[#ef5552] text-[28px] font-bold text-white">N</div>
      <p class="text-[22px] text-[#555555] ml-4 tracking-[0.12em]">nadeshiko.co</p>
    </div>

    <!-- Title -->
    <h1 class="text-[110px] font-bold text-white mt-auto leading-none tracking-tight">{{ title }}</h1>

    <!-- Description -->
    <p class="text-[26px] text-[#777777] mt-4 mb-auto leading-normal">{{ description }}</p>

  </div>
</template>
