import { defineStore } from 'pinia'
import router from '../router/index'
import { useToast } from 'vue-toastification'
import { i18n } from '../main' 

const toast = useToast()

const options = {
  timeout: 3000,
  position: 'bottom-right'
}

export const userStore = defineStore('user', {
  state: () => ({
    isLoggedIn: false,
    filterPreferences: {
      exact_match: false
    }
  }),
  persist: {
    key: 'info',
    storage: window.localStorage,
    paths: ['isLoggedIn', 'filterPreferences']
  },
  actions: {
    async login(email, password) {
      try {
        fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'user/login', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json'
          },
          withCredentials: true,
          credentials: 'include',
          body: JSON.stringify({
            email: email,
            password: password
          })
        }).then((response) => {
          if(response.status === 404 || response.status === 400){
            const message = i18n.global.t('modalauth.labels.errorlogin400')
            toast.error(message, options)
          }else{
            this.$patch((state) => {
              state.isLoggedIn = true
            })
            const message = i18n.global.t('modalauth.labels.successfullogin')
            toast.success(message, options)
          }
        })
      } catch (error) {
        console.log(error)
      }
    },
    async logout() {
      try {
        fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'user/logout', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json'
          },
          withCredentials: true,
          credentials: 'include'
        }).then((response) => {
          this.$patch((state) => {
            state.isLoggedIn = false
          })
          const message = i18n.global.t('modalauth.labels.logout')
          toast.success(message, options)
          router.push('/')
        })
      } catch (error) {
        console.log(error)
      }
    },
    async getBasicInfo() {
      try {
        const response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'user/info', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json'
          },
          withCredentials: true,
          credentials: 'include'
        })
        return await response.json()
      } catch (error) {
        console.log(error)
      }
    }
  }
})
