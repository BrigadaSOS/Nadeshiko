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
  // Named so `auth-callback` can declare it as a dependency: that plugin toasts
  // the outcome of an OAuth callback and needs this installed first.
  name: 'vue-toastification',
  setup(nuxtApp) {
    nuxtApp.vueApp.use(Toast, options);
  },
});
