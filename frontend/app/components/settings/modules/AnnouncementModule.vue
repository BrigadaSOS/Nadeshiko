<script setup lang="ts">
type AnnouncementData = {
  message: string;
  type: 'INFO' | 'WARNING' | 'MAINTENANCE';
  active: boolean;
};

const sdk = useNadeshikoSdk();
const saving = ref(false);

const form = reactive<AnnouncementData>({
  message: '',
  type: 'INFO',
  active: false,
});

const { data: existing } = await useAsyncData(
  'settings-admin-announcement',
  async () => {
    try {
      const data = await sdk.getAnnouncement();
      return data ? ({ message: data.message, type: data.type, active: data.active } as AnnouncementData) : null;
    } catch {
      return null;
    }
  },
  {
    default: () => null,
  },
);

if (existing.value) {
  form.message = existing.value.message;
  form.type = existing.value.type;
  form.active = existing.value.active;
}

const hasChanges = computed(() => {
  if (!existing.value) return form.message.length > 0;
  return (
    form.message !== existing.value.message ||
    form.type !== existing.value.type ||
    form.active !== existing.value.active
  );
});

const save = async () => {
  if (saving.value || !form.message.trim()) return;
  saving.value = true;

  try {
    const data = await sdk.updateAnnouncement({
      message: form.message.trim(),
      type: form.type,
      active: form.active,
    });
    existing.value = data as AnnouncementData;
    useToastSuccess('Announcement updated');
  } catch {
    useToastError('Failed to update announcement');
  } finally {
    saving.value = false;
  }
};

const clear = async () => {
  if (saving.value) return;
  saving.value = true;

  try {
    const data = await sdk.updateAnnouncement({
      message: form.message || 'No announcement',
      type: form.type,
      active: false,
    });
    existing.value = data as AnnouncementData;
    form.active = false;
    useToastSuccess('Announcement deactivated');
  } catch {
    useToastError('Failed to deactivate announcement');
  } finally {
    saving.value = false;
  }
};

const typeOptions = [
  { value: 'INFO', label: 'Info', color: 'bg-neutral-500' },
  { value: 'WARNING', label: 'Warning', color: 'bg-amber-500' },
  { value: 'MAINTENANCE', label: 'Maintenance', color: 'bg-blue-500' },
] as const;
</script>

<template>
  <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Announcement</h3>
    <p class="text-gray-400 text-sm mt-1">
      Set a site-wide announcement banner visible to all users.
    </p>
    <div class="border-b pt-4 border-white/10" />

    <div class="mt-4 space-y-4">
      <div>
        <label class="block text-sm text-gray-300 mb-1">Message</label>
        <textarea
          v-model="form.message"
          maxlength="500"
          rows="3"
          placeholder="Write an announcement message..."
          class="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-input-focus-ring resize-none"
        />
        <p class="text-xs text-gray-500 mt-1 text-right">{{ form.message?.length ?? 0 }}/500</p>
      </div>

      <div>
        <label class="block text-sm text-gray-300 mb-1">Type</label>
        <div class="flex gap-2">
          <button
            v-for="opt in typeOptions"
            :key="opt.value"
            :class="[
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              form.type === opt.value
                ? 'border-red-400 text-white bg-neutral-700'
                : 'border-neutral-700 text-gray-400 hover:text-white hover:border-neutral-600',
            ]"
            @click="form.type = opt.value"
          >
            <span :class="[opt.color, 'inline-block size-2 rounded-full mr-1.5']" />
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <span class="text-sm text-gray-300">Active</span>
          <p class="text-xs text-gray-500">When active, the banner is shown to all visitors.</p>
        </div>
        <button
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            form.active ? 'bg-red-400' : 'bg-gray-600',
          ]"
          @click="form.active = !form.active"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              form.active ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <div v-if="form.message?.trim()" class="mt-2">
        <label class="block text-sm text-gray-300 mb-1">Preview</label>
        <div class="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4">
          <div class="flex items-center gap-2 mb-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 text-red-400 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span class="font-semibold text-white text-sm">{{ form.type === 'WARNING' ? 'Important Notice' : form.type === 'MAINTENANCE' ? 'Maintenance Notice' : 'Notice' }}</span>
          </div>
          <p class="text-sm text-white/80 leading-relaxed">{{ form.message }}</p>
        </div>
      </div>
    </div>

    <div class="border-b pt-4 border-white/10" />

    <div class="mt-4 flex gap-3">
      <button
        :disabled="saving || !hasChanges || !form.message?.trim()"
        class="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        @click="save"
      >
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <button
        v-if="existing?.active"
        :disabled="saving"
        class="px-4 py-2 text-sm rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        @click="clear"
      >
        Deactivate
      </button>
    </div>
  </div>
</template>
