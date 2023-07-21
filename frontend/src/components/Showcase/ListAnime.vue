<script setup>
import { onMounted, ref } from 'vue'

let latest_anime_list = ref([])

const getLatestAnime = async () => {
  try {
    let response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'search/anime/info', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    response = await response.json()
    latest_anime_list.value = response
  } catch (error) {
    console.log(error)
    return
  }

  console.log(response)
}

onMounted(() => {
  getLatestAnime()
})
</script>
<template>
  <section class="w-full">
    <div class="tab-content m-2">
      <h1 class="text-xl mb-4 font-bold">Último contenido añadido</h1>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-3">
        <div v-for="(item, index) in latest_anime_list" class="relative">
          <div class="w-full pb-[145%] overflow-hidden relative bg-[rgba(255,255,255,0.1)] block">
            <img
              class="w-full transition duration-300 ease-in-out hover:scale-105 h-full object-cover absolute top-0 left-0"
              :src="item[0].media_info.cover"
            />
          </div>
          <div class="mt-[0.5rem] bg-white/10">
            <h3 class="text-base text-center font-medium">{{ item[0].media_info.english_name }}</h3>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
