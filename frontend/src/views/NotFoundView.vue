<script setup>
import NavBar from '../components/NavBar.vue'
</script>
<template>
  <NavBar />
  <section class="">
    <div class="container flex flex-wrap items-center justify-center mt-44 sm:mt-36 px-6 mx-auto">
      <div class="h-92 w-auto md:w-1/2">
        <img class="inset-0 h-full w-full object-cover object-center" src="../assets/nagato_typing.gif" />
      </div>
      <div class="w-full">
        <div class="flex flex-col items-center max-w-lg mx-auto text-center">
          <p class="text-2xl font-medium text-red-500 dark:text-red-400 mt-8">404 error</p>
          <h1 class="mt-3 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">
            No pudimos encontrar está página...
          </h1>
        </div>
      </div>
    </div>
  </section>
</template>
