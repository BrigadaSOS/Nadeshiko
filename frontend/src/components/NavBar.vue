<template>
  <nav class="bg-white border-gray-200 dark:bg-sred">
    <div class="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
      <a href="https://flowbite.com/" class="flex items-center">
        <img src="../assets/logo.webp" class="h-8 mr-3 rounded-xl" alt="Brigada SOS logo" />
        <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white"
          >NadeDB</span
        >
      </a>
      <div class="flex md:order-2">
        <button
          type="button"
          class="text-white bg-sred hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-4 py-2 text-center mr-3 md:mr-0 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-blue-800"
        >
          Iniciar Sesión
        </button>
        <button
          data-collapse-toggle="navbar-cta"
          type="button"
          class="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-white dark:hover:bg-gray-700 dark:focus:ring-gray-600"
          aria-controls="navbar-cta"
          aria-expanded="false"
        >
          <span class="sr-only">Open main menu</span>
          <svg
            class="w-6 h-6"
            aria-hidden="true"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill-rule="evenodd"
              d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
              clip-rule="evenodd"
            ></path>
          </svg>
        </button>
      </div>
      <div
        class="items-center justify-between hidden w-full md:flex md:w-auto md:order-1"
        id="navbar-cta"
      >
        <ul
          class="flex flex-col items-end font-medium p-4 md:p-0 mt-4 border border-gray-100 rounded-lg bg-gray-50 md:flex-row md:space-x-8 md:mt-0 md:border-0 md:bg-white dark:bg-gray-800 md:dark:bg-sred dark:border-gray-700"
        >
          <li>
            <a
              href="#"
              class="block py-2 pl-3 pr-4 text-white bg-sred rounded md:bg-transparent md:text-blue-700 md:p-0 md:dark:text-white font-bold"
              aria-current="page"
              >Inicio</a
            >
          </li>
          <li>
            <a
              href="#"
              class="font-bold block py-2 pl-3 pr-4 text-gray-900 rounded hover:bg-gray-100 md:hover:bg-transparent md:hover:text-blue-700 md:p-0 md:dark:hover:text-gray-700 dark:text-white dark:hover:bg-gray-700 dark:hover:text-white md:dark:hover:bg-transparent dark:border-gray-700"
              >Guía principal</a
            >
          </li>
          <li>
            <a
              href="#"
              class="font-bold block py-2 pl-3 pr-4 text-gray-900 rounded hover:bg-gray-100 md:hover:bg-transparent md:hover:text-blue-700 md:p-0 md:dark:hover:text-gray-700 dark:text-white dark:hover:bg-gray-700 dark:hover:text-white md:dark:hover:bg-transparent dark:border-gray-700"
              >Buscar</a
            >
          </li>
          <li>
            <a
              href="#"
              class="font-bold block py-2 pl-3 pr-4 text-gray-900 rounded hover:bg-gray-100 md:hover:bg-transparent md:hover:text-blue-700 md:p-0 md:dark:hover:text-gray-700 dark:text-white dark:hover:bg-gray-700 dark:hover:text-white md:dark:hover:bg-transparent dark:border-gray-700"
              >Acerca de</a
            >
          </li>
          <li>
            <a
              href="#"
              class="font-bold block py-2 pl-3 pr-4 text-gray-900 rounded hover:bg-gray-100 md:hover:bg-transparent md:hover:text-blue-700 md:p-0 md:dark:hover:text-gray-700 dark:text-white dark:hover:bg-gray-700 dark:hover:text-white md:dark:hover:bg-transparent dark:border-gray-700"
              >Contacto</a
            >
          </li>
        </ul>
      </div>
    </div>
  </nav>
  <div className="right-0 bottom-0 fixed text-gray-400 text-base p-4 ">v1.1.0. NadeDB</div>
</template>
