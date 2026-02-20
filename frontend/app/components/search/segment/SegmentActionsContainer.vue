<script setup lang="ts">
import {
  mdiFileDocumentPlusOutline,
  mdiStarShootingOutline,
  mdiTrayArrowDown,
  mdiVideo,
  mdiImage,
  mdiVolumeHigh,
  mdiContentCopy,
  mdiText,
  mdiPlusBoxOutline,
  mdiDotsHorizontal,
  mdiShareVariantOutline,
  mdiClose,
  mdiTransferLeft,
  mdiArrowExpandHorizontal,
  mdiTransferRight,
  mdiPencilOutline,
  mdiFlagOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFormatListBulletedSquare,
} from '@mdi/js';

import { ankiStore } from '@/stores/anki';
import { userStore } from '@/stores/auth';
import type { SearchResult } from '~/types/search';
import { useToastError, useToastSuccess } from '~/utils/toast';

type Props = {
  content: SearchResult;
};

type CollectionListResponse = {
  collections: { id: number; name: string; userId: number; visibility: string }[];
  pagination: { hasMore: boolean; cursor: number | null };
};

type CollectionOption = {
  id: number;
  name: string;
};

const LAST_COLLECTION_KEY = 'nd-last-collection';

const props = defineProps<Props>();
const anki = ankiStore();
const user = userStore();
const sdk = useNadeshikoSdk();
const { t } = useI18n();
const router = useRouter();
const { isMediaHidden, toggleHideMedia } = useHiddenMedia();
const isAnkiConfigured = ref(false);
const collections = ref<CollectionOption[]>([]);
const collectionsLoading = ref(false);
const collectionsLoaded = ref(false);
const addingCollectionId = ref<number | null>(null);
const showCollectionPicker = ref(false);

const lastCollection = ref<CollectionOption | null>(null);

onMounted(() => {
  const profile = anki.activeProfile;
  isAnkiConfigured.value =
    profile !== null && profile.deck !== null && profile.model !== null && profile.fields.length > 0;

  const stored = localStorage.getItem(LAST_COLLECTION_KEY);
  if (stored) {
    try {
      lastCollection.value = JSON.parse(stored);
    } catch {
      lastCollection.value = null;
    }
  }
});

const emit = defineEmits([
  'open-context-modal',
  'open-anki-modal',
  'concat-sentence',
  'revert-concat',
  'open-edit-modal',
  'open-report-modal',
]);

const concatSentence = (direction: 'forward' | 'backward' | 'both') => {
  emit('concat-sentence', props.content, direction);
};

const revertConcat = () => {
  emit('revert-concat', props.content);
};

const openContextModal = () => {
  emit('open-context-modal', props.content);
};

const openAnkiModal = () => {
  emit('open-anki-modal');
};

const saveLastCollection = (collection: CollectionOption) => {
  lastCollection.value = collection;
  localStorage.setItem(LAST_COLLECTION_KEY, JSON.stringify(collection));
};

const loadCollections = async () => {
  if (!user.isLoggedIn || collectionsLoading.value || collectionsLoaded.value) return;

  collectionsLoading.value = true;
  try {
    const { data } = await sdk.listCollections({ query: { limit: 100 } });
    const items = data?.collections ?? [];
    collections.value = items;
    collectionsLoaded.value = true;

    if (!lastCollection.value && items.length > 0) {
      lastCollection.value = { id: items[0]!.id, name: items[0]!.name };
    }
  } catch (error) {
    console.error('Failed to load collections:', error);
    collections.value = [];
    collectionsLoaded.value = false;
  } finally {
    collectionsLoading.value = false;
  }
};

const addToCollection = async (collection: CollectionOption) => {
  if (addingCollectionId.value !== null) return;

  addingCollectionId.value = collection.id;
  try {
    await sdk.addSegmentToCollection({
      path: { id: collection.id },
      body: { segmentUuid: props.content.segment.uuid },
    });
    useToastSuccess(t('searchpage.main.labels.collectionAdded', { name: collection.name }));
    saveLastCollection(collection);
  } catch {
    useToastError(t('searchpage.main.labels.collectionAddFailed'));
  } finally {
    addingCollectionId.value = null;
  }
};

const quickAddToLastCollection = async () => {
  if (!lastCollection.value) return;
  await addToCollection(lastCollection.value);
};

const openCollectionsPage = async () => {
  await router.push('/user/collections');
};
</script>
<template>
  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-with-header" @click="loadCollections">
        <UiBaseIcon :path="mdiFileDocumentPlusOutline" />
        {{ $t('searchpage.main.buttons.add') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('searchpage.main.buttons.add')">
        <!-- Anki by last added -->
        <ClientOnly>
          <SearchDropdownItem :is-disabled="!isAnkiConfigured" :text="$t('searchpage.main.buttons.addToAnkiLast')"
            :iconPath="mdiStarShootingOutline" @click="anki.addSentenceToAnki(content)" />

          <!-- Anki by ID -->
          <SearchDropdownItem :is-disabled="!isAnkiConfigured" :text="$t('searchpage.main.buttons.addToAnkiSearch')"
            @click="openAnkiModal()" :iconPath="mdiStarShootingOutline"
            data-nd-overlay="#nd-vertically-centered-scrollable-anki-collection" />
          <template #fallback>
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.addToAnkiLast')"
              :iconPath="mdiStarShootingOutline" />
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.addToAnkiSearch')"
              :iconPath="mdiStarShootingOutline" />
          </template>
        </ClientOnly>
        <template v-if="user.isLoggedIn">
          <div
            class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
          </div>

          <!-- Quick-add to last used collection -->
          <ClientOnly>
            <SearchDropdownItem
              v-if="lastCollection"
              :is-disabled="addingCollectionId === lastCollection.id"
              :text="`${$t('searchpage.main.buttons.addToCollection')}: ${lastCollection.name}`"
              :iconPath="mdiFormatListBulletedSquare"
              @click="quickAddToLastCollection"
            />
          </ClientOnly>

          <!-- Choose collection picker -->
          <SearchDropdownItem
            v-if="collectionsLoading"
            :is-disabled="true"
            :text="$t('searchpage.main.buttons.collectionsLoading')"
            :iconPath="mdiFormatListBulletedSquare"
          />
          <template v-else>
            <SearchDropdownItem
              :text="$t('searchpage.main.buttons.chooseCollection')"
              :iconPath="mdiFormatListBulletedSquare"
              @click="showCollectionPicker = !showCollectionPicker"
            />
            <div v-if="showCollectionPicker && collections.length > 0" class="max-h-56 overflow-y-auto pl-4">
              <SearchDropdownItem
                v-for="collection in collections"
                :key="collection.id"
                :is-disabled="addingCollectionId === collection.id"
                :text="collection.name"
                :iconPath="mdiFormatListBulletedSquare"
                @click="addToCollection(collection)"
              />
            </div>
            <SearchDropdownItem
              v-if="showCollectionPicker && collectionsLoaded && collections.length === 0"
              :is-disabled="true"
              :text="$t('searchpage.main.buttons.collectionsEmpty')"
              :iconPath="mdiFormatListBulletedSquare"
            />
          </template>
          <SearchDropdownItem
            :text="$t('searchpage.main.buttons.manageCollections')"
            :iconPath="mdiFormatListBulletedSquare"
            @click="openCollectionsPage"
          />
        </template>
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiTrayArrowDown" />
        {{ $t('searchpage.main.buttons.download') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('searchpage.main.buttons.download')">
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.segment.urls.videoUrl, content.segment.urls.videoUrl.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.segment.urls.imageUrl, content.segment.urls.imageUrl.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.segment.urls.audioUrl, content.segment.urls.audioUrl.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
        <SearchDropdownItem
          v-if="content.blobAudioUrl"
          @click="downloadAudioOrImage(content.blobAudioUrl, 'expanded_'+content.segment.urls.audioUrl.split('/').pop()!, true)"
          :text="$t('searchpage.main.buttons.dl-expanded')" :iconPath="mdiVolumeHigh" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiContentCopy" />
        {{ $t('searchpage.main.buttons.copyclipboard') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('searchpage.main.buttons.copyclipboard')">
        <SearchDropdownItem @click="copyToClipboard(content.segment.urls.videoUrl)"
          :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
        <SearchDropdownItem @click="copyToClipboard(content.segment.urls.imageUrl)"
          :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
        <SearchDropdownItem @click="copyToClipboard(content.segment.urls.audioUrl)"
          :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
        <div
          class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
        </div>
        <SearchDropdownItem @click="copyToClipboard(content.segment.textJa.content)"
          :text="$t('searchpage.main.buttons.jpsentence')" :iconPath="mdiText" />
        <SearchDropdownItem @click="copyToClipboard(content.segment.textEn.content)"
          :text="$t('searchpage.main.buttons.ensentence')" :iconPath="mdiText" />
        <SearchDropdownItem @click="copyToClipboard(content.segment.textEs.content)"
          :text="$t('searchpage.main.buttons.essentence')" :iconPath="mdiText" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <UiButtonPrimaryAction data-nd-overlay="#nd-vertically-centered-scrollable-context" class="mr-2 text-xs py-2.5 px-3"
    @click="openContextModal">
    <UiBaseIcon :path="mdiPlusBoxOutline" />
    {{ $t('searchpage.main.buttons.context') }}
  </UiButtonPrimaryAction>

  <UiButtonPrimaryAction
    class="mr-2 text-xs py-2.5 px-3"
    :title="$t('searchpage.main.buttons.share')"
    @click="getSharingURL(content.segment.uuid)"
  >
    <UiBaseIcon :path="mdiShareVariantOutline" />
  </UiButtonPrimaryAction>

  <SearchDropdownContainer class="mr-2 my-1" dropdownId="nd-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiDotsHorizontal" />
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('searchpage.main.buttons.more')">
        <SearchDropdownItem v-if="content.blobAudioUrl" :text="$t('segment.revert')" :iconPath="mdiClose"
          @click="revertConcat" />
        <SearchDropdownItem :text="$t('searchpage.main.buttons.expandLeft')" :iconPath="mdiTransferLeft"
          @click="concatSentence('backward')" />
        <SearchDropdownItem :text="$t('searchpage.main.buttons.expandBoth')" :iconPath="mdiArrowExpandHorizontal"
          @click="concatSentence('both')" />
        <SearchDropdownItem :text="$t('searchpage.main.buttons.expandRight')" :iconPath="mdiTransferRight"
          @click="concatSentence('forward')" />
        <div
          class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
        </div>
        <SearchDropdownItem
          :text="isMediaHidden(content.media.id) ? $t('searchpage.main.buttons.unhideMedia') : $t('searchpage.main.buttons.hideMedia')"
          :iconPath="isMediaHidden(content.media.id) ? mdiEyeOutline : mdiEyeOffOutline"
          @click="toggleHideMedia(content.media)"
        />
        <template v-if="user.isLoggedIn">
          <div
            class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
          </div>
          <SearchDropdownItem :text="$t('reports.reportSegment')" :iconPath="mdiFlagOutline"
            data-nd-overlay="#nd-vertically-centered-scrollable-report"
            @click="emit('open-report-modal', content)" />
        </template>
        <template v-if="user.isAdmin">
          <div
            class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
          </div>
          <SearchDropdownItem :text="$t('modalSegmentEdit.editButton')" :iconPath="mdiPencilOutline"
            data-nd-overlay="#nd-vertically-centered-scrollable-segment-edit"
            @click="emit('open-edit-modal', content)" />
        </template>
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

</template>
