<script setup lang="ts">
const localePath = useLocalePath();

await navigateTo({ path: localePath('/roadmap'), hash: '#features' }, { redirectCode: 301 });
</script>
