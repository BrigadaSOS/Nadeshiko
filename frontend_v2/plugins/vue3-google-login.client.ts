import vue3GoogleLogin from 'vue3-google-login'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(vue3GoogleLogin, {
    clientId: '467066531682-q8p3ve3pc59cqnfjqn9vftpbmplclum3.apps.googleusercontent.com'
  })
});
