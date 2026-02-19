<script setup lang="ts">
import { mdiDotsVertical, mdiPencilOutline, mdiDeleteOutline } from '@mdi/js';

type Collection = {
  id: number;
  name: string;
  userId: number;
  visibility: 'PUBLIC' | 'PRIVATE';
  segmentCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

type CollectionListResponse = {
  collections: Collection[];
  pagination: { hasMore: boolean; cursor: number | null };
};

const { t, d } = useI18n();

const { data: initialData } = await useAsyncData(
  'settings-account-collections',
  async () => {
    const response = await $fetch<CollectionListResponse>('/api/collections', {
      query: { limit: 100 },
    }).catch(() => ({ collections: [] as Collection[], pagination: { hasMore: false, cursor: null } }));

    return response.collections;
  },
  {
    default: () => [] as Collection[],
  },
);

const collections = ref<Collection[]>(initialData.value);

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '';
  return d(new Date(dateStr), 'short');
};

// Actions dropdown
const openMenuId = ref<number | null>(null);

const toggleMenu = (id: number) => {
  openMenuId.value = openMenuId.value === id ? null : id;
};

const closeMenu = () => {
  openMenuId.value = null;
};

// Click outside to close menu
const onClickOutside = (e: MouseEvent) => {
  if (openMenuId.value !== null && !(e.target as HTMLElement).closest('.nd-collection-actions')) {
    closeMenu();
  }
};

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));

// Rename modal
const renameTarget = ref<Collection | null>(null);
const renameValue = ref('');
const isRenaming = ref(false);

const openRename = (collection: Collection) => {
  closeMenu();
  renameTarget.value = collection;
  renameValue.value = collection.name;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('#nd-rename-input');
    input?.focus();
    input?.select();
  });
};

const submitRename = async () => {
  if (!renameTarget.value || isRenaming.value || !renameValue.value.trim()) return;

  isRenaming.value = true;
  try {
    await $fetch(`/api/collections/${renameTarget.value.id}`, {
      method: 'PATCH',
      body: { name: renameValue.value.trim() },
    });

    const idx = collections.value.findIndex((c) => c.id === renameTarget.value!.id);
    if (idx !== -1) collections.value[idx].name = renameValue.value.trim();

    useToastSuccess(t('accountSettings.collections.renamed'));
    renameTarget.value = null;
  } catch {
    useToastError('Failed to rename collection');
  } finally {
    isRenaming.value = false;
  }
};

// Delete confirmation
const deleteTarget = ref<Collection | null>(null);
const isDeleting = ref(false);

const openDelete = (collection: Collection) => {
  closeMenu();
  deleteTarget.value = collection;
};

const submitDelete = async () => {
  if (!deleteTarget.value || isDeleting.value) return;

  isDeleting.value = true;
  try {
    await $fetch(`/api/collections/${deleteTarget.value.id}`, {
      method: 'DELETE',
    });

    collections.value = collections.value.filter((c) => c.id !== deleteTarget.value!.id);

    useToastSuccess(t('accountSettings.collections.deleted'));
    deleteTarget.value = null;
  } catch {
    useToastError('Failed to delete collection');
  } finally {
    isDeleting.value = false;
  }
};
</script>

<template>
  <div class="dark:bg-card-background p-6 mb-6 mx-auto rounded-lg shadow-md">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">Collections</h3>
      <p v-if="collections.length > 0" class="text-sm text-gray-400">{{ collections.length }} collections</p>
    </div>
    <div class="border-b pt-4 border-white/10" />

    <div class="mt-4 overflow-x-auto">
      <table v-if="collections.length > 0" class="min-w-full divide-y divide-gray-200 dark:divide-white/20">
        <thead>
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Name</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Segments</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Visibility</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase hidden sm:table-cell">Created</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase hidden lg:table-cell">Updated</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="collection in collections" :key="collection.id">
            <td class="py-3 text-sm text-gray-100 max-w-[20rem]">
              <NuxtLink
                :to="{ path: '/search', query: { collectionId: collection.id } }"
                class="font-medium truncate block hover:text-blue-400 transition-colors"
              >
                {{ collection.name }}
              </NuxtLink>
            </td>
            <td class="py-3 text-sm text-gray-300 tabular-nums">
              {{ collection.segmentCount ?? 0 }}
            </td>
            <td class="py-3 text-sm">
              <span
                class="text-xs px-2 py-0.5 rounded-full border"
                :class="collection.visibility === 'PUBLIC'
                  ? 'border-emerald-700/50 text-emerald-400/80'
                  : 'border-white/10 text-gray-500'"
              >
                {{ t(`accountSettings.collections.visibility.${collection.visibility}`) }}
              </span>
            </td>
            <td class="py-3 text-sm text-gray-300 hidden sm:table-cell">
              {{ formatDate(collection.createdAt) }}
            </td>
            <td class="py-3 text-sm text-gray-300 hidden lg:table-cell">
              {{ formatDate(collection.updatedAt) }}
            </td>
            <td class="py-3 text-sm text-right">
              <div class="nd-collection-actions relative inline-block">
                <button
                  type="button"
                  class="p-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                  @click="toggleMenu(collection.id)"
                >
                  <UiBaseIcon :path="mdiDotsVertical" size="18" />
                </button>

                <Transition
                  enter-active-class="transition duration-100 ease-out"
                  enter-from-class="opacity-0 scale-95"
                  enter-to-class="opacity-100 scale-100"
                  leave-active-class="transition duration-75 ease-in"
                  leave-from-class="opacity-100 scale-100"
                  leave-to-class="opacity-0 scale-95"
                >
                  <div
                    v-if="openMenuId === collection.id"
                    class="absolute right-0 top-full mt-1 z-20 w-40 rounded-lg border border-white/10 bg-neutral-800 shadow-xl py-1"
                  >
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                      @click="openRename(collection)"
                    >
                      <UiBaseIcon :path="mdiPencilOutline" size="16" />
                      {{ t('accountSettings.collections.rename') }}
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                      @click="openDelete(collection)"
                    >
                      <UiBaseIcon :path="mdiDeleteOutline" size="16" />
                      {{ t('accountSettings.collections.delete') }}
                    </button>
                  </div>
                </Transition>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else class="text-gray-400 text-sm">{{ t('accountSettings.collections.noCollections') }}</p>
    </div>

    <!-- Rename modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="renameTarget"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/60"
          @click.self="renameTarget = null"
        >
          <div class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl">
            <div class="px-4 py-3 border-b border-modal-border">
              <h3 class="font-bold text-white">{{ t('accountSettings.collections.renameTitle') }}</h3>
            </div>
            <div class="p-4">
              <input
                id="nd-rename-input"
                v-model="renameValue"
                type="text"
                maxlength="100"
                class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                @keydown.enter="submitRename"
                @keydown.escape="renameTarget = null"
              />
            </div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-modal-border">
              <button
                type="button"
                class="py-2 px-3 text-sm rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
                @click="renameTarget = null"
              >
                {{ t('accountSettings.collections.renameCancel') }}
              </button>
              <button
                type="button"
                :disabled="isRenaming || !renameValue.trim()"
                class="py-2 px-4 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none"
                @click="submitRename"
              >
                <span
                  v-if="isRenaming"
                  class="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full mr-1"
                />
                {{ t('accountSettings.collections.renameConfirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="deleteTarget"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/60"
          @click.self="deleteTarget = null"
        >
          <div class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl">
            <div class="px-4 py-3 border-b border-modal-border">
              <h3 class="font-bold text-white">{{ t('accountSettings.collections.deleteTitle') }}</h3>
            </div>
            <div class="p-4">
              <p class="text-sm text-gray-300">
                {{ t('accountSettings.collections.deleteMessage', { name: deleteTarget.name }) }}
              </p>
            </div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-modal-border">
              <button
                type="button"
                class="py-2 px-3 text-sm rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
                @click="deleteTarget = null"
              >
                {{ t('accountSettings.collections.deleteCancel') }}
              </button>
              <button
                type="button"
                :disabled="isDeleting"
                class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-danger-main text-white hover:bg-button-danger-hover disabled:opacity-50 disabled:pointer-events-none"
                @click="submitDelete"
              >
                <span
                  v-if="isDeleting"
                  class="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full mr-1"
                />
                {{ t('accountSettings.collections.deleteConfirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
