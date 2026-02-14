<script setup lang="ts">
import { useListsStore } from '@/stores/lists';
import type { ListType, ListVisibility } from '@/stores/lists';

const emit = defineEmits(['close', 'created']);
const { t } = useI18n();
const listsStore = useListsStore();

const name = ref('');
const type = ref<ListType>('CUSTOM');
const visibility = ref<ListVisibility>('PRIVATE');
const submitting = ref(false);
const error = ref('');

const typeOptions = [
  { value: 'CUSTOM', label: t('lists.types.CUSTOM') },
  { value: 'SEGMENT', label: t('lists.types.SEGMENT') },
];

const handleSubmit = async () => {
  if (!name.value.trim()) return;
  submitting.value = true;
  error.value = '';

  try {
    await listsStore.createList(name.value.trim(), type.value, visibility.value);
    emit('created');
  } catch (e) {
    error.value = t('lists.createError');
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-lg dark:bg-modal-background border dark:border-white/10 p-6">
      <h2 class="text-lg font-semibold dark:text-white mb-4">{{ $t('lists.createList') }}</h2>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">{{ $t('lists.nameLabel') }}</label>
          <input
            v-model="name"
            type="text"
            maxlength="100"
            class="w-full p-2 rounded-lg text-sm dark:bg-modal-input dark:border-white/5 border dark:text-white"
            :placeholder="$t('lists.namePlaceholder')"
            autofocus
          />
        </div>

        <div>
          <label class="block text-sm text-gray-400 mb-1">{{ $t('lists.typeLabel') }}</label>
          <select
            v-model="type"
            class="w-full p-2 rounded-lg text-sm dark:bg-modal-input dark:border-white/5 border dark:text-white"
          >
            <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-sm text-gray-400 mb-1">{{ $t('lists.visibilityLabel') }}</label>
          <select
            v-model="visibility"
            class="w-full p-2 rounded-lg text-sm dark:bg-modal-input dark:border-white/5 border dark:text-white"
          >
            <option value="PRIVATE">{{ $t('lists.visibility.PRIVATE') }}</option>
            <option value="PUBLIC">{{ $t('lists.visibility.PUBLIC') }}</option>
          </select>
        </div>

        <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

        <div class="flex justify-end gap-2">
          <UiButtonPrimaryAction @click="emit('close')" class="text-sm" type="button">
            {{ $t('lists.cancel') }}
          </UiButtonPrimaryAction>
          <UiButtonPrimaryAction
            type="submit"
            :disabled="!name.trim() || submitting"
            class="text-sm"
          >
            {{ submitting ? $t('lists.creating') : $t('lists.create') }}
          </UiButtonPrimaryAction>
        </div>
      </form>
    </div>
  </div>
</template>
