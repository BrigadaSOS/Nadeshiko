<template>
  <!-- `dark` is on <html> (nuxt.config app.head.htmlAttrs), not here: teleported
       modals are siblings of this element and would fall outside it. -->
  <div class="flex bg-background flex-col min-h-screen overflow-x-clip">
    <AuthModalLoginSignUp />
    <LayoutImpersonationBanner />
    <LayoutHeader />
    <!-- Ahead of the page, not after it: pages teleport their own floating
         buttons into the dock, and the target has to be in the DOM by the time
         they mount. -->
    <CommonFabDock />
    <!-- Shared gap under the navbar. Pages keep their own bottom padding. -->
    <main class="flex-grow pt-3 pb-20">
      <slot />
    </main>
    <PlayerAudioPlayer />
    <CommonFeedbackWidget />
    <LayoutFooter />
  </div>
</template>
