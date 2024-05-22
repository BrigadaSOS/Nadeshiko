<script setup>
import { mdiContentCopy, mdiPlusBoxOutline, mdiFileDocumentPlusOutline, mdiStarShootingOutline, mdiTrayArrowDown, mdiFileVideo, mdiDotsHorizontal   } from '@mdi/js'

</script>
<template>
    <SearchDropdownContainer class="mr-2" dropdownId="hs-dropdown-with-header">
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

    <SearchDropdownContainer class="mr-2" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiTrayArrowDown" />
                {{ $t('searchpage.main.buttons.download') }}
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent>
                <SearchDropdownItem :text="$t('searchpage.main.buttons.video')" :iconPath="mdiStarShootingOutline" />
                <SearchDropdownItem :text="$t('searchpage.main.buttons.image')" :iconPath="mdiStarShootingOutline" />
                <SearchDropdownItem :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiStarShootingOutline" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>

    <SearchDropdownContainer class="mr-2" dropdownId="hs-dropdown-with-header">
        <template #default>
            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
                <UiBaseIcon :path="mdiContentCopy" />
                {{ $t('searchpage.main.buttons.copyclipboard') }}
            </SearchDropdownMainButton>
        </template>
        <template #content>
            <SearchDropdownContent>
                <SearchDropdownItem :text="$t('searchpage.main.buttons.video')" :iconPath="mdiFileVideo" />
                <SearchDropdownItem :text="$t('searchpage.main.buttons.image')" :iconPath="mdiStarShootingOutline" />
                <SearchDropdownItem :text="$t('searchpage.main.buttons.jpsentence')"
                    :iconPath="mdiStarShootingOutline" />
                <SearchDropdownItem :text="$t('searchpage.main.buttons.ensentence')"
                    :iconPath="mdiStarShootingOutline" />
                <SearchDropdownItem :text="$t('searchpage.main.buttons.essentence')"
                    :iconPath="mdiStarShootingOutline" />
            </SearchDropdownContent>
        </template>
    </SearchDropdownContainer>

    <UiButtonPrimaryAction class="mr-2">
        <UiBaseIcon :path="mdiPlusBoxOutline" />
        {{ $t('searchpage.main.buttons.context') }}
    </UiButtonPrimaryAction>

    <SearchDropdownContainer class="mr-2" dropdownId="hs-dropdown-with-header">
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