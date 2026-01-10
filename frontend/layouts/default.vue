<template>
    <div class="flex dark bg-background flex-col min-h-screen">
        <GeneralAuthModalLoginSignUp/>
        <Header />
        <main class="flex-grow pb-20">
            <slot />
        </main>
        <PlayerAudioPlayer />
        <Footer />
    </div>
</template>