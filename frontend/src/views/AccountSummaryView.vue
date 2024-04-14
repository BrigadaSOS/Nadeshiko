<script setup>
import NavBar from '../components/NavBar.vue'
import Summary from '../components/profile/Summary.vue';
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'

</script>

<template>
  <main>
    <NavBar />
    <div class="">
        <Summary/>
    </div>
    <div class="">
      <StickyBanner />
      <Footer />
    </div>
  </main>
</template>