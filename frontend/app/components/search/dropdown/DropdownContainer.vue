<template>
    <div ref="rootRef" data-testid="dropdown" :class="rootClass">
        <slot :is-open="isOpen" :toggle="toggle" :close="close" :dropdown-id="resolvedDropdownId"></slot>
        <!-- Mount only open menus: hidden menus previously made up 46% of the served word-page DOM. No
             aria-controls requires closed content; Transition supports v-if.
             -->
        <Teleport to="body" :disabled="!teleport">
            <Transition name="nd-dropdown">
                <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: closes the menu after a child item is picked -->
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
const route = useRoute();

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
  // Cap width after positioning: shrink-to-fit can otherwise grow at the new location and undo the viewport
  // clamp.
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

/**
 * A link to the route already on screen is an interaction with the open menu,
 * not navigation away from it. Keep the dropdown active in that case; links to
 * another page still dismiss, as do action buttons (including every ellipsis
 * menu item).
 */
const isCurrentPageLink = (link: HTMLAnchorElement): boolean => {
  const href = link.getAttribute('href');
  if (!href) return false;

  try {
    const current = new URL(route.fullPath, 'https://nadeshiko.invalid');
    const destination = new URL(href, current);
    return (
      destination.origin === current.origin &&
      destination.pathname === current.pathname &&
      destination.search === current.search
    );
  } catch {
    return false;
  }
};

// Links that navigate and action buttons dismiss the menu unless their control
// explicitly opts into a multi-step interaction with [data-nd-keep-open].
const onMenuClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  const control = target?.closest('a, button');
  if (!control) return;
  if (target?.closest('[data-nd-keep-open]')) return;
  if (control instanceof HTMLAnchorElement && isCurrentPageLink(control)) return;
  close();
};

/** Use the snapshotted composedPath: Vue may replace an item before this document listener runs, making
 * contains incorrectly report an inside click as outside. Keep contains as the synthetic-event fallback.
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

/** Page scrolling invalidates viewport placement for teleported menus. Ignore scrolling within the menu itself. */
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

watch(() => route.fullPath, close);

provide('ndDropdownResolvedId', resolvedDropdownId);
provide<DropdownContext>(DROPDOWN_INJECTION_KEY, {
  id: resolvedDropdownId,
  isOpen,
  toggle,
  close,
});
</script>
