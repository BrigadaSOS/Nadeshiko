<script setup lang="ts">
import type { ClassValue, StyleValue } from 'vue';

/**
 * Modal shell: teleported to <body>, mounted only while `open`, and
 * responsible for the behaviour every dialog needs — backdrop click, Escape,
 * scroll lock, focus trap and focus restore.
 *
 * Callers own the panel markup; `panelClass`/`panelStyle` style the element
 * that carries `role="dialog"`.
 */
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
const { openDropdownId } = useDropdownState();

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
    // An open dropdown is "inside" this modal — let Escape dismiss that first.
    if (openDropdownId.value) return;
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

/**
 * Whether the `<Teleport>` itself is in the tree, as opposed to whether the panel
 * inside it is visible.
 *
 * Vue's `TeleportImpl.remove` walks its children unconditionally when the teleport
 * unmounts, so a teleport that is always present — on pages carrying four to eight
 * modals, all closed — hands `unmountComponent` a child vnode that was never
 * mounted whenever the page tears down mid-render, and it crashes destructuring a
 * null instance. A closed modal has nothing to teleport, so the cheapest fix is to
 * not be in the tree at all.
 */
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
</script>

<template>
  <Teleport v-if="isRendered" to="body">
    <Transition :name="transition" @after-leave="onAfterLeave">
      <div
        v-if="open"
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
