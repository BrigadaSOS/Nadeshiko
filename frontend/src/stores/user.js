import { defineStore } from 'pinia'
import router from '../router/index'

export const userStore = defineStore('user', {
  state: () => ({
    isLoggedIn: false
  }),
  persist: {
    key: 'info',
    storage: window.localStorage,
    paths: ['isLoggedIn']
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
          this.$patch((state) => {
            state.isLoggedIn = true
            console.log(state.isLoggedIn)
          })
          router.push('/')
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
            console.log(state.isLoggedIn)
          })
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
