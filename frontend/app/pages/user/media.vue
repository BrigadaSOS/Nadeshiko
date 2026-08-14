<script setup lang="ts">
import HiddenCategorySettings from '~/components/user/HiddenCategorySettings.vue';
import ManageMediaSettings from '~/components/user/ManageMediaSettings.vue';
</script>

<!--
  One tab for every "which titles do I want to see" setting, rather than the two
  it used to take. Favoriting and hiding are the same decision with opposite
  signs and they act on the same list -- the media filter on the search page --
  so splitting them across two tabs meant a reader tuning that list had to know
  in advance which half of it their answer lived in.

  They are now also one card: the lookup, the favorites and the hidden titles
  were three stacked panels, which pushed the hidden list far enough down the
  page to read as a separate concern. Categories keep their own card -- that is
  a different axis, and it is not a per-title decision.
-->
<template>
  <ManageMediaSettings />
  <HiddenCategorySettings />
</template>
