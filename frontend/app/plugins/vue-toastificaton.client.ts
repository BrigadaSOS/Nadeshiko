import { defineNuxtPlugin } from '#app';
import 'vue-toastification/dist/index.css';
import Toast, { TYPE } from 'vue-toastification';

const options = {
  toastDefaults: {
    [TYPE.ERROR]: {
      timeout: 3000,
      position: 'bottom-right',
    },
    [TYPE.SUCCESS]: {
      timeout: 3000,
      position: 'bottom-right',
    },
    [TYPE.INFO]: {
      timeout: 1500,
      position: 'bottom-right',
    },
  },
};
export default defineNuxtPlugin({
  // Named dependency for auth-callback, which requires toast installation first.
  name: 'vue-toastification',
  setup(nuxtApp) {
    nuxtApp.vueApp.use(Toast, options);
  },
});
