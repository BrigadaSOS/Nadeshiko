<script setup lang="ts">
import HiddenCategorySettings from '~/components/user/HiddenCategorySettings.vue';
import ManageMediaSettings from '~/components/user/ManageMediaSettings.vue';
</script>

<!-- Favoriting and hiding tune the same title list, so they share one card.
     Category hiding is a separate axis and keeps its own card. -->
<template>
  <ManageMediaSettings />
  <HiddenCategorySettings />
</template>
