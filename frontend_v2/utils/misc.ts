export function getCurrentYear(): number {
  const currentDate = new Date();
  return currentDate.getFullYear();
}

export function useElementObserver(id: string, onAppear: (arg0: HTMLElement) => void, onDisappear: () => void): MutationObserver {
  let elementExists = false;

  const observer = new MutationObserver(() => {
    const element = document.getElementById(id);

    if (element && !elementExists) {
      onAppear(element);
      elementExists = true;
    } else if (!element && elementExists) {
      onDisappear();
      elementExists = false;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return observer;
}
