import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
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
    "nuxtjs-naive-ui",
    "@nuxt/content",
    "@scalar/nuxt"
  ],
  vite: {
    plugins: [
      AutoImport({
        imports: [
          {
            'naive-ui': [
              'useDialog',
              'useMessage',
              'useNotification',
              'useLoadingBar',
            ]
          }
        ]
      }),
      Components({
        resolvers: [NaiveUiResolver()]
      }),
      "~/plugins/preline.client.ts"
    ]
  }
});