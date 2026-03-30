<script setup>
const { origin } = useRequestURL();
const ogImage = `${origin}/logo-og.png`;

useHead({
  meta: [
    { property: 'og:image', content: ogImage },
    { name: 'twitter:image', content: ogImage },
  ],
});
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
