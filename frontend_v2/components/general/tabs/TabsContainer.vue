<template>
  <div id="tabs-container" class="mt-2">
    <slot></slot>
  </div>
</template>

<script setup>
</script>

<style>
#tab-headers ul {
  margin: 0;
  padding: 0;
  display: flex;
  border-bottom: 2px solid #dddddd21;
  list-style: none;
  flex-wrap: nowrap;
  width: 100%;
}

#tab-headers ul li {
  padding: 1rem 1.25rem;
  position: relative;
  display: inline-flex;
  cursor: pointer;
  flex-shrink: 0;
}

#tab-headers ul li.active {
  color: rgb(251, 120, 120);
}

#tab-headers ul li.active:after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  height: 2px;
  width: 100%;
  background: #d74e67;
}

#active-tab,
#tab-headers {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

#active-tab {
  padding: 0.75rem;
}
</style>