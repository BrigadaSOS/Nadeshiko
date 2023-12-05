<script setup>
import ListAnime from './Showcase/ListAnime.vue'
import SearchBarSentences from './minimal/SearchBarSentences.vue'
</script>
<template>
  <div>
    <SearchBarSentences path="/search/sentences" />
    <div class="flex flex-row lg:w-11/12 mx-auto mb-20">
      <div class="container sm:max-w-screen-lg md:max-w-full mx-auto flex flex-col">
        <ListAnime />
      </div>
    </div>
  </div>
</template>
