/**
 * Parse time in format "H:MM:SS.ffffff" to seconds.
 * Examples: "0:33:27.255000" → 2007.255, "1:10:15.500000" → 4215.5
 */
export function timeToSeconds(time: string): number {
  if (!time) return 0;

  // Format: H:MM:SS.ffffff or HH:MM:SS.ffffff
  const parts = time.split(':');
  if (parts.length !== 3) return 0;

  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  // Seconds part may have fractional seconds separated by .
  const secondsParts = parts[2].split('.');
  const seconds = parseInt(secondsParts[0], 10) || 0;
  const microseconds = secondsParts[1] ? parseInt(secondsParts[1].padEnd(6, '0'), 10) / 1_000_000 : 0;

  return hours * 3600 + minutes * 60 + seconds + microseconds;
}

/**
 * Format seconds to "H:MM:SS.ffffff" format.
 */
export function secondsToTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const microseconds = Math.round((seconds % 1) * 1_000_000);
  const wholeSeconds = Math.floor(seconds);

  return `${hours}:${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}.${microseconds.toString().padStart(6, '0')}`;
}
