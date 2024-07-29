<template>
    <div class="flex dark bg-background flex-col min-h-screen">
        <GeneralAuthModalLoginSignUp/>
        <Header />
        <main class="flex-grow">
            <slot />
        </main>
        <Footer />
    </div>
</template>