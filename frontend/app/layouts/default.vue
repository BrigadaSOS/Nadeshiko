<template>
  <!-- `dark` is on <html> (nuxt.config app.head.htmlAttrs), not here: teleported
       modals are siblings of this element and would fall outside it. -->
  <div class="flex bg-background flex-col min-h-screen overflow-x-clip">
    <!-- First thing Tab reaches: the header carries eleven controls before the
         search field, which every keyboard reader had to walk on every page. -->
    <a href="#nd-main" class="nd-skip-link">{{ $t('common.skipToContent') }}</a>
    <AuthModalLoginSignUp />
    <LayoutImpersonationBanner />
    <LayoutHeader />
    <!-- Ahead of the page, not after it: pages teleport their own floating
         buttons into the dock, and the target has to be in the DOM by the time
         they mount. -->
    <CommonFabDock />
    <!-- Shared gap under the navbar. Pages keep their own bottom padding. -->
    <main id="nd-main" class="flex-grow pt-3 pb-20">
      <slot />
    </main>
    <PlayerAudioPlayer />
    <CommonFeedbackWidget />
    <LayoutFooter />
  </div>
</template>
