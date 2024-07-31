<script setup>

// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t, locale } = useI18n()

const user_store = userStore()
const user = computed(() => user_store)
let dataUser = ref(null)
let isLoading = ref(false)
let error = ref(null)

const getUserInfo = async () => {
  isLoading.value = true
  try {
    const userInfo = await user_store.getBasicInfo()
    dataUser.value = userInfo
    error.value = null
  } catch (e) {
    error.value = 'Failed to load user data'
    console.error(e)
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  await getUserInfo()
})
</script>
<template>
  <!-- Card -->
  <div class="dark:bg-card-background p-6  mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Información</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-gray-400">Usuario</p>
          <div v-if="isLoading">
            <div class="w-32 h-4 mt-2 bg-gray-200 rounded-lg dark:bg-sgray"></div>
          </div>
          <p v-else class="text-white font-semibold">{{ dataUser?.info_user?.username || 'No available' }}</p>
        </div>
        <button data-hs-overlay="#hs-vertically-centered-scrollable-editusername"
          class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded">
          Cambiar
        </button>
      </div>
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-gray-400">Correo</p>
          <div v-if="isLoading">
            <div class="w-40 h-4 mt-2 bg-gray-200 rounded-lg dark:bg-sgray"></div>
          </div>
          <p v-else class="text-white font-semibold">{{ dataUser?.info_user?.email || 'No available' }}</p>
        </div>
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded">Cambiar</button>
      </div>
    </div>
  </div>

  <!-- Card -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Seguridad</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-gray-400">Contraseña</p>
          <p class="text-white font-semibold">*************</p>
        </div>
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded">Cambiar</button>
      </div>
    </div>
  </div>

  <!-- Card -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Adicional</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-white">Eliminar cuenta (Acción irreversible)</p>
        </div>
        <button
          class="bg-button-danger-main hover:bg-button-danger-hover text-white font-bold py-2 px-4 rounded">Eliminar</button>
      </div>
    </div>
  </div>
</template>
