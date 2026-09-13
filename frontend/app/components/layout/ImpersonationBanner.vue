<script setup lang="ts">
const store = userStore();
const { isImpersonating, impersonatedUsername } = storeToRefs(store);

async function exitImpersonation() {
  await store.stopImpersonating();
}
</script>

<template>
  <ClientOnly>
    <div
      v-if="isImpersonating"
      class="sticky top-0 z-50 flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-black"
    >
      <i18n-t keypath="impersonation.active" tag="span" scope="global">
        <template #name><strong>{{ impersonatedUsername }}</strong></template>
      </i18n-t>
      <button
        class="rounded bg-black/15 px-3 py-1 text-xs font-semibold hover:bg-black/25 transition-colors"
        @click="exitImpersonation"
      >
        {{ $t('impersonation.exit') }}
      </button>
    </div>
  </ClientOnly>
</template>
