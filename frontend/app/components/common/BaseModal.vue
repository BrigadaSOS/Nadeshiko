<script setup lang="ts">
import type { ClassValue, StyleValue } from 'vue';

/** Callers own panel markup; this shell owns dismissal, scroll lock and focus trapping/restoration. */
const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Classes for the full-screen overlay (alignment, padding, backdrop). */
    overlayClass?: ClassValue;
    /** Classes for the dialog panel itself. */
    panelClass?: ClassValue;
    panelStyle?: StyleValue;
    /** Transition name; `nd-drawer` slides the panel in from the end edge. */
    transition?: string;
    /** Animate the first render. Callers restoring an already-open panel can opt out. */
    appear?: boolean;
    label?: string;
    labelledby?: string;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    zIndexClass?: string;
  }>(),
  {
    overlayClass: 'items-center justify-center bg-neutral-900/60',
    panelClass: '',
    panelStyle: undefined,
    transition: 'nd-modal',
    appear: true,
    label: undefined,
    labelledby: undefined,
    closeOnBackdrop: true,
    closeOnEscape: true,
    zIndexClass: 'z-[60]',
  },
);

const emit = defineEmits<{ close: [] }>();

// Fallthrough attrs (data-testid, id, …) belong on the dialog panel, not on
// the Teleport wrapper.
defineOptions({ inheritAttrs: false });

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const modalId = useId();
const dialogRef = ref<HTMLElement | null>(null);
const { registerModal, unregisterModal, isTopModal } = useModalState();
const { openDropdownId, isTokenTooltipOpen, dismissAllOverlays } = useDropdownState();

let previouslyFocused: HTMLElement | null = null;

const focusableElements = () => {
  const dialog = dialogRef.value;
  if (!dialog) return [] as HTMLElement[];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
};

const focusInitial = () => {
  const dialog = dialogRef.value;
  if (!dialog) return;
  const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
  (preferred ?? dialog).focus({ preventScroll: true });
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (!props.closeOnEscape || !isTopModal(modalId)) return;
    // A dropdown or word card is "inside" this modal — let Escape dismiss that first.
    if (openDropdownId.value || isTokenTooltipOpen.value) return;
    event.preventDefault();
    event.stopPropagation();
    emit('close');
    return;
  }

  if (event.key !== 'Tab' || !isTopModal(modalId)) return;

  const focusable = focusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    dialogRef.value?.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  const active = document.activeElement as HTMLElement | null;
  const insideDialog = !!active && !!dialogRef.value?.contains(active);

  if (event.shiftKey && (!insideDialog || active === first)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (!insideDialog || active === last)) {
    event.preventDefault();
    first?.focus();
  }
};

const activate = async () => {
  previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;
  // A leftover menu or word card would sit above this dialog (the card is
  // z-70, most modals are z-60) and keep taking clicks. Keyboard openers
  // (`?`, A, C) never produce the outside click that would have dismissed
  // them, so the modal has to do it.
  dismissAllOverlays();
  registerModal(modalId);
  document.addEventListener('keydown', onKeydown, true);
  await nextTick();
  focusInitial();
};

const deactivate = () => {
  unregisterModal(modalId);
  document.removeEventListener('keydown', onKeydown, true);
  // The opener can be gone by now (e.g. a drawer that closed itself to open
  // this modal); focusing a detached node would be a silent no-op anyway.
  if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
  previouslyFocused = null;
};

/** Closed modals omit the Teleport: Vue teardown can otherwise remove child vnodes that were never mounted. */
const isRendered = ref(props.open);

/** Holds the teleport open for the leave transition, which removing it on `open`
 * flipping false would otherwise cut short. */
const onAfterLeave = () => {
  // A reopen during the leave must win, or the panel would vanish mid-transition.
  if (!props.open) isRendered.value = false;
};

watch(
  () => props.open,
  (open) => {
    if (open) isRendered.value = true;
    if (!import.meta.client) return;
    if (open) activate();
    else deactivate();
  },
);

onMounted(() => {
  if (props.open) activate();
});

onBeforeUnmount(() => {
  if (props.open) deactivate();
});

const onBackdropClick = () => {
  if (props.closeOnBackdrop) emit('close');
};

/** Expose a separate -backdrop test id; fallthrough attrs identify the panel, not the dismiss target. */
const attrs = useAttrs();
const backdropTestId = computed(() => {
  const id = attrs['data-testid'];
  return typeof id === 'string' && id ? `${id}-backdrop` : undefined;
});

/** Drawer panels slide independently of a fading sibling scrim; fading their wrapper would ghost the sheet. */
const isDrawer = computed(() => props.transition === 'nd-drawer');
</script>

<template>
  <Teleport v-if="isRendered" to="body">
    <!-- `appear` is load-bearing. The teleport is mounted only while a close
         animation still needs it, so every open is this Transition's first
         paint. Without appear, Vue skips enter and the panel pops in. -->
    <template v-if="isDrawer">
      <div class="contents" :class="overlayClass">
        <Transition name="nd-drawer-backdrop" :appear="appear">
          <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop; Escape and the close button are the keyboard path -->
          <div
            v-if="open"
            :data-testid="backdropTestId"
            class="nd-drawer-backdrop"
            :class="zIndexClass"
            @click="onBackdropClick"
          />
        </Transition>
        <Transition name="nd-drawer" :appear="appear" @after-leave="onAfterLeave">
          <div
            v-if="open"
            ref="dialogRef"
            v-bind="$attrs"
            class="nd-modal-panel nd-drawer-panel"
            :class="[zIndexClass, panelClass]"
            :style="panelStyle"
            role="dialog"
            aria-modal="true"
            :aria-label="label"
            :aria-labelledby="labelledby"
            tabindex="-1"
          >
            <slot />
          </div>
        </Transition>
      </div>
    </template>
    <Transition v-else :name="transition" :appear="appear" @after-leave="onAfterLeave">
      <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop; Escape and the close button are the keyboard path -->
      <div
        v-if="open"
        :data-testid="backdropTestId"
        class="nd-modal fixed inset-0 flex w-full h-full overflow-x-hidden overflow-y-auto"
        :class="[zIndexClass, overlayClass]"
        @click.self="onBackdropClick"
      >
        <div
          ref="dialogRef"
          v-bind="$attrs"
          class="nd-modal-panel"
          :class="panelClass"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          :aria-labelledby="labelledby"
          tabindex="-1"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
