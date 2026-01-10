import { useNuxtApp } from "#app";
import { defineStore } from 'pinia'

export const userStore = defineStore("user", {
  state: () => ({
    isLoggedIn: false,
    filterPreferences: {
      exact_match: false,
    },
    userInfo: {
      roles: null,
    },
  }),
  getters: {
    isAdmin: (state) => {
      return state.userInfo.roles?.some((role: any) => role.id_role === 1); // ADMIN role id = 1
    },
  },
  persist: {
    key: "info",
    storage: piniaPluginPersistedstate.localStorage(),
    paths: ["isLoggedIn", "filterPreferences", "userInfo"],
  },
  actions: {
    async login(email: string, password: string) {
      const { $i18n } = useNuxtApp();
      const config = useRuntimeConfig();
      try {
        const response = await fetch(
          `${config.public.baseURLBackend}auth/login`,
          {
            method: "POST",
            mode: "cors",
            headers: {
              "Content-Type": "application/json",
            },
            withCredentials: true,
            credentials: "include",
            body: JSON.stringify({
              email: email,
              password: password,
            }),
          }
        );

        // If the response is successful, extract the JSON
        if (response.ok) {
          this.$patch((state) => {
            state.isLoggedIn = true;
          });
          await this.getBasicInfo();
          const message = $i18n.t("modalauth.labels.successfullogin");
          useToastSuccess(message);
        } else {
          const message = $i18n.t("modalauth.labels.errorlogin400");
          useToastError(message);
        }
      } catch (error) {
        const message = $i18n.t("modalauth.labels.errorlogin400");
        useToastError(message);
      }
    },
    async loginGoogle(code: string) {
      const { $i18n } = useNuxtApp();
      try {
        const config = useRuntimeConfig();
        const response = await fetch(
          `${config.public.baseURLBackend}auth/google`,
          {
            method: "POST",
            mode: "cors",
            headers: {
              "Content-Type": "application/json",
            },
            withCredentials: true,
            credentials: "include",
            body: JSON.stringify({
              code: code,
            }),
          }
        );
        // If the response is successful, extract the JSON
        if (response.ok) {
          this.$patch((state) => {
            state.isLoggedIn = true;
          });
          await this.getBasicInfo();
          const message = $i18n.t("modalauth.labels.successfullogin");
          useToastSuccess(message);
        } else {
          const message = $i18n.t("modalauth.labels.errorlogin400");
          useToastError(message);
        }
      } catch (error) {
        const message = $i18n.t("modalauth.labels.errorlogin400");
        useToastError(message);
      }
    },
    async redirectToDiscordLogin() {
      try {
        const config = useRuntimeConfig();
        const response = await fetch(
          `${config.public.baseURLBackend}auth/discord/url`,
          {
            method: "GET",
          }
        );

        if (response.ok) {
          const data = await response.json();

          if (data && data.url) {
            window.location.href = data.url
          }
        }
      } catch (error) {
        console.log(error);
      }
    },
    async loginDiscord(code: string) {
      const { $i18n } = useNuxtApp();
      try {
        const config = useRuntimeConfig();
        const response = await fetch(
          `${config.public.baseURLBackend}auth/discord`,
          {
            method: "POST",
            mode: "cors",
            headers: {
              "Content-Type": "application/json",
            },
            withCredentials: true,
            credentials: "include",
            body: JSON.stringify({
              code: code,
            }),
          }
        );

        if (response.ok) {
          this.$patch((state) => {
            state.isLoggedIn = true;
          });
          await this.getBasicInfo();
          const message = $i18n.t("modalauth.labels.successfullogin");
          useToastSuccess(message);
        } else {
          const message = $i18n.t("modalauth.labels.errorlogin400");
          useToastError(message);
        }
      } catch (error) {
        const message = $i18n.t("modalauth.labels.errorlogin400");
        useToastError(message);
      }
    },
    async signUp(username: string, email: string, password: string) {
      const { $i18n } = useNuxtApp();
      const config = useRuntimeConfig();
      try {
        const response = await fetch(
          `${config.public.baseURLBackend}auth/register`,
          {
            method: "POST",
            mode: "cors",
            headers: {
              "Content-Type": "application/json",
            },
            withCredentials: true,
            credentials: "include",
            body: JSON.stringify({
              username: username,
              email: email,
              password: password,
            }),
          }
        );
        // If the response is successful, extract the JSON
        if (response.ok) {
          const responseData = await response.json();
          const message = $i18n.t("auth.registrationSuccess");
          useToastSuccess(message);
        } else {
          const message = $i18n.t("auth.registrationError");
          useToastError(message);
        }
      } catch (error) {
        console.log(error);
      }
    },
    async logout(msg: string) {
      const config = useRuntimeConfig();
      const router = useRouter();
      const { $i18n } = useNuxtApp();
      try {
        await fetch(`${config.public.baseURLBackend}auth/logout`, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          withCredentials: true,
          credentials: "include",
        }).then((response) => {
          this.$patch((state) => {
            state.isLoggedIn = false;
            state.userInfo = null;
          });
          router.push("/");
          const message = msg ? msg : $i18n.t("modalauth.labels.logout");
          useToastSuccess(message);
        });
      } catch (error) {
        console.log(error);
      }
    },
    async getBasicInfo() {
      try {
        const config = useRuntimeConfig();
        const response = await fetch(
          `${config.public.baseURLBackend}auth/identity/me`,
          {
            method: "GET",
            mode: "cors",
            headers: {
              "Content-Type": "application/json",
            },
            withCredentials: true,
            credentials: "include",
          }
        );

        if (response.ok) {
          const responseData = await response.json();
          this.$patch((state) => {
            state.isLoggedIn = true;
            state.userInfo = {
              roles: responseData?.user?.roles || [],
            };
          });
          return responseData;
        } else {
          this.isLoggedIn = false;
          if (response.status === 401) {
            this.logout();
          }
        }
      } catch (error) {
        this.isLoggedIn = false;
      }
    },
  },
});
