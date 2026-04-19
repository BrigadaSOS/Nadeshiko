<script setup lang="ts">
const route = useRoute();
const localePath = useLocalePath();
await navigateTo(localePath(`/sentence/${route.params.id}`), { redirectCode: 301 });
</script>
