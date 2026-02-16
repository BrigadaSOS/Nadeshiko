export function getCurrentYear(): number {
  const currentDate = new Date();
  return currentDate.getFullYear();
}

/**
 * Format milliseconds to H:MM:SS display string.
 */
export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
