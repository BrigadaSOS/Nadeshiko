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
import { DROPDOWN_MARGIN, placeDropdownMenu, type DropdownAlign } from '~/utils/dropdownPlacement';

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
  const vp = viewport();
  const pos = placeDropdownMenu(trigger, menuSize, vp, props.teleportAlign);
  // The cap is what makes the placement stable. A fixed element with only
  // `left` set shrinks to fit the space left of the viewport edge, so the menu
  // measured at one position and then moved has room to grow at the new one --
  // it was clamped using a 240px measurement, re-laid out where 248px was
  // available, and took all of it, landing flush against the edge with the
  // margin the clamp had just reserved. Capping the width at the placement
  // removes the second lay-out, and makes overflow impossible whatever the
  // content does.
  placedStyle.value = {
    position: 'fixed',
    top: `${pos.top}px`,
    left: `${pos.left}px`,
    maxWidth: `${Math.max(0, vp.width - pos.left - DROPDOWN_MARGIN)}px`,
    // Above every modal, because teleporting takes the menu out of the one it
    // was opened from. Inside a dialog the class's `z-50` used to sit in that
    // dialog's own stacking context and simply worked; against `body` it lands
    // under the `z-[60]`-`z-[80]` a modal draws at, and the menu opens
    // invisibly behind it -- which is what the context view showed. Below the
    // skip link at 100, which has to stay reachable over anything.
    zIndex: '90',
  };
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

/**
 * Inside or outside is decided on the event's own path, not on where the
 * clicked node sits by the time this runs.
 *
 * A menu item that re-renders its OWN menu is unmounted before the click
 * reaches `document`: the microtask checkpoint between listeners flushes Vue's
 * patch while the event is still bubbling. `contains` then answers false for a
 * click that was unmistakably inside, and the menu dismisses itself on the way
 * in -- which is what closed the Anki field menu the moment a reader drilled
 * into the dictionary list, the one item whose whole job is to replace the list
 * around it.
 *
 * `composedPath` is snapshotted when the event is dispatched, so it still names
 * the menu the click started in. The `contains` check stays as the fallback for
 * a synthetic event with no path.
 */
const onDocumentClick = (event: MouseEvent) => {
  const root = rootRef.value;
  const menu = menuRef.value;
  const path = event.composedPath();

  if (path.length > 0) {
    if ((root && path.includes(root)) || (menu && path.includes(menu))) return;
  } else {
    const target = event.target as Node | null;
    if (target && (root?.contains(target) || menu?.contains(target))) return;
  }

  close();
};

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  close();
};

/**
 * A teleported menu is placed against the viewport, so it stops matching its
 * trigger the moment the page moves under it -- closing is the honest response.
 *
 * Its OWN scrolling is not that. A menu with a scrolling body (the hidden-results
 * breakdown caps at `max-h-64`) raises scroll events like anything else, and this
 * listener is on `window` in the capture phase, so it sees them: the reader
 * reached for the list and the list vanished. The menu has not moved relative to
 * anything, so there is nothing to close for.
 */
const onWindowScroll = (event: Event) => {
  if (!props.teleport) return;
  const target = event.target;
  if (target instanceof Node && menuRef.value?.contains(target)) return;
  close();
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
