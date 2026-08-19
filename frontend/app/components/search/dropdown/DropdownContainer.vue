<template>
    <div ref="rootRef" data-testid="dropdown" :class="rootClass">
        <slot :is-open="isOpen" :toggle="toggle" :close="close" :dropdown-id="resolvedDropdownId"></slot>
        <!--
            `v-if`, NOT `v-show`, and on the busiest page that difference is most
            of the document.

            `useDropdownState` holds a single `openDropdownId`, so at most ONE
            dropdown on the page is ever open -- but under `v-show` every other
            menu is still built, styled and kept in the DOM, merely hidden. A word
            page renders four of these per sentence card across thirty cards: 123
            menus, ~28 elements each, 3,476 elements. That was 46% of the entire
            served document existing for UI nobody had opened, and it is paid on
            every style recalculation and every interaction, not just on load.

            `<Transition>` is built to pair with `v-if`, so the open and close
            animations are unchanged; the cost moves to mounting ~28 elements on
            click, which is imperceptible. Nothing depends on the menu existing
            while closed: no `aria-controls` points at it (`aria-labelledby` runs
            the other way, from menu to toggle), the slot contents are
            presentational, and the e2e specs that click items inside a menu open
            the toggle first.
        -->
        <Teleport to="body" :disabled="!teleport">
            <Transition name="nd-dropdown">
                <div
                    v-if="isOpen"
                    ref="menuRef"
                    data-testid="dropdown-menu"
                    :class="['nd-menu', dropdownContainerClass]"
                    :style="resolvedMenuStyle"
                    :aria-labelledby="resolvedDropdownId"
                    @click="onMenuClick"
                >
                    <slot name="content"></slot>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, provide, useId, type StyleValue } from 'vue';
import {
  DROPDOWN_INJECTION_KEY,
  NESTED_IN_TOKEN_TOOLTIP_KEY,
  type DropdownContext,
} from '~/composables/useDropdownState';
import { placeDropdownMenu, type DropdownAlign } from '~/utils/dropdownPlacement';

const props = withDefaults(
  defineProps<{
    dropdownId?: string;
    dropdownContainerClass?: string;
    /** Root element classes. The default is a shrink-to-trigger inline box; pass
     *  e.g. a full-width bordered box to make the whole control the trigger and
     *  anchor the menu (`inset-x-0`) to it rather than to a corner of it. */
    rootClass?: string;
    /** Render the menu on `body` so sticky/overflow ancestors cannot clip it. */
    teleport?: boolean;
    /** Horizontal edge of the trigger the teleported menu lines up with. */
    teleportAlign?: DropdownAlign;
    menuStyle?: StyleValue;
  }>(),
  {
    dropdownId: 'nd-dropdown',
    dropdownContainerClass: 'absolute top-full z-50 min-w-60 mt-1',
    rootClass: 'relative inline-flex',
    teleport: false,
    teleportAlign: 'start',
    menuStyle: undefined,
  },
);

const dropdownUid = useId();
const resolvedDropdownId = computed(
  () => `${(props.dropdownId || 'nd-dropdown').trim() || 'nd-dropdown'}-${dropdownUid}`,
);

const rootRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const { openDropdownId, openDropdown, closeDropdown } = useDropdownState();
const nestedInTokenTooltip = inject(NESTED_IN_TOKEN_TOOLTIP_KEY, false);

const isOpen = computed(() => openDropdownId.value === resolvedDropdownId.value);

const placedStyle = ref<Record<string, string>>({});
const resolvedMenuStyle = computed<StyleValue | undefined>(() => {
  if (!props.teleport) return props.menuStyle;
  return { ...placedStyle.value, ...(isRecord(props.menuStyle) ? props.menuStyle : {}) };
});

const isRecord = (value: StyleValue | undefined): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

const placeMenu = (menuSize: { width: number; height: number }) => {
  const trigger = rootRef.value?.getBoundingClientRect();
  if (!trigger) return;
  const pos = placeDropdownMenu(trigger, menuSize, viewport(), props.teleportAlign);
  placedStyle.value = { position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px` };
};

const close = () => closeDropdown(resolvedDropdownId.value);
const toggle = () => {
  if (isOpen.value) {
    close();
    return;
  }
  // Pin before the menu mounts so a teleported panel does not flash at 0,0.
  if (props.teleport) placeMenu({ width: 176, height: 0 });
  openDropdown(resolvedDropdownId.value, { preserveTokenTooltip: nestedInTokenTooltip });
};

// Mirrors the old plugin: any link or button inside the menu dismisses it,
// unless it sits under [data-nd-keep-open].
const onMenuClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('a, button')) return;
  if (target.closest('[data-nd-keep-open]')) return;
  close();
};

const onDocumentClick = (event: MouseEvent) => {
  const target = event.target as Node | null;
  if (target && (rootRef.value?.contains(target) || menuRef.value?.contains(target))) return;
  close();
};

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  close();
};

const onWindowScroll = () => {
  if (props.teleport) close();
};

watch(isOpen, async (open) => {
  if (!import.meta.client) return;
  if (open) {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    if (props.teleport) {
      window.addEventListener('scroll', onWindowScroll, true);
      await nextTick();
      const box = menuRef.value?.getBoundingClientRect();
      if (box) placeMenu({ width: box.width, height: box.height });
    }
  } else {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
    window.removeEventListener('scroll', onWindowScroll, true);
  }
});

onBeforeUnmount(() => {
  if (!import.meta.client) return;
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('scroll', onWindowScroll, true);
  close();
});

const route = useRoute();
watch(() => route.fullPath, close);

provide('ndDropdownResolvedId', resolvedDropdownId);
provide<DropdownContext>(DROPDOWN_INJECTION_KEY, {
  id: resolvedDropdownId,
  isOpen,
  toggle,
  close,
});
</script>
