export function getCurrentYear() {
  const currentDate = new Date();
  return currentDate.getFullYear();
}

export function useElementObserver(id: string, onAppear: (arg0: HTMLElement) => void, onDisappear: () => void) {
  let elementExists = false;

  const observer = new MutationObserver(() => {
    const element = document.getElementById(id);

    if (element && !elementExists) {
      if (typeof onAppear === 'function') onAppear(element);
      elementExists = true;
    } else if (!element && elementExists) {
      if (typeof onDisappear === 'function') onDisappear();
      elementExists = false;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return observer;
}