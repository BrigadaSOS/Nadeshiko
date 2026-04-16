<script setup lang="ts">
type AnnouncementData = {
  message: string;
  type: 'INFO' | 'WARNING' | 'MAINTENANCE';
  active: boolean;
};

const sdk = useNadeshikoSdk();

const { data: announcement } = await useAsyncData(
  'system-announcement',
  async () => {
    try {
      const { data, response } = await sdk.getAnnouncement();
      if (response.status === 204 || !data || typeof data !== 'object' || !('active' in data)) {
        return null;
      }
      return { message: data.message, type: data.type, active: data.active } as AnnouncementData;
    } catch {
      return null;
    }
  },
  {
    default: () => null,
  },
);

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
    <p class="text-sm text-white/80 leading-relaxed">{{ announcement.message }}</p>
  </div>
</template>
