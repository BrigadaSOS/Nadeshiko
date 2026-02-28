<script setup lang="ts">
const route = useRoute();
await navigateTo(`/sentence/${route.params.id}`, { redirectCode: 301 });
</script>
