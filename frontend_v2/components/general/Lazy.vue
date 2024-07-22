<!-- Component related to guide https://medium.com/js-dojo/lazy-rendering-in-vue-to-improve-performance-dcccd445d5f-->
<template>
    <div :style="{ minHeight: `${minHeight}px` }" ref="lazyElement">
        <slot v-if="shouldRender"></slot>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
    minHeight: {
        type: Number,
        default: 300
    },
    unrender: {
        type: Boolean,
        default: false
    }
});

const lazyElement = ref(null);
const shouldRender = ref(false);
const renderTimer = ref(null);
const unrenderTimer = ref(null);

const handleIntersection = (entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            clearTimeout(unrenderTimer.value);
            renderTimer.value = setTimeout(() => {
                shouldRender.value = true;
            }, 200);
        } else {
            if (props.unrender) {
                clearTimeout(renderTimer.value);
                unrenderTimer.value = setTimeout(() => {
                    shouldRender.value = false;
                }, 5000);
            }
        }
    });
};

onMounted(() => {
    const observer = new IntersectionObserver(handleIntersection, {
        rootMargin: '2000px'
    });
    observer.observe(lazyElement.value);
    onUnmounted(() => {
        observer.disconnect();
        clearTimeout(renderTimer.value);
        clearTimeout(unrenderTimer.value);
    });
});
</script>