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
} from '@mdi/js';

import { ankiStore } from '@/stores/anki';
import type { Sentence } from '@/stores/search';

type Props = {
  content: Sentence;
};

const props = defineProps<Props>();
const anki = ankiStore();
const isAnkiConfigured = ref(false);

onMounted(() => {
  const current = anki.ankiPreferences.settings.current;
  isAnkiConfigured.value = current.deck !== null && current.model !== null && current.fields.length > 0;
});

const emit = defineEmits(['open-context-modal', 'open-anki-modal', 'concat-sentence', 'revert-concat']);

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
</script>
<template>
  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiFileDocumentPlusOutline" />
        {{ $t('searchpage.main.buttons.add') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
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
      <SearchDropdownContent>
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.mediaInfo.pathVideo, content.mediaInfo.pathVideo.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.mediaInfo.pathImage, content.mediaInfo.pathImage.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.mediaInfo.pathAudio, content.mediaInfo.pathAudio.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
        <SearchDropdownItem
          v-if="content.mediaInfo.blobAudioUrl"
          @click="downloadAudioOrImage(content.mediaInfo.blobAudioUrl, 'expanded_'+content.mediaInfo.pathAudio.split('/').pop()!, true)"
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
      <SearchDropdownContent>
        <SearchDropdownItem @click="copyToClipboard(content.mediaInfo.pathVideo)"
          :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
        <SearchDropdownItem @click="copyToClipboard(content.mediaInfo.pathImage)"
          :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
        <SearchDropdownItem @click="copyToClipboard(content.mediaInfo.pathAudio)"
          :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
        <div
          class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
        </div>
        <SearchDropdownItem @click="copyToClipboard(content.segmentInfo.contentJp)"
          :text="$t('searchpage.main.buttons.jpsentence')" :iconPath="mdiText" />
        <SearchDropdownItem @click="copyToClipboard(content.segmentInfo.contentEn)"
          :text="$t('searchpage.main.buttons.ensentence')" :iconPath="mdiText" />
        <SearchDropdownItem @click="copyToClipboard(content.segmentInfo.contentEs)"
          :text="$t('searchpage.main.buttons.essentence')" :iconPath="mdiText" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <UiButtonPrimaryAction data-nd-overlay="#nd-vertically-centered-scrollable-context" class="mr-2 text-xs py-2.5 px-3"
    @click="openContextModal">
    <UiBaseIcon :path="mdiPlusBoxOutline" />
    {{ $t('searchpage.main.buttons.context') }}
  </UiButtonPrimaryAction>

  <SearchDropdownContainer class="mr-2 my-1" dropdownId="nd-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiDotsHorizontal" />
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <SearchDropdownItem :text="$t('searchpage.main.buttons.share')" :iconPath="mdiShareVariantOutline"
          @click="getSharingURL(content.segmentInfo.uuid)" />
        <SearchDropdownItem v-if="content.mediaInfo.blobAudioUrl" :text="$t('segment.revert')" :iconPath="mdiClose"
          @click="revertConcat" />
        <SearchDropdownItem :text="$t('searchpage.main.buttons.expandLeft')" :iconPath="mdiTransferLeft"
          @click="concatSentence('backward')" />
        <SearchDropdownItem :text="$t('searchpage.main.buttons.expandBoth')" :iconPath="mdiArrowExpandHorizontal"
          @click="concatSentence('both')" />
        <SearchDropdownItem :text="$t('searchpage.main.buttons.expandRight')" :iconPath="mdiTransferRight"
          @click="concatSentence('forward')" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

</template>
