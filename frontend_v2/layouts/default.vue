<template>
    <div class="flex dark bg-background flex-col min-h-screen">
        <Header />
        <main class="flex-grow">
            <slot />
        </main>
        <Footer />
    </div>
</template>