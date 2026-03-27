<script setup lang="ts">
import { mdiDotsVertical, mdiPencilOutline, mdiDeleteOutline, mdiEyeOutline, mdiEyeOffOutline } from '@mdi/js';
import type { Collection } from '@brigadasos/nadeshiko-sdk';

const { t } = useI18n();

const sdk = useNadeshikoSdk();

const { data: initialData } = await useAsyncData(
  'settings-account-collections',
  async () => {
    const { data } = await sdk.listCollections({ query: { take: 100 } }).catch(() => ({ data: null }));
    return data?.collections ?? ([] as Collection[]);
  },
  {
    default: () => [] as Collection[],
  },
);

const collections = ref<Collection[]>(initialData.value);

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// Actions dropdown
const openMenuId = ref<string | null>(null);

const toggleMenu = (id: string) => {
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
    await sdk.updateCollection({
      path: { id: renameTarget.value.publicId },
      body: { name: renameValue.value.trim() },
    });

    const target = renameTarget.value;
    if (!target) return;
    const idx = collections.value.findIndex((c) => c.publicId === target.publicId);
    const item = collections.value[idx];
    if (item) item.name = renameValue.value.trim();

    useToastSuccess(t('accountSettings.collections.renamed'));
    renameTarget.value = null;
  } catch {
    useToastError('Failed to rename collection');
  } finally {
    isRenaming.value = false;
  }
};

// Create collection
const showCreateModal = ref(false);
const createName = ref('');
const isCreating = ref(false);

const openCreate = () => {
  createName.value = '';
  showCreateModal.value = true;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('#nd-create-collection-input');
    input?.focus();
  });
};

const submitCreate = async () => {
  if (isCreating.value || !createName.value.trim()) return;

  isCreating.value = true;
  try {
    const { data } = await sdk.createCollection({
      body: { name: createName.value.trim() },
    });

    if (data) {
      collections.value.unshift({
        id: data.id,
        publicId: data.publicId,
        name: data.name,
        type: data.type,
        visibility: data.visibility as 'PUBLIC' | 'PRIVATE',
        segmentCount: 0,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    }

    useToastSuccess(t('accountSettings.collections.createSuccess'));
    showCreateModal.value = false;
  } catch {
    useToastError(t('accountSettings.collections.createError'));
  } finally {
    isCreating.value = false;
  }
};

// Toggle visibility
const visibilityTarget = ref<Collection | null>(null);
const isTogglingVisibility = ref(false);

const openToggleVisibility = (collection: Collection) => {
  closeMenu();
  visibilityTarget.value = collection;
};

const submitToggleVisibility = async () => {
  if (!visibilityTarget.value || isTogglingVisibility.value) return;

  isTogglingVisibility.value = true;
  const newVisibility = visibilityTarget.value.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
  try {
    await sdk.updateCollection({
      path: { id: visibilityTarget.value.publicId },
      body: { visibility: newVisibility },
    });

    const idx = collections.value.findIndex((c) => c.publicId === visibilityTarget.value?.publicId);
    const item = collections.value[idx];
    if (item) item.visibility = newVisibility;

    useToastSuccess(t('accountSettings.collections.visibilityChanged'));
    visibilityTarget.value = null;
  } catch {
    useToastError(t('accountSettings.collections.visibilityError'));
  } finally {
    isTogglingVisibility.value = false;
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
    await sdk.deleteCollection({
      path: { id: deleteTarget.value.publicId },
    });

    collections.value = collections.value.filter((c) => c.publicId !== deleteTarget.value?.publicId);

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
      <div class="flex items-center gap-3">
        <p v-if="collections.length > 0" class="text-sm text-gray-400">{{ collections.length }} collections</p>
        <button
          type="button"
          class="flex items-center gap-1.5 py-2 px-4 text-sm font-bold rounded-lg bg-button-accent-main text-white hover:bg-button-accent-hover transition-colors"
          data-testid="create-collection-button"
          @click="openCreate"
        >
          {{ t('accountSettings.collections.createButton') }}
        </button>
      </div>
    </div>
    <div class="border-b pt-4 border-white/10" />

    <div class="mt-4">
      <table v-if="collections.length > 0" class="min-w-full divide-y divide-gray-200 dark:divide-white/20">
        <thead>
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Name</th>
            <th class="py-2 text-center text-xs font-medium text-white/90 uppercase">Segments</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Visibility</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase hidden sm:table-cell">Created</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase hidden lg:table-cell">Updated</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="collection in collections" :key="collection.publicId" data-testid="collection-row">
            <td class="py-3 text-sm text-gray-100 max-w-[20rem]">
              <NuxtLink
                :to="`/collection/${collection.publicId}`"
                class="font-medium truncate block hover:text-blue-400 transition-colors"
              >
                {{ collection.name }}
              </NuxtLink>
            </td>
            <td class="py-3 text-sm text-gray-300 tabular-nums text-center">
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
                  data-testid="collection-menu-toggle"
                  class="p-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                  @click="toggleMenu(collection.publicId)"
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
                    v-if="openMenuId === collection.publicId"
                    class="absolute right-0 top-full mt-1 z-20 w-40 rounded-lg border border-white/10 bg-neutral-800 shadow-xl py-1"
                  >
                    <button
                      type="button"
                      data-testid="collection-rename-action"
                      class="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                      @click="openRename(collection)"
                    >
                      <UiBaseIcon :path="mdiPencilOutline" size="16" />
                      {{ t('accountSettings.collections.rename') }}
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                      @click="openToggleVisibility(collection)"
                    >
                      <UiBaseIcon :path="collection.visibility === 'PUBLIC' ? mdiEyeOffOutline : mdiEyeOutline" size="16" />
                      {{ collection.visibility === 'PUBLIC'
                        ? t('accountSettings.collections.makePrivate')
                        : t('accountSettings.collections.makePublic') }}
                    </button>
                    <button
                      v-if="collection.type !== 'ANKI_EXPORT'"
                      type="button"
                      data-testid="collection-delete-action"
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
                class="w-full rounded-lg border border-gray-300 bg-modal-input text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-input-focus-ring dark:border-white/5"
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
                data-testid="collection-rename-submit"
                :disabled="isRenaming || !renameValue.trim()"
                class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-accent-main text-white hover:bg-button-accent-hover disabled:opacity-50 disabled:pointer-events-none"
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

    <!-- Create collection modal -->
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
          v-if="showCreateModal"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/60"
          @click.self="showCreateModal = false"
        >
          <div class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl">
            <div class="px-4 py-3 border-b border-modal-border">
              <h3 class="font-bold text-white">{{ t('accountSettings.collections.createTitle') }}</h3>
            </div>
            <div class="p-4">
              <label class="block text-sm text-gray-400 mb-1.5">{{ t('accountSettings.collections.nameLabel') }}</label>
              <input
                id="nd-create-collection-input"
                v-model="createName"
                type="text"
                maxlength="100"
                :placeholder="t('accountSettings.collections.namePlaceholder')"
                class="w-full rounded-lg border border-gray-300 bg-modal-input text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-input-focus-ring dark:border-white/5"
                @keydown.enter="submitCreate"
                @keydown.escape="showCreateModal = false"
              />
            </div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-modal-border">
              <button
                type="button"
                class="py-2 px-3 text-sm rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
                @click="showCreateModal = false"
              >
                {{ t('accountSettings.collections.renameCancel') }}
              </button>
              <button
                type="button"
                data-testid="collection-create-submit"
                :disabled="isCreating || !createName.trim()"
                class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-accent-main text-white hover:bg-button-accent-hover disabled:opacity-50 disabled:pointer-events-none"
                @click="submitCreate"
              >
                <span
                  v-if="isCreating"
                  class="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full mr-1"
                />
                {{ t('accountSettings.collections.createConfirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Visibility toggle confirmation modal -->
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
          v-if="visibilityTarget"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/60"
          @click.self="visibilityTarget = null"
        >
          <div class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl">
            <div class="px-4 py-3 border-b border-modal-border">
              <h3 class="font-bold text-white">{{ t('accountSettings.collections.visibilityTitle') }}</h3>
            </div>
            <div class="p-4">
              <p class="text-sm text-gray-300">
                {{ visibilityTarget.visibility === 'PUBLIC'
                  ? t('accountSettings.collections.makePrivateMessage', { name: visibilityTarget.name })
                  : t('accountSettings.collections.makePublicMessage', { name: visibilityTarget.name }) }}
              </p>
            </div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-modal-border">
              <button
                type="button"
                class="py-2 px-3 text-sm rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
                @click="visibilityTarget = null"
              >
                {{ t('accountSettings.collections.renameCancel') }}
              </button>
              <button
                type="button"
                :disabled="isTogglingVisibility"
                class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-accent-main text-white hover:bg-button-accent-hover disabled:opacity-50 disabled:pointer-events-none"
                @click="submitToggleVisibility"
              >
                <span
                  v-if="isTogglingVisibility"
                  class="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full mr-1"
                />
                {{ t('accountSettings.collections.visibilityConfirm') }}
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
                data-testid="collection-delete-submit"
                :disabled="isDeleting"
                class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-accent-main text-white hover:bg-button-accent-hover disabled:opacity-50 disabled:pointer-events-none"
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
