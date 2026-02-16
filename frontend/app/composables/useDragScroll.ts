import type { Ref } from 'vue';

export function useDragScroll(elRef: Ref<HTMLElement | null>) {
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;

  const onMouseDown = (e: MouseEvent) => {
    const el = elRef.value;
    if (!el) return;
    isDown = true;
    el.style.cursor = 'grabbing';
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDown) return;
    const el = elRef.value;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    el.scrollLeft = scrollLeft - (x - startX);
  };

  const onMouseUp = () => {
    if (!isDown) return;
    isDown = false;
    const el = elRef.value;
    if (el) el.style.cursor = '';
  };

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  onBeforeUnmount(() => {
    const el = elRef.value;
    if (el) el.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  });
}
