<script setup>
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        'name': 'Nadeshiko',
        'url': 'https://nadeshiko.co',
        'description': 'Search Japanese sentences from anime, J-dramas, and audiobooks. Learn Japanese with real native content.',
        'potentialAction': {
          '@type': 'SearchAction',
          'target': {
            '@type': 'EntryPoint',
            'urlTemplate': 'https://nadeshiko.co/search/sentence?query={search_term_string}'
          },
          'query-input': 'required name=search_term_string'
        }
      })
    }
  ]
});
</script>

<template>
  <NuxtLoadingIndicator />
  <div id="page-container">
    <NuxtPage />
  </div>
</template>
