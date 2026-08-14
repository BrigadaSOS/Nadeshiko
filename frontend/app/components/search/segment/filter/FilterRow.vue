<script setup lang="ts">
/**
 * One row of a sidebar filter list: a label, its hit count, and room after it
 * for a secondary control (the favourite star). Shared by the media titles and
 * the episodes so both levels of the drill-down are the same object.
 *
 * The row stays an `<li>` under the panel's `<ul>`: `e2e/specs/favorite-media.spec.ts`
 * walks the list structurally, and it is the correct markup regardless.
 */
withDefaults(
  defineProps<{
    label: string;
    count: number;
    selected?: boolean;
    /** Kept on one line and truncated; titles wrap to two lines instead. */
    truncate?: boolean;
    title?: string;
    /**
     * Stamped on the row so the panel can find it again after the list is
     * replaced -- coming back out of a title's episodes puts the keyboard back
     * on the title it came from.
     */
    rowId?: string | null;
  }>(),
  { selected: false, truncate: false, title: undefined, rowId: null },
);

defineEmits<{ select: [] }>();
</script>

<template>
  <li data-testid="media-filter-row" :data-row-id="rowId ?? undefined">
    <div
      :class="{ 'bg-sgrayhover': selected }"
      class="flex border duration-300 items-center w-full hover:bg-sgrayhover text-xs xxl:text-base xxm:text-2xl text-left dark:border-white/5">
      <button
        type="button"
        :title="title"
        @click="$emit('select')"
        class="flex flex-1 min-w-0 items-center justify-between px-4 py-2 text-left">
        <span class="flex-1 min-w-0 pr-2" :class="truncate ? 'truncate' : 'line-clamp-2 break-words'">
          {{ label }}
        </span>
        <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs shrink-0">
          {{ count }}
        </span>
      </button>
      <!-- A sibling of the filter button, not a child: a button inside a button
           is invalid, and nesting one breaks hydration. -->
      <slot name="trailing" />
    </div>
  </li>
</template>
