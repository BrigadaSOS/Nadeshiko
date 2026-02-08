<script setup>

</script>

<template>
  <div class="flex dark bg-background flex-col min-h-screen">
    <AuthModalLoginSignUp />
    <LayoutHeader />
    <main class="flex-grow pb-20">
      <slot />
    </main>
    <PlayerAudioPlayer />
    <LayoutFooter />
  </div>
</template>
