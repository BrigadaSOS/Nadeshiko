<template>
    <NuxtLayout>
        <div class=" mx-auto">
            <div class=" px-4 pt-6 lg:pt-10 pb-6 lg:pb-10  mx-auto">
                <div class="mx-auto max-w-6xl">
                    <div class="content-markdown bg-card-background rounded-lg">
                        <ContentDoc path="/about" />
                    </div>
                </div>
            </div>
        </div>
    </NuxtLayout>
</template>

<style>

.content-markdown h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 1rem;
}


@media (min-width: 768px) {
    .content-markdown h2 {
        font-size: 1.875rem;
    }
}

.content-markdown h2 {
    color: white;
}

.content-markdown p {
    font-size: 1.125rem;
    color: #e5e7eb;
    margin-bottom: 1rem;
}

.content-markdown {
    padding-left: 1rem;
    padding-right: 1rem;
    padding-top: 1.5rem;
    padding-bottom: 1.5rem;
}

@media (min-width: 640px) {
    .content-markdown {
        padding-left: 2rem;
        padding-right: 2rem;
    }
}
</style>