import "preline/preline";
import { type IStaticMethods } from "preline/preline";
import { debounce } from "perfect-debounce";
declare global {
  interface Window {
    HSStaticMethods: IStaticMethods;
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("page:finish", () => {
    const targetNode = document.getElementById("page-container");
    if (targetNode) {
      const config = { childList: true, subtree: true };
      const callback = debounce(() => {
        window.HSStaticMethods.autoInit();
      }, 100);

      const observer = new MutationObserver(callback);
      observer.observe(targetNode, config);
    }
  });
});
