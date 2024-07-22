<script setup>
import { mdiText, mdiImage, mdiVideo, mdiContentCopy, mdiPlusBoxOutline, mdiFileDocumentPlusOutline, mdiStarShootingOutline, mdiTrayArrowDown, mdiFileVideo, mdiDotsHorizontal, mdiVolumeHigh   } from '@mdi/js'

let props = defineProps({
    content: {
        type: Object,
        required: true,
    }
});

const emit = defineEmits(['open-context-modal']);

const openContextModal = () => {
    emit('open-context-modal', props.content);
};

</script>
<template>
    <SearchDropdownContainer class="mr-2 my-1" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiFileDocumentPlusOutline" />
                {{ $t('searchpage.main.buttons.add') }}
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent>
                <SearchDropdownItem text="Añadir a Anki (Guardado Rápido)" :iconPath="mdiStarShootingOutline" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>

    <SearchDropdownContainer class="mr-2 my-1" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiTrayArrowDown" />
                {{ $t('searchpage.main.buttons.download') }}
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent>
                <SearchDropdownItem @click="downloadAudioOrImage(content.media_info.path_video,content.media_info.path_video.split('/').pop())" :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
                <SearchDropdownItem @click="downloadAudioOrImage(content.media_info.path_image,content.media_info.path_image.split('/').pop())" :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
                <SearchDropdownItem @click="downloadAudioOrImage(content.media_info.path_audio,content.media_info.path_audio.split('/').pop())" :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>

    <SearchDropdownContainer class="mr-2 my-1" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiContentCopy" />
                {{ $t('searchpage.main.buttons.copyclipboard') }}
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent>
                <SearchDropdownItem @click="copyToClipboard(content.media_info.path_video)" :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
                <SearchDropdownItem @click="copyToClipboard(content.media_info.path_image)" :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
                <SearchDropdownItem @click="copyToClipboard(content.media_info.path_audio)" :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
                <div class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600"></div>
                <SearchDropdownItem @click="copyToClipboard(content.segment_info.content_jp)" :text="$t('searchpage.main.buttons.jpsentence')"
                    :iconPath="mdiText" />
                <SearchDropdownItem @click="copyToClipboard(content.segment_info.content_en)" :text="$t('searchpage.main.buttons.ensentence')"
                    :iconPath="mdiText" />
                <SearchDropdownItem @click="copyToClipboard(content.segment_info.content_es)" :text="$t('searchpage.main.buttons.essentence')"
                    :iconPath="mdiText" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>

    <UiButtonPrimaryAction data-hs-overlay="#hs-vertically-centered-scrollable-context" class="mr-2 my-1" @click="openContextModal">
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
                <SearchDropdownItem :text="$t('searchpage.main.buttons.video')" :iconPath="mdiFileVideo" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>

</template>