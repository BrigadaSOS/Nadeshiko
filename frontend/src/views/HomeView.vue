<script setup>
import NavBar from '../components/NavBar.vue'
import LandingPageShowcase from '../components/LandingPageShowcase.vue';
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'
</script>

<template>
  <main>
    <NavBar />
    <div class="flex-col flex">
      <LandingPageShowcase />
    </div>
    <div class="">
      <StickyBanner />
      <Footer />
    </div>
  </main>
</template>
