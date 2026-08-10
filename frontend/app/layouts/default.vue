<template>
  <!-- `dark` is on <html> (nuxt.config app.head.htmlAttrs), not here: teleported
       modals are siblings of this element and would fall outside it. -->
  <div class="flex bg-background flex-col min-h-screen overflow-x-clip">
    <AuthModalLoginSignUp />
    <LayoutImpersonationBanner />
    <LayoutHeader />
    <main class="flex-grow pb-20">
      <slot />
    </main>
    <PlayerAudioPlayer />
    <LayoutFooter />
  </div>
</template>
