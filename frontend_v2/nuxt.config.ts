import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      baseURLBackend: process.env.NUXT_APP_BASE_URL_BACKEND,
    },
  },
  pages: true,
  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "@nuxtjs/i18n",
    "@nuxt/content",
    "@scalar/nuxt",
    "@nuxt/image"
  ],
  plugins: ['~/plugins/preline.client.ts'],
});