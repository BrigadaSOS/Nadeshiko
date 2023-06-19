<template>
  <div
    v-if="!isBannerClosed"
    id="bottom-banner"
    tabindex="-1"
    class="fixed bottom-0 left-0 z-50 flex justify-between w-full p-4 border-t border-gray-200 bg-gray-50 dark:bg-sgray dark:border-gray-600"
  >
    <div class="flex items-center mx-auto">
      <p class="flex items-center text-sm font-normal text-gray-500 dark:text-gray-400">
        <span class="inline-flex p-1 mr-3 bg-gray-200 rounded-full dark:bg-gray-600">
          <svg
            g
            transform="translate(-1.4,-1) "
            class="w-4 h-4 text-gray-500 dark:text-gray-400"
            fill="currentColor"
            viewBox="0 0 35 35"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              clip-rule="evenodd"
              fill-rule="evenodd"
              d="M36 4H12C9.79 4 8 5.79 8 8v32c0 2.21 1.79 4 4 4h24c2.21 0 4-1.79 4-4V8c0-2.21-1.79-4-4-4zM12 8h10v16l-5-3-5 3V8z"
            ></path>
          </svg>
          <span class="sr-only"></span>
        </span>
        <span
          >Visita nuestra guía para<a
            href="https://brigadasos.xyz/"
            class="flex items-center ml-0 text-sm font-medium text-blue-600 md:ml-1 md:inline-flex dark:text-blue-500 hover:underline"
          >
            aprender japonés
            <svg
              aria-hidden="true"
              class="w-4 h-4 ml-1 text-blue-600 dark:text-blue-500"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillrule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                cliprule="evenodd"
              ></path></svg></a
        ></span>
      </p>
    </div>
    <div class="flex items-center">
      <button
        data-dismiss-target="#bottom-banner"
        @click="closeBanner"
        type="button"
        class="flex-shrink-0 inline-flex justify-center items-center text-gray-400 hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 dark:hover:bg-gray-600 dark:hover:text-white"
      >
        <svg
          aria-hidden="true"
          class="w-4 h-4"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clip-rule="evenodd"
          ></path>
        </svg>
        <span class="sr-only">Close banner</span>
      </button>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      isBannerClosed: false
    }
  },
  mounted() {
    this.isBannerClosed = localStorage.getItem('isBannerClosed') === 'true'
  },
  methods: {
    closeBanner() {
      this.isBannerClosed = true
      localStorage.setItem('isBannerClosed', 'true')

      let element = document.getElementById('drawer-button');
      element.style.top = '0px'
      element.style.position = 'relative'
    }
  }
}
</script>
