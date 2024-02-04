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
    },
    userInfo: {
      roles: null
    }
  }),
  persist: {
    key: 'info',
    storage: window.localStorage,
    paths: ['isLoggedIn', 'filterPreferences', 'userInfo']
  },
  actions: {
    async login(email, password) {
      try {
        const response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'api/user/login', {
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
        });
    
        // Si la respuesta es exitosa, extrae el JSON
        if (response.ok) {
          const responseData = await response.json();
          this.$patch((state) => {
            state.isLoggedIn = true;
            state.userInfo = {
              roles: responseData.user.roles.map((roles) => roles.id_role)
            };
          });
          const message = i18n.global.t('modalauth.labels.successfullogin');
          toast.success(message, options);
        } else {
          const message = i18n.global.t('modalauth.labels.errorlogin400');
          toast.error(message, options);
        }
      } catch (error) {
        console.log(error);
      }
    },   
    async loginGoogle(code) {
      try {
        const response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'api/user/login/google', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json'
          },
          withCredentials: true,
          credentials: 'include',
          body: JSON.stringify({
            code: code
          })
        });    
        // Si la respuesta es exitosa, extrae el JSON
        if (response.ok) {
          const responseData = await response.json();
          console.log(responseData)

          this.$patch((state) => {
            state.isLoggedIn = true;
            state.userInfo = {
              roles: responseData.user.roles.map((roles) => roles.id_role)
            };
          });
          const message = i18n.global.t('modalauth.labels.successfullogin');
          toast.success(message, options);
        } else {
          const message = i18n.global.t('modalauth.labels.errorlogin400');
          toast.error(message, options);
        }
      } catch (error) {
        console.log(error);
      }
    },    
    async register(email, password) {
      try {
        const response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'api/user/register', {
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
        });
        // Si la respuesta es exitosa, extrae el JSON
        if (response.ok) {
          const responseData = await response.json();
          const message = 'Registro exitoso'
          toast.success(message, options);
        } else {
          const message = 'Registro fallido. Intentelo nuevamente'
          toast.error(message, options);
        }
      } catch (error) {
        console.log(error);
      }
    },    
    async logout(msg) {
      try {
        fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'jwt/user/logout', {
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
            state.userInfo = null
          })
          const message = msg ? msg : i18n.global.t('modalauth.labels.logout')
          toast.success(message, options)
          router.push('/')
        })
      } catch (error) {
        console.log(error)
      }
    },
    async getBasicInfo() {
      try {
        let response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'jwt/user/info', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json'
          },
          withCredentials: true,
          credentials: 'include'
        })

        response = await response.json()
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
