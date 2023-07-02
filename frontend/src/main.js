import('preline')
import './assets/main.css'

import { createHead } from '@vueuse/head'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import App from './App.vue'
import router from './router'
import messages from '@intlify/unplugin-vue-i18n/messages'

// Language Configuration
const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'es',
  fallbackLocale: 'es',
  availableLocales: ['es', 'en'],
  messages
})

const app = createApp(App)
const head = createHead()

document.documentElement.classList.add('dark')

app.use(head)
app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
