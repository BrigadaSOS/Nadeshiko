<template>
    <li @click="handleClick" :class="{ active: isActive }">
      {{ categoryName }}
      <span class="ml-2.5 bg-gray-100 text-gray-800 text-sm me-2 px-2.5 py-1 rounded-lg dark:bg-button-primary-main dark:text-gray-300">
        <span>{{ count }}</span>
      </span>
    </li>
  </template>
  
  <script setup>
  const props = defineProps(['categoryName', 'count', 'isActive']);
  const emit = defineEmits(['click']);
  
  const handleClick = () => {
    emit('click');
  };
  </script>
  
  <style scoped>
  .active {
    font-weight: bold;
  }
  </style>
  