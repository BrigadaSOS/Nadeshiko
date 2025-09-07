<script setup lang="ts">
import { mdiText, mdiImage, mdiVideo, mdiContentCopy, mdiClose, mdiShareVariantOutline, mdiPlusBoxOutline, mdiFileDocumentPlusOutline, mdiStarShootingOutline, mdiTrayArrowDown,mdiArrowExpandHorizontal,mdiTransferLeft , mdiDotsHorizontal, mdiVolumeHigh, mdiTransferRight } from '@mdi/js'

import type { Sentence } from "@/stores/search";

type Props = {
  content: Sentence;
}

let props = defineProps<Props>();
const anki = ankiStore();
const isAnkiConfigured = computed(() => {
  const current = anki.ankiPreferences.settings.current;
  return current.deck !== null && current.model !== null && current.fields.length > 0;
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
  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="hs-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
        <UiBaseIcon :path="mdiFileDocumentPlusOutline" />
        {{ $t('searchpage.main.buttons.add') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <!-- Anki by last added -->
        <SearchDropdownItem :is-disabled="!isAnkiConfigured" :text="$t('searchpage.main.buttons.addToAnkiLast')"
          :iconPath="mdiStarShootingOutline" @click="ankiStore().addSentenceToAnki(content)" />

        <!-- Anki by ID -->
        <SearchDropdownItem :is-disabled="!isAnkiConfigured" :text="$t('searchpage.main.buttons.addToAnkiSearch')"
          @click="openAnkiModal()" :iconPath="mdiStarShootingOutline"
          data-hs-overlay="#hs-vertically-centered-scrollable-anki-collection" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="hs-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
        <UiBaseIcon :path="mdiTrayArrowDown" />
        {{ $t('searchpage.main.buttons.download') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.media_info.path_video, content.media_info.path_video.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.media_info.path_image, content.media_info.path_image.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
        <SearchDropdownItem
          @click="downloadAudioOrImage(content.media_info.path_audio, content.media_info.path_audio.split('/').pop()!)"
          :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
        <SearchDropdownItem
          v-if="content.media_info.blob_audio_url"
          @click="downloadAudioOrImage(content.media_info.blob_audio_url, 'expanded_'+content.media_info.path_audio.split('/').pop()!, true)"
          :text="$t('searchpage.main.buttons.dl-expanded')" :iconPath="mdiVolumeHigh" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="hs-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
        <UiBaseIcon :path="mdiContentCopy" />
        {{ $t('searchpage.main.buttons.copyclipboard') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <SearchDropdownItem @click="copyToClipboard(content.media_info.path_video)"
          :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
        <SearchDropdownItem @click="copyToClipboard(content.media_info.path_image)"
          :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
        <SearchDropdownItem @click="copyToClipboard(content.media_info.path_audio)"
          :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
        <div
          class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
        </div>
        <SearchDropdownItem @click="copyToClipboard(content.segment_info.content_jp)"
          :text="$t('searchpage.main.buttons.jpsentence')" :iconPath="mdiText" />
        <SearchDropdownItem @click="copyToClipboard(content.segment_info.content_en)"
          :text="$t('searchpage.main.buttons.ensentence')" :iconPath="mdiText" />
        <SearchDropdownItem @click="copyToClipboard(content.segment_info.content_es)"
          :text="$t('searchpage.main.buttons.essentence')" :iconPath="mdiText" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <UiButtonPrimaryAction data-hs-overlay="#hs-vertically-centered-scrollable-context" class="mr-2 text-xs py-2.5 px-3"
    @click="openContextModal">
    <UiBaseIcon :path="mdiPlusBoxOutline" />
    {{ $t('searchpage.main.buttons.context') }}
  </UiButtonPrimaryAction>

  <SearchDropdownContainer class="mr-2 my-1" dropdownId="hs-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
        <UiBaseIcon :path="mdiDotsHorizontal" />
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <SearchDropdownItem :text="$t('searchpage.main.buttons.share')" :iconPath="mdiShareVariantOutline"
          @click="getSharingURL(content.segment_info.uuid)" />
        <SearchDropdownItem v-if="content.media_info.blob_audio_url" :text="$t('segment.revert')" :iconPath="mdiClose"
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
