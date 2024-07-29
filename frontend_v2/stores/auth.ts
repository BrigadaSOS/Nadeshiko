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
    storage: typeof window !== 'undefined' ? window.localStorage : null,
    paths: ['isLoggedIn', 'filterPreferences', 'userInfo']
  },
  actions: {
    async login(email: string, password: string) {
      const config = useRuntimeConfig();
      try {
        const response = await fetch(`${config.public.baseURLBackend}auth/login`, {
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
              roles: responseData.user.roles.map((roles :any) => roles.id_role)
            };
          });
          console.log("Login exitoso")
        } else {
          console.log("login fallido")
        }
      } catch (error) {
        console.log(error);
      }
    },   
    async loginGoogle(code: string) {
      try {
        const config = useRuntimeConfig();
        const response = await fetch(`${config.public.baseURLBackend}auth/google`, {
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
              roles: responseData.user.roles.map((roles: any) => roles.id_role)
            };
          });
          console.log("Exitoso")
        } else {
          console.log("fallido")
        }
      } catch (error) {
        console.log(error);
      }
    },    
    async register(email: string, password: string) {
      try {
        const response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'user/register', {
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
      const config = useRuntimeConfig();
      const router = useRouter();
      try {
        await fetch(`${config.public.baseURLBackend}auth/logout`, {
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
