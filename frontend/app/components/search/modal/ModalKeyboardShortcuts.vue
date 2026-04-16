<script setup lang="ts">
const showModal = ref(false);

const open = () => {
  showModal.value = true;
};

const close = () => {
  showModal.value = false;
};

const handleBackdropClick = (event: MouseEvent) => {
  if (event.target === event.currentTarget) {
    close();
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }

  if (event.key === '?' || (event.shiftKey && event.code === 'Slash')) {
    event.preventDefault();
    showModal.value = !showModal.value;
    return;
  }

  if (event.code === 'Escape' && showModal.value) {
    event.stopImmediatePropagation();
    close();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true);
});

defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showModal"
      data-nd-modal-open
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      @click="handleBackdropClick"
    >
      <div class="bg-[#1b1b1b] border border-[#2f2f2f] rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center py-3 px-5 border-b border-[#2f2f2f]">
          <h3 class="font-bold text-white text-lg">{{ $t('shortcuts.title') }}</h3>
          <button
            type="button"
            class="inline-flex justify-center items-center h-8 w-8 rounded-md text-gray-400 hover:text-white transition-colors"
            @click="close"
          >
            <svg class="w-3.5 h-3.5" width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0.772004 0.772004C0.907186 0.636856 1.08918 0.560669 1.279 0.560669C1.46882 0.560669 1.65081 0.636856 1.786 0.772004L6.228 5.21401C6.36315 5.34919 6.43933 5.53119 6.43933 5.72101C6.43933 5.91082 6.36315 6.09282 6.228 6.22801C6.09282 6.36315 5.91082 6.43933 5.721 6.43933C5.53119 6.43933 5.34919 6.36315 5.214 6.22801L0.772004 1.786C0.636856 1.65081 0.560669 1.46882 0.560669 1.279C0.560669 1.08918 0.636856 0.907186 0.772004 0.772004Z" fill="currentColor" />
              <path d="M6.228 0.772004C6.36315 0.907186 6.43933 1.08918 6.43933 1.279C6.43933 1.46882 6.36315 1.65081 6.228 1.786L1.786 6.22801C1.65081 6.36315 1.46882 6.43933 1.279 6.43933C1.08918 6.43933 0.907186 6.36315 0.772004 6.22801C0.636856 6.09282 0.560669 5.91082 0.560669 5.72101C0.560669 5.53119 0.636856 5.34919 0.772004 5.21401L5.214 0.772004C5.34919 0.636856 5.53119 0.560669 5.721 0.560669C5.91082 0.560669 6.09282 0.636856 6.228 0.772004Z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div class="p-5 space-y-5">
          <!-- Navigation -->
          <div>
            <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">{{ $t('shortcuts.navigation') }}</h4>
            <div class="space-y-2">
              <ShortcutRow :keys="['↑', '↓']" :description="$t('shortcuts.navigateCards')" />
              <ShortcutRow :keys="['←', '→']" :description="$t('shortcuts.prevNextSegment')" />
              <ShortcutRow :keys="['Shift', 'S']" :description="$t('shortcuts.backToSearch')" />
            </div>
          </div>

          <!-- Playback -->
          <div>
            <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">{{ $t('shortcuts.playback') }}</h4>
            <div class="space-y-2">
              <ShortcutRow :keys="['Enter']" :description="$t('shortcuts.playSelected')" />
              <ShortcutRow :keys="['Space']" :description="$t('shortcuts.playPause')" />
              <ShortcutRow :keys="['R']" :description="$t('shortcuts.restart')" />
              <ShortcutRow :keys="['L']" :description="$t('shortcuts.toggleAutoplay')" />
              <ShortcutRow :keys="['F']" :description="$t('shortcuts.toggleImmersive')" />
            </div>
          </div>

          <!-- Actions -->
          <div>
            <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">{{ $t('shortcuts.actions') }}</h4>
            <div class="space-y-2">
              <ShortcutRow :keys="['A']" :description="$t('shortcuts.openAnki')" />
              <ShortcutRow :keys="['C']" :description="$t('shortcuts.openContext')" />
            </div>
          </div>
        </div>

        <div class="px-5 pb-4">
          <p class="text-xs text-gray-500">{{ $t('shortcuts.hint') }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
