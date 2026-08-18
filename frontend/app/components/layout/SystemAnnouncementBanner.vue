<script setup lang="ts">
// Through `/api/announcement` rather than the SDK directly, so the one answer
// every visitor shares can be cached once instead of re-fetched per render. The
// route swallows the failure case too -- "no announcement" is served as an error
// by the backend endpoint, so a null here covers both, and the banner is purely
// additive chrome either way.
const { data } = await useFetch('/api/announcement', {
  key: 'system-announcement',
  default: () => ({ announcement: null }),
});

const announcement = computed(() => data.value?.announcement ?? null);

const typeLabel = computed(() => {
  switch (announcement.value?.type) {
    case 'WARNING':
      return 'Important Notice';
    case 'MAINTENANCE':
      return 'Maintenance Notice';
    default:
      return 'Notice';
  }
});
</script>

<template>
  <div v-if="announcement?.active" class="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 my-2">
    <div class="flex items-center gap-2 mb-1.5">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 text-red-400 shrink-0">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
      <span class="font-semibold text-white text-sm">{{ typeLabel }}</span>
    </div>
    <p class="text-sm text-white/80 leading-relaxed">
      <CommonAnnouncementText :message="announcement.message" />
    </p>
  </div>
</template>
