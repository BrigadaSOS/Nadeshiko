<script setup lang="ts">
import { mdiDotsVertical, mdiPencilOutline, mdiDeleteOutline, mdiEyeOutline, mdiEyeOffOutline } from '@mdi/js';
import type { Collection } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const { formatNumber, formatDate } = useFormat();

const sdk = useNadeshikoSdk();
const posthog = usePostHog();

// Distinguishes "you have no collections" from "we could not load them"; without
// it a failed fetch renders the same empty-state copy as a brand-new account.
const loadFailed = ref(false);

const { data: initialData, refresh: refreshCollections } = await useAsyncData(
  'settings-account-collections',
  async () => {
    const data = await sdk.listCollections({ take: 100 }).catch((error: unknown) => {
      handleApiError('collections:list-failed', error, { toastKey: false });
      loadFailed.value = true;
      return null;
    });
    return data?.collections ?? ([] as Collection[]);
  },
  {
    // Server-rendered, via `useNadeshikoSdk`: this is the reader's own data, and the
    // call now carries their session rather than the service key. It used to be
    // `server: false` for exactly that reason. The `/user/**` route guard runs
    // before setup, so this only ever executes for someone signed in.
    default: () => [] as Collection[],
  },
);

const retryLoad = async () => {
  loadFailed.value = false;
  await refreshCollections();
};

const collections = ref<Collection[]>(initialData.value);

// Still watched, for `refreshCollections()` after a create/rename/delete -- the
// SSR pass now seeds `collections` directly, but a refresh still replaces
// `initialData` underneath it.
watch(initialData, (data) => {
  collections.value = data ?? [];
});

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
const renameInput = ref<HTMLInputElement | null>(null);

const openRename = (collection: Collection) => {
  closeMenu();
  renameTarget.value = collection;
  renameValue.value = collection.name;
  // BaseModal focuses `[data-autofocus]` on open; only the pre-selection of the
  // current name is left to do here.
  nextTick(() => renameInput.value?.select());
};

const submitRename = async () => {
  if (!renameTarget.value || isRenaming.value || !renameValue.value.trim()) return;

  isRenaming.value = true;
  try {
    await sdk.updateCollection({
      collectionPublicId: renameTarget.value.publicId,
      name: renameValue.value.trim(),
    });

    const target = renameTarget.value;
    if (!target) return;
    const idx = collections.value.findIndex((c) => c.publicId === target.publicId);
    const item = collections.value[idx];
    if (item) item.name = renameValue.value.trim();

    useToastSuccess(t('accountSettings.collections.renamed'));
    renameTarget.value = null;
  } catch (error) {
    handleApiError('collections:rename-failed', error, { toastKey: 'accountSettings.collections.renameError' });
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
};

const submitCreate = async () => {
  if (isCreating.value || !createName.value.trim()) return;

  isCreating.value = true;
  try {
    const data = await sdk.createCollection({ name: createName.value.trim() });
    collections.value.unshift(data);

    posthog?.capture('collection_created');
    useToastSuccess(t('accountSettings.collections.createSuccess'));
    showCreateModal.value = false;
  } catch (error) {
    handleApiError('collections:create-failed', error, { toastKey: 'accountSettings.collections.createError' });
  } finally {
    isCreating.value = false;
  }
};

// Collections get Japanese names, so Enter here may be confirming an IME
// conversion rather than submitting -- see #399. Renaming is the one that
// really bites: `renameValue` still holds the old name at that point, so the
// confirming press would rename the collection to what it was already called
// and close the modal over the reader's typing.
const renameEnterSubmit = useEnterSubmit(submitRename);
const createEnterSubmit = useEnterSubmit(submitCreate);

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
      collectionPublicId: visibilityTarget.value.publicId,
      visibility: newVisibility,
    });

    const idx = collections.value.findIndex((c) => c.publicId === visibilityTarget.value?.publicId);
    const item = collections.value[idx];
    if (item) item.visibility = newVisibility;

    posthog?.capture('collection_visibility_changed', { new_visibility: newVisibility });
    useToastSuccess(t('accountSettings.collections.visibilityChanged'));
    visibilityTarget.value = null;
  } catch (error) {
    handleApiError('collections:visibility-update-failed', error, {
      toastKey: 'accountSettings.collections.visibilityError',
    });
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
    await sdk.deleteCollection(deleteTarget.value.publicId);

    collections.value = collections.value.filter((c) => c.publicId !== deleteTarget.value?.publicId);

    posthog?.capture('collection_deleted');
    useToastSuccess(t('accountSettings.collections.deleted'));
    deleteTarget.value = null;
  } catch (error) {
    handleApiError('collections:delete-failed', error, { toastKey: 'accountSettings.collections.deleteError' });
  } finally {
    isDeleting.value = false;
  }
};
</script>

<template>
  <div class="dark:bg-card-background p-6 mb-6 mx-auto rounded-lg shadow-md">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.collections.title') }}</h3>
      <div class="flex items-center gap-3">
        <p v-if="collections.length > 0" class="text-sm text-gray-400">{{ t('accountSettings.collections.count', { count: formatNumber(collections.length) }) }}</p>
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
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.collections.table.name') }}</th>
            <th class="py-2 text-center text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.collections.table.segments') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.collections.table.visibility') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase hidden sm:table-cell">{{ t('accountSettings.collections.table.created') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase hidden lg:table-cell">{{ t('accountSettings.collections.table.updated') }}</th>
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
              {{ formatNumber(collection.segmentCount ?? 0) }}
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

      <div v-else-if="loadFailed" class="text-sm" data-testid="collections-load-error">
        <p class="text-red-400">{{ t('accountSettings.collections.loadError') }}</p>
        <button
          type="button"
          class="mt-2 py-1.5 px-3 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          @click="retryLoad"
        >
          {{ t('searchContainer.retryButton') }}
        </button>
      </div>

      <p v-else class="text-gray-400 text-sm">{{ t('accountSettings.collections.noCollections') }}</p>
    </div>

    <!-- Rename modal -->
    <CommonBaseModal
      :open="!!renameTarget"
      labelledby="nd-collection-rename-title"
      panel-class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl"
      @close="renameTarget = null"
    >
      <div class="px-4 py-3 border-b border-modal-border">
        <h3 id="nd-collection-rename-title" class="font-bold text-white">{{ t('accountSettings.collections.renameTitle') }}</h3>
      </div>
      <div class="p-4">
        <input
          id="nd-rename-input"
          ref="renameInput"
          v-model="renameValue"
          :aria-label="t('accountSettings.collections.nameLabel')"
          data-autofocus
          type="text"
          maxlength="100"
          class="w-full rounded-lg border border-gray-300 bg-modal-input text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-input-focus-ring dark:border-white/5"
          v-on="renameEnterSubmit"
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
          class="nd-btn-accent"
          @click="submitRename"
        >
          <span
            v-if="isRenaming"
            class="nd-spinner"
          />
          {{ t('accountSettings.collections.renameConfirm') }}
        </button>
      </div>
    </CommonBaseModal>

    <!-- Create collection modal -->
    <CommonBaseModal
      :open="showCreateModal"
      labelledby="nd-collection-create-title"
      panel-class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl"
      @close="showCreateModal = false"
    >
      <div class="px-4 py-3 border-b border-modal-border">
        <h3 id="nd-collection-create-title" class="font-bold text-white">{{ t('accountSettings.collections.createTitle') }}</h3>
      </div>
      <div class="p-4">
        <label class="block text-sm text-gray-400 mb-1.5" for="nd-create-collection-input">{{ t('accountSettings.collections.nameLabel') }}</label>
        <input
          id="nd-create-collection-input"
          v-model="createName"
          data-autofocus
          type="text"
          maxlength="100"
          :placeholder="t('accountSettings.collections.namePlaceholder')"
          class="w-full rounded-lg border border-gray-300 bg-modal-input text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-input-focus-ring dark:border-white/5"
          v-on="createEnterSubmit"
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
          class="nd-btn-accent"
          @click="submitCreate"
        >
          <span
            v-if="isCreating"
            class="nd-spinner"
          />
          {{ t('accountSettings.collections.createConfirm') }}
        </button>
      </div>
    </CommonBaseModal>

    <!-- Visibility toggle confirmation modal -->
    <CommonBaseModal
      :open="!!visibilityTarget"
      labelledby="nd-collection-visibility-title"
      panel-class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl"
      @close="visibilityTarget = null"
    >
      <div class="px-4 py-3 border-b border-modal-border">
        <h3 id="nd-collection-visibility-title" class="font-bold text-white">{{ t('accountSettings.collections.visibilityTitle') }}</h3>
      </div>
      <div class="p-4">
        <p v-if="visibilityTarget" class="text-sm text-gray-300">
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
          class="nd-btn-accent"
          @click="submitToggleVisibility"
        >
          <span
            v-if="isTogglingVisibility"
            class="nd-spinner"
          />
          {{ t('accountSettings.collections.visibilityConfirm') }}
        </button>
      </div>
    </CommonBaseModal>

    <!-- Delete confirmation modal -->
    <CommonBaseModal
      :open="!!deleteTarget"
      labelledby="nd-collection-delete-title"
      panel-class="w-full max-w-md mx-4 rounded-xl bg-modal-background border border-modal-border shadow-xl"
      @close="deleteTarget = null"
    >
      <div class="px-4 py-3 border-b border-modal-border">
        <h3 id="nd-collection-delete-title" class="font-bold text-white">{{ t('accountSettings.collections.deleteTitle') }}</h3>
      </div>
      <div class="p-4">
        <p v-if="deleteTarget" class="text-sm text-gray-300">
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
          class="nd-btn-accent"
          @click="submitDelete"
        >
          <span
            v-if="isDeleting"
            class="nd-spinner"
          />
          {{ t('accountSettings.collections.deleteConfirm') }}
        </button>
      </div>
    </CommonBaseModal>
  </div>
</template>
