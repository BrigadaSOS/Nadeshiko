<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import {
  mdiFileDocumentPlusOutline,
  // The two Anki entries shared `mdiStarShootingOutline` and so asked the reader
  // to tell two different targets apart by reading. Adding to a card keeps the
  // file-plus the word card and this menu's own button already use; the
  // magnifier is the card you go and find.
  mdiCardSearchOutline,
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
  mdiFormatListBulletedSquare,
} from '@mdi/js';

import { ankiStore } from '@/stores/anki';
import { userStore } from '@/stores/auth';
import type { CollectionOption } from '~/composables/useCollectionOptions';
import type { SearchResult } from '~/types/search';
import { firstNonBlank } from '~/utils/strings';
import { tokensToAnkiFurigana, type SlimToken } from '~/utils/tokenEnrichment';
import { useToastError, useToastSuccess } from '~/utils/toast';

const { englishMode, spanishMode } = useTranslationVisibility();
const { languages: translationLanguages } = useTranslationLanguages();

/**
 * Every action on this menu that a signed-out reader cannot take used to render
 * disabled with a "please log in" tooltip and no click handler -- a dead end at
 * the exact moment the reader had shown what they wanted the account for. They
 * now open the login modal, tagged with which one was pressed, which is what
 * makes "what makes people create an account" answerable at all.
 */
const { openLoginModal } = useLoginModal();

/**
 * The same offer, made a step earlier.
 *
 * Opening this menu signed out is a reader reaching for Anki, which is the
 * intent the download nudge was built around -- so it raises the same panel,
 * spends the same weekly cooldown, and is told apart from the download only in
 * PostHog and in the signup attribution. The greyed-out entries below still open
 * the login modal on their own when pressed; the panel just says why they are
 * grey without asking anyone to hover a tooltip to find out.
 */
const signupNudge = useSignupNudge();

type Props = {
  content: SearchResult;
  hideContextButton?: boolean;
  /**
   * True while any card's expansion is being built. The composable drops expand
   * clicks that land during one, so the controls have to say so -- unbound, a
   * click during the (multi-second) audio build looked like a dead button.
   */
  isExpanding?: boolean;
  /**
   * Whether THIS card is the one currently expanded, and so the one Revert
   * would undo.
   *
   * Gated on the expansion rather than on `blobAudioUrl`, which is what this
   * used to read. The two come apart in exactly the case that needs Revert
   * most: when the audio cannot be built the text is still swapped in and the
   * reader is told so -- and with the old gate that toast arrived on a card
   * with no way back to the sentence they searched for.
   */
  isExpanded?: boolean;
};

const props = defineProps<Props>();
const anki = ankiStore();
const user = userStore();
const sdk = useNadeshikoSdk();
const posthog = usePostHog();
const { t } = useI18n();
const router = useRouter();
const localePath = useLocalePath();
// Derived from the active profile rather than read once on mount, so changing
// Anki settings while a results page is open updates both menu items.
//
// Enough to write a note at all: which deck and note type to look in, and at
// least one field mapping to fill. The key field is NOT part of it -- see
// `pickerUnavailable` for the one export that does need it.
const isAnkiConfigured = computed(() => {
  const profile = anki.activeProfile;
  return !!profile?.deck?.trim() && !!profile.model?.trim() && profile.fields.length > 0;
});

/** The field naming the word a note is about. Optional in settings, and only
 *  the surfaces that SEARCH on it are entitled to require it. */
const hasKeyField = computed(() => !!anki.activeProfile?.key?.trim());

/**
 * Configured AND actually reachable. A profile can be perfectly filled in while
 * Anki is closed, and offering the export then sends the reader through a menu
 * to a toast that says it failed -- the same dead end the word card's control
 * used to have.
 *
 * `connectReachable === false` rather than a falsy check: `null` means nothing
 * has asked AnkiConnect this session, and disabling the export on that would
 * disable it for every reader who has not opened a word card yet.
 */
const ankiUnavailable = computed(() => !isAnkiConfigured.value || anki.connectReachable === false);

/**
 * The note picker asks Anki WHICH note is about a word, and the key field is the
 * field it searches -- so this one export needs it where the other does not.
 * "Add to last added card" targets `deck + note + added:2 is:new` and has never
 * consulted the key at all.
 */
const pickerUnavailable = computed(() => ankiUnavailable.value || !hasKeyField.value);

/**
 * Which problem it is, so the menu item can SAY -- "disabled" on its own is the
 * least useful thing a control can tell somebody.
 *
 * Ordered by what the reader has to fix first: no amount of running Anki helps a
 * profile with no note type, so configuration is reported ahead of reachability.
 * The picker's extra condition slots in with the other settings problem, ahead
 * of reachability for the same reason.
 */
const ankiBlockedMessage = computed(() => (isAnkiConfigured.value ? t('anki.notRunning') : t('anki.configRequired')));
const pickerBlockedMessage = computed(() => {
  if (!isAnkiConfigured.value) return t('anki.configRequired');
  if (!hasKeyField.value) return t('anki.keyFieldRequired');
  return t('anki.notRunning');
});
const addingCollectionId = ref<string | null>(null);
const showCollectionPicker = ref(false);

// Shared with every other result card on the page: the list belongs to the
// reader, not to this card. See `useCollectionOptions`.
const {
  collections,
  loading: collectionsLoading,
  loaded: collectionsLoaded,
  lastCollection,
  load: loadCollections,
  rememberLast: saveLastCollection,
  restoreLastCollection,
} = useCollectionOptions();

/**
 * Both halves of pressing Add: the signed-in reader's collection list, and the
 * signed-out reader's nudge. Each is a no-op for the other -- `load` returns
 * early when signed out, and `nudgeOnAddMenu` when signed in -- so the button
 * does not have to know which reader it has.
 */
function openAddMenu() {
  loadCollections();
  signupNudge.nudgeOnAddMenu();
}

onMounted(() => {
  restoreLastCollection();
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
  posthog?.capture('segment_expanded', {
    direction,
    media_id: props.content.media.publicId,
  });
};

const revertConcat = () => {
  emit('revert-concat', props.content);
};

const openContextModal = () => {
  emit('open-context-modal', props.content);
  posthog?.capture('context_viewed', {
    media_id: props.content.media.publicId,
    segment_id: props.content.segment.publicId,
  });
};

const openAnkiModal = () => {
  emit('open-anki-modal');
};

const openAnkiSettings = () => {
  void router.push(localePath('/user/sync'));
};

const addToCollection = async (collection: CollectionOption, isQuickAdd = false) => {
  if (addingCollectionId.value !== null) return;

  addingCollectionId.value = collection.id;
  try {
    await sdk.addSegmentToCollection({
      collectionPublicId: collection.id,
      segmentPublicId: props.content.segment.publicId,
    });
    posthog?.capture('segment_added_to_collection', {
      collection_name: collection.name,
      is_quick_add: isQuickAdd,
    });
    useToastSuccess(t('searchpage.main.labels.collectionAdded', { name: collection.name }));
    saveLastCollection(collection);
  } catch (error) {
    handleApiError('collections:add-segment-failed', error, {
      toastKey: 'searchpage.main.labels.collectionAddFailed',
      context: { 'segment.publicId': props.content.segment.publicId },
    });
  } finally {
    addingCollectionId.value = null;
  }
};

const quickAddToLastCollection = async () => {
  if (!lastCollection.value) return;
  await addToCollection(lastCollection.value, true);
};

const openCollectionsPage = async () => {
  await router.push(localePath('/user/collections'));
};

const jaTokens = computed<SlimToken[] | null>(() => {
  const tokens = (props.content.segment.textJa as { tokens?: SlimToken[] }).tokens;
  return tokens && tokens.length > 0 ? tokens : null;
});

const copyFurigana = () => {
  const tokens = jaTokens.value;
  if (!tokens) return;
  copyToClipboard(tokensToAnkiFurigana(props.content.segment.textJa.content, tokens));
};

/**
 * Romaji first, as the share event has always used, but falling through the other
 * names: media with no romaji title used to share an empty name, which the
 * activity API stored and then choked on when reading the timeline back.
 */
const sharedMediaName = computed(() =>
  firstNonBlank(props.content.media.nameRomaji, props.content.media.nameEn, props.content.media.nameJa),
);
</script>
<template>
  <SearchDropdownContainer data-testid="save-dropdown" class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header" teleport>
    <template #default>
      <SearchDropdownMainButton segment-hover-border dropdownId="nd-dropdown-with-header" @click="openAddMenu">
        <UiBaseIcon :path="mdiFileDocumentPlusOutline" />
        <span class="hidden min-[1250px]:inline">{{ $t('searchpage.main.buttons.add') }}</span>
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('searchpage.main.buttons.add')">
        <!-- Anki by last added -->
        <ClientOnly>
          <template v-if="user.isLoggedIn">
            <SearchDropdownItem :is-disabled="ankiUnavailable" :text="$t('searchpage.main.buttons.addToAnkiLast')"
              :iconPath="mdiFileDocumentPlusOutline"
              :tooltip="ankiUnavailable ? ankiBlockedMessage : undefined"
              :on-disabled-click="ankiUnavailable ? openAnkiSettings : undefined"
              @click="anki.addSentenceToAnki(content)" />

            <!-- Anki by ID. Gated more tightly than the item above: this one
                 searches the key field, so a profile without one cannot offer it
                 even though it can export perfectly well. -->
            <SearchDropdownItem :is-disabled="pickerUnavailable" :text="$t('searchpage.main.buttons.addToAnkiSearch')"
              @click="openAnkiModal()" :iconPath="mdiCardSearchOutline"
              :tooltip="pickerUnavailable ? pickerBlockedMessage : undefined"
              :on-disabled-click="pickerUnavailable ? openAnkiSettings : undefined" />
          </template>
          <template v-else>
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.addToAnkiLast')"
              :iconPath="mdiFileDocumentPlusOutline" :tooltip="$t('reports.loginRequired')"
              :on-disabled-click="() => openLoginModal('anki_add_last')" />
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.addToAnkiSearch')"
              :iconPath="mdiCardSearchOutline" :tooltip="$t('reports.loginRequired')"
              :on-disabled-click="() => openLoginModal('anki_add_search')" />
          </template>
          <template #fallback>
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.addToAnkiLast')"
              :iconPath="mdiFileDocumentPlusOutline" />
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.addToAnkiSearch')"
              :iconPath="mdiCardSearchOutline" />
          </template>
        </ClientOnly>

        <template v-if="user.isLoggedIn">
          <div class="nd-menu-divider" />

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
          <div v-else data-nd-keep-open>
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
          </div>
          <SearchDropdownItem
            :text="$t('searchpage.main.buttons.manageCollections')"
            :iconPath="mdiFormatListBulletedSquare"
            @click="openCollectionsPage"
          />
        </template>
        <template v-else>
          <div class="hidden min-[1250px]:block">
            <div class="nd-menu-divider" />
            <SearchDropdownItem :is-disabled="true" :text="$t('searchpage.main.buttons.chooseCollection')"
              :iconPath="mdiFormatListBulletedSquare" :tooltip="$t('reports.loginRequired')"
              :on-disabled-click="() => openLoginModal('collection_choose')" />
          </div>
        </template>
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <SearchDropdownContainer data-testid="download-dropdown" class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header" teleport>
    <template #default>
      <SearchDropdownMainButton segment-hover-border dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiTrayArrowDown" />
        <span class="hidden min-[1250px]:inline">{{ $t('searchpage.main.buttons.download') }}</span>
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

  <SearchDropdownContainer data-testid="copy-dropdown" class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-with-header" teleport>
    <template #default>
      <SearchDropdownMainButton segment-hover-border dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiContentCopy" />
        <span class="hidden min-[1250px]:inline">{{ $t('searchpage.main.buttons.copyclipboard') }}</span>
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
        <div class="nd-menu-divider" />
        <SearchDropdownItem @click="copyToClipboard(content.segment.textJa.content)"
          :text="$t('searchpage.main.buttons.jpsentence')" :iconPath="mdiText" />
        <SearchDropdownItem v-if="jaTokens" @click="copyFurigana()"
          :text="$t('searchpage.main.buttons.jpsentencefurigana')" :iconPath="mdiText" />
        <SearchDropdownItem v-if="translationLanguages.includes('EN') && englishMode !== 'hidden'" @click="copyToClipboard(content.segment.textEn.content)"
          :text="$t('searchpage.main.buttons.ensentence')" :iconPath="mdiText" />
        <SearchDropdownItem v-if="translationLanguages.includes('ES') && spanishMode !== 'hidden'" @click="copyToClipboard(content.segment.textEs.content)"
          :text="$t('searchpage.main.buttons.essentence')" :iconPath="mdiText" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

  <UiButtonPrimaryAction v-if="!hideContextButton" segment-hover-border class="mr-2 text-xs py-2.5 px-3"
    @click="openContextModal">
    <UiBaseIcon :path="mdiPlusBoxOutline" />
    <span class="hidden min-[1250px]:inline">{{ $t('searchpage.main.buttons.context') }}</span>
  </UiButtonPrimaryAction>

  <UiButtonPrimaryAction
    segment-hover-border
    data-testid="share-button"
    class="mr-2 text-xs py-2.5 px-3"
    :title="$t('searchpage.main.buttons.share')"
    @click="getSharingURL({ segmentPublicId: content.segment.publicId, mediaPublicId: content.media.publicId, mediaName: sharedMediaName, japaneseText: content.segment.textJa.content })"
  >
    <UiBaseIcon :path="mdiShareVariantOutline" />
  </UiButtonPrimaryAction>

  <SearchDropdownContainer data-testid="more-dropdown" class="mr-2 my-1" dropdownId="nd-dropdown-with-header"
    teleport teleportAlign="end"
    dropdownContainerClass="z-50 min-w-60">
    <template #default>
      <SearchDropdownMainButton segment-hover-border dropdownId="nd-dropdown-with-header">
        <UiBaseIcon :path="mdiDotsHorizontal" />
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('searchpage.main.buttons.more')">
        <SearchDropdownItem v-if="isExpanded" :is-disabled="isExpanding" :text="$t('segment.revert')"
          :iconPath="mdiClose" @click="revertConcat" />
        <SearchDropdownItem :is-disabled="isExpanding"
          :text="isExpanding ? $t('segment.expanding') : $t('searchpage.main.buttons.expandLeft')"
          :iconPath="mdiTransferLeft" @click="concatSentence('backward')" />
        <SearchDropdownItem :is-disabled="isExpanding"
          :text="isExpanding ? $t('segment.expanding') : $t('searchpage.main.buttons.expandBoth')"
          :iconPath="mdiArrowExpandHorizontal" @click="concatSentence('both')" />
        <SearchDropdownItem :is-disabled="isExpanding"
          :text="isExpanding ? $t('segment.expanding') : $t('searchpage.main.buttons.expandRight')"
          :iconPath="mdiTransferRight" @click="concatSentence('forward')" />
        <div :class="{ 'hidden min-[1250px]:block': !user.isLoggedIn }">
          <div class="nd-menu-divider" />
          <SearchDropdownItem :text="$t('reports.reportSegment')" :iconPath="mdiFlagOutline"
            :isDisabled="!user.isLoggedIn"
            :tooltip="!user.isLoggedIn ? $t('reports.loginRequired') : undefined"
            :on-disabled-click="!user.isLoggedIn ? () => openLoginModal('report_segment') : undefined"
            @click="emit('open-report-modal', content)" />
        </div>
        <template v-if="user.isAdmin">
          <div class="nd-menu-divider" />
          <SearchDropdownItem :text="$t('modalSegmentEdit.editButton')" :iconPath="mdiPencilOutline"
            @click="emit('open-edit-modal', content)" />
        </template>
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>

</template>
