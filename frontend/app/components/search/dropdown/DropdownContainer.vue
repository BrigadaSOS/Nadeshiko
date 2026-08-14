<template>
    <div ref="rootRef" data-testid="dropdown" class="relative inline-flex">
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
        <Transition name="nd-dropdown">
            <div
                v-if="isOpen"
                data-testid="dropdown-menu"
                :class="dropdownContainerClass"
                :aria-labelledby="resolvedDropdownId"
                @click="onMenuClick"
            >
                <slot name="content"></slot>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { computed, provide, useId } from 'vue';
import { DROPDOWN_INJECTION_KEY, type DropdownContext } from '~/composables/useDropdownState';

const props = withDefaults(
  defineProps<{
    dropdownId?: string;
    dropdownContainerClass?: string;
  }>(),
  {
    dropdownId: 'nd-dropdown',
    dropdownContainerClass:
      'absolute top-full z-50 items-center text-center align-middle min-w-60 bg-white shadow-md p-2 mt-1 dark:bg-neutral-800 border-none rounded-lg',
  },
);

const dropdownUid = useId();
const resolvedDropdownId = computed(
  () => `${(props.dropdownId || 'nd-dropdown').trim() || 'nd-dropdown'}-${dropdownUid}`,
);

const rootRef = ref<HTMLElement | null>(null);
const { openDropdownId, openDropdown, closeDropdown } = useDropdownState();

const isOpen = computed(() => openDropdownId.value === resolvedDropdownId.value);

const close = () => closeDropdown(resolvedDropdownId.value);
const toggle = () => {
  if (isOpen.value) close();
  else openDropdown(resolvedDropdownId.value);
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
  if (target && rootRef.value?.contains(target)) return;
  close();
};

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  close();
};

watch(isOpen, (open) => {
  if (!import.meta.client) return;
  if (open) {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
  } else {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
  }
});

onBeforeUnmount(() => {
  if (!import.meta.client) return;
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
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
