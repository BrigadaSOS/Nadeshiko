<script setup>
import confetti from 'canvas-confetti';

const dismissed = useLocalStorage('banner-v2-migration-dismissed', false);

onMounted(() => {
  if (!dismissed.value) {
    const defaults = { origin: { x: 0.5, y: 0.3 }, disableForReducedMotion: true, ticks: 200, decay: 0.93 };
    confetti({ ...defaults, particleCount: 80, spread: 100, angle: 60 });
    confetti({ ...defaults, particleCount: 80, spread: 100, angle: 120 });
    confetti({ ...defaults, particleCount: 60, spread: 180, startVelocity: 35 });
  }
});
</script>

<template>
  <ClientOnly>
  <Transition
    appear
    enter-active-class="transition duration-500 ease-out"
    enter-from-class="opacity-0 -translate-y-4"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-300 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-4"
  >
  <div v-if="!dismissed" class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/50" @click="dismissed = true" />
    <div class="absolute top-[15%] left-1/2 -translate-x-1/2 w-fit max-w-[90%] bg-[var(--modal-background)] border border-[var(--modal-border)] rounded-xl px-6 py-5 text-sm text-white shadow-lg shadow-black/30">
    <button @click="dismissed = true" class="absolute top-2 right-2 p-1 rounded-full bg-[var(--modal-input)] border border-[var(--modal-border)] hover:bg-[#d94845] transition-colors" aria-label="Dismiss banner">
      <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>
    <div class="text-center">
      <p class="text-[#ef5552] font-semibold text-xl whitespace-nowrap">Welcome to the new version of Nadeshiko! 🎉</p>
      <p class="mt-1 text-white/60 max-w-0 min-w-full">Better, more stable, and with a lot of new features.</p>
      <div class="mt-4 flex flex-col gap-3">
        <NuxtLink to="/blog/a-new-home-for-nadeshiko" class="flex-[2] flex items-center justify-center rounded-lg bg-[#ef5552] px-4 py-3 font-semibold text-white hover:bg-[#d94845] transition-colors" @click="dismissed = true">Read the blog post</NuxtLink>
        <a href="https://old.nadeshiko.co" target="_blank" class="flex-1 flex items-center justify-center rounded-lg bg-[var(--button-color-primary)] px-4 py-3 font-semibold text-white hover:bg-[var(--button-color-hover-primary)] transition-colors">Go back to the older site</a>
      </div>
    </div>
    </div>
  </div>
  </Transition>
  </ClientOnly>
</template>
