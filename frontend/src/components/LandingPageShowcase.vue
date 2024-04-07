<script setup>
import ListAnime from './Showcase/ListAnime.vue'
import SearchBarSentences from './minimal/SearchBarSentences.vue'
</script>
<template>
  <div>
    <SearchBarSentences path="/search/sentences" />
    <ListAnime />
  </div>
</template>
