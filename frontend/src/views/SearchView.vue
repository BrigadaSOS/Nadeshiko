<script setup>
import NavBar from '../components/NavBar.vue'
import ShowcaseSentence from '../components/ShowcaseSentence.vue'
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'
</script>

<template>
  <main>
    <NavBar />
    <div class="min-h-screen flex-col flex">
      <ShowcaseSentence />
    </div>
    <div class="mt-auto">
      <StickyBanner />
      <Footer />
    </div>
  </main>
</template>
