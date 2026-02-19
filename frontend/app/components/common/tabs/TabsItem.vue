<template>
  <li @click="handleClick" :class="{ active: isActive }">
    <span class="tab-label">{{ categoryName }}</span>
    <span class="tab-count bg-gray-100 text-gray-800 text-sm px-2.5 py-1 rounded-lg dark:bg-button-primary-main dark:text-gray-300">
      {{ count }}
    </span>
  </li>
</template>

<script setup>
defineProps(['categoryName', 'count', 'isActive']);
const emit = defineEmits(['click']);

const handleClick = () => {
  emit('click');
};
</script>

<style scoped>
.active {
  font-weight: bold;
}

.tab-label {
  line-height: 1.2;
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  min-height: 1.5rem;
}
</style>
