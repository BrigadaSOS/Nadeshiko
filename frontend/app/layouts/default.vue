<template>
  <!-- `dark` is on <html> (nuxt.config app.head.htmlAttrs), not here: teleported
       modals are siblings of this element and would fall outside it. -->
  <div class="flex bg-background flex-col min-h-screen overflow-x-clip">
    <AuthModalLoginSignUp />
    <LayoutImpersonationBanner />
    <LayoutHeader />
    <!-- Shared gap under the navbar. Pages keep their own bottom padding. -->
    <main class="flex-grow pt-3 pb-20">
      <slot />
    </main>
    <PlayerAudioPlayer />
    <LayoutFooter />
  </div>
</template>
