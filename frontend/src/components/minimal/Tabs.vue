<script setup>

import { ref, useSlots, computed } from 'vue';

const slots = useSlots();

const activeTabIndex = ref(0);

const tabs = computed(() => {
  return slots.default
    ? slots.default().map((slot, index) => {
        if (slot.props && slot.props.amount && slot.props.amount !== 0) {
          const title = slot.props.title || 'No title';
          const amount = slot.props.amount;
          return {
            title,
            amount,
            isActive: index === activeTabIndex.value,
          };
        }
        return null;
      }).filter(tab => tab !== null)
    : [];
});

const selectTab = (tab, index) => {
  activeTabIndex.value = index;
  console.log(tab, index)
};

const tabClicked = (tab, index) => {
  selectTab(tab, index);
}
</script>

<template>
  <div id="tabs-container">
    <div id="tab-headers">
      <ul class="tab-titles">
        <li v-for="(tab, index) in tabs" :key="index" :class="{ active: activeTabIndex === index }" @click="tabClicked(tab, index)">
          {{ tab.title }} 
          <span class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-gray-600/30 dark:text-gray-300">
            <span v-if="tab.amount">{{ tab.amount }}</span>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style>
  #tab-headers ul {
    margin: 0;
    padding: 0;
    display: flex;
    border-bottom: 1px solid #dddddd21;
  }
  #tab-headers ul li {
    list-style: none;
    padding: 1rem 1.25rem;
    position: relative;
    cursor: pointer;
  }
  #tab-headers ul li.active {
    color: rgb(251, 120, 120);
    font-weight: bold;
  }
  
  #tab-headers ul li.active:after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    height: 2px;
    width: 100%;
    background: rgb(251, 120, 120);
  }
  #active-tab, #tab-headers {
    width: 100%;
  }
  
  #active-tab {
    padding: 0.75rem;
  }
  
</style>