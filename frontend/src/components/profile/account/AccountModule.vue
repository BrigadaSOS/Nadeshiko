<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import ChangeUsernameModal from './ChangeUsernameModal.vue'
import { userStore } from '../../../stores/user'

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
  <ChangeUsernameModal />
  <!-- Card -->

  <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Información Básica</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-gray-400">Usuario</p>
          <div v-if="isLoading">
            <div class="w-32 h-4 bg-gray-200 rounded-lg dark:bg-sgray"></div>
          </div>
          <p v-else class="text-white font-semibold">{{ dataUser?.info_user?.username || 'No available' }}</p>
        </div>
        <button
          data-hs-overlay="#hs-vertically-centered-scrollable-editusername"
          class="bg-graypalid hover:bg-graypalid/60 text-white font-bold py-2 px-4 rounded"
        >
          Cambiar
        </button>
      </div>
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-gray-400">Correo</p>
          <div v-if="isLoading">
            <div class="w-40 h-4 bg-gray-200 rounded-lg dark:bg-sgray"></div>
          </div>
          <p v-else class="text-white font-semibold">{{ dataUser?.info_user?.email || 'No available' }}</p>
        </div>
        <button class="bg-graypalid hover:bg-graypalid/60 text-white font-bold py-2 px-4 rounded">Cambiar</button>
      </div>
    </div>
  </div>

  <!-- Card -->
  <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Seguridad</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-gray-400">Contraseña</p>
          <p class="text-white font-semibold">*************</p>
        </div>
        <button class="bg-graypalid hover:bg-graypalid/60 text-white font-bold py-2 px-4 rounded">Cambiar</button>
      </div>
    </div>
  </div>

  <!-- Card -->
  <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Adicional</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-white">Eliminar cuenta (Acción irreversible)</p>
        </div>
        <button class="bg-sred hover:bg-sred/80 text-white font-bold py-2 px-4 rounded">Eliminar</button>
      </div>
    </div>
  </div>
</template>
