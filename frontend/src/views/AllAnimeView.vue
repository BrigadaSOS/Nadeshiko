<script setup>
import NavBar from '../components/NavBar.vue'
import ListAnimeFull from '../components/Showcase/ListAnimeFull.vue'
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'
</script>

<template>
  <main>
    <NavBar />
    <div class="">
      <ListAnimeFull />
    </div>
    <div class="mt-auto">
      <StickyBanner />
      <Footer />
    </div>
  </main>
</template>