<script setup>
import NavBar from '../components/NavBar.vue'
import About from '../components/miscelaneous/About.vue';
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'

</script>

<template>
  <main>
    <NavBar />
    <div class="min-h-screen flex flex-col">
        <About/>
    </div>
    <div class="mt-auto">
      <StickyBanner />
      <Footer/>
    </div>
  </main>
</template>