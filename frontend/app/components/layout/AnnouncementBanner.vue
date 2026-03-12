<script setup>
const dismissed = useLocalStorage('banner-v2-migration-dismissed', false);
</script>

<template>
  <div v-if="!dismissed" class="w-full bg-[#1a1a2e] border-b border-white/10 px-4 py-2.5 text-sm text-white">
    <div class="max-w-[92%] mx-auto flex items-center justify-between gap-4">
      <p class="text-center flex-1">
        Welcome to the new version of Nadeshiko!
        <NuxtLink to="/blog/a-new-home-for-nadeshiko" class="underline font-semibold hover:text-white/80 ml-1">Read the blog post</NuxtLink>
        <span class="mx-1">·</span>
        <a href="https://old.nadeshiko.co" target="_blank" class="underline font-semibold hover:text-white/80">Manage older API Keys</a>
      </p>
      <button @click="dismissed = true" class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" aria-label="Dismiss banner">
        <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>
  </div>
</template>
