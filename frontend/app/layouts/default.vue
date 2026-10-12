<template>
  <!-- Keep `dark` on <html> so it also covers teleported modals. -->
  <div class="flex bg-background flex-col min-h-screen overflow-x-clip">
    <!-- Let keyboard readers skip the header controls. -->
    <a href="#nd-main" class="nd-skip-link">{{ $t('common.skipToContent') }}</a>
    <AuthModalLoginSignUp />
    <LayoutImpersonationBanner />
    <LayoutHeader />
    <!-- Mount the teleport target before pages mount their floating buttons. -->
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
