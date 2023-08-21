<script setup>
import NavBar from '../components/NavBar.vue'
import LandingPageShowcase from '../components/LandingPageShowcase.vue';
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'
</script>

<template>
  <main>
    <NavBar />
    <div class="min-h-screen flex-col flex">
      <LandingPageShowcase />
    </div>
    <div class="mt-auto">
      <StickyBanner />
      <Footer />
    </div>
  </main>
</template>
