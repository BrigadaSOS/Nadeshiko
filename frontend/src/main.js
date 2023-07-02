import('preline')
import "vue-toastification/dist/index.css";

import './assets/main.css'

import { createHead } from '@vueuse/head'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { getStartingLocale } from './utils/i18n'

import App from './App.vue'
import router from './router'
import Toast from "vue-toastification";
import messages from '@intlify/unplugin-vue-i18n/messages'


// Language Configuration
const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getStartingLocale(),
  fallbackLocale: 'en',
  availableLocales: ['es', 'en'],
  messages
})

const app = createApp(App)
const head = createHead()

document.documentElement.classList.add('dark')

const options_toast = {
  transition: "Vue-Toastification__fade",
  maxToasts: 3,
  newestOnTop: true,
}

app.use(head)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(Toast, options_toast);

app.mount('#app')
