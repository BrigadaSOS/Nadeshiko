<script setup>
import NavBar from '../components/NavBar.vue'
import StickyBanner from '../components/StickyBanner.vue'
import Footer from '../components/Footer.vue'

const getDataUser = async () => {
  try {
    let response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'user/info', {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    response = await response.json()
    console.log(response)
  } catch (error) {
    console.log(error)
    return
  }
}


getDataUser()
</script>

<template>
  <main>
    <NavBar />
    <div class="min-h-screen flex flex-col">
        Pagina perfil
    </div>
    <div class="mt-auto">
      <StickyBanner />
      <Footer />
    </div>
  </main>
</template>