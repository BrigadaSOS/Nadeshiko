import { defineStore } from 'pinia'
import router from '../router/index'
import { useToast } from 'vue-toastification'
import { i18n } from '../main'

const toast = useToast()

const options = {
    timeout: 3000,
    position: 'bottom-right'
}

export const apiStore = defineStore('api', {
    actions: {
        async getApiKeysByUser() {
            try {
                let response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'user/getApiKeys', {
                    method: 'POST',
                    mode: 'cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    withCredentials: true,
                    credentials: 'include'
                })


                if (response.status === 401) {
                    this.logout();
                }
                return response
            } catch (error) {
                console.log(error)
            }
        }
    }
})
