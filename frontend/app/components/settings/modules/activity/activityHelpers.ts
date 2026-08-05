import type { UserActivity, UserActivityStats } from '@brigadasos/nadeshiko-sdk';

export type ActivityItem = UserActivity;
export type ActivityStats = UserActivityStats;
export type StatsRange = '7d' | '30d' | '90d' | 'all';
export type HeatmapRawData = Record<string, Record<string, number>>;

export const HEATMAP_DAYS = 365;
export const ACTIVITY_PAGE_SIZE = 20;

export const ACTIVITY_TYPES = ['SEARCH', 'SEGMENT_PLAY', 'ANKI_EXPORT', 'SHARE'] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activityTypeLabel = (type: string, t: (key: string) => string): string =>
  (ACTIVITY_TYPES as readonly string[]).includes(type) ? t(`accountSettings.activity.types.${type}`) : type;

export const activityTypeClass = (type: string) => {
  const classes: Record<string, string> = {
    SEARCH: 'border-red-400/40 bg-red-500/10 text-red-300',
    SEGMENT_PLAY: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
    ANKI_EXPORT: 'border-blue-400/40 bg-blue-500/10 text-blue-300',
    SHARE: 'border-purple-400/40 bg-purple-500/10 text-purple-300',
  };
  return classes[type] || 'border-white/20 bg-white/5 text-white/80';
};

export const activityTypeMutedClass = (type: string) => {
  const classes: Record<string, string> = {
    SEARCH: 'border-red-400/20 bg-red-500/5 text-red-300/60 hover:text-red-200 hover:bg-red-500/10',
    SEGMENT_PLAY:
      'border-emerald-400/20 bg-emerald-500/5 text-emerald-300/60 hover:text-emerald-200 hover:bg-emerald-500/10',
    ANKI_EXPORT: 'border-blue-400/20 bg-blue-500/5 text-blue-300/60 hover:text-blue-200 hover:bg-blue-500/10',
    SHARE: 'border-purple-400/20 bg-purple-500/5 text-purple-300/60 hover:text-purple-200 hover:bg-purple-500/10',
  };
  return classes[type] || 'border-white/10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10';
};

export const HEATMAP_PALETTES = {
  default: [
    'bg-white/5 border-white/10',
    'bg-amber-900/50 border-amber-800/60',
    'bg-amber-700/60 border-amber-600/70',
    'bg-amber-500/70 border-amber-400/80',
    'bg-amber-300/80 border-amber-200/80',
  ],
  SEARCH: [
    'bg-white/5 border-white/10',
    'bg-red-900/50 border-red-800/60',
    'bg-red-700/60 border-red-600/70',
    'bg-red-500/70 border-red-400/80',
    'bg-red-300/80 border-red-200/80',
  ],
  SEGMENT_PLAY: [
    'bg-white/5 border-white/10',
    'bg-emerald-900/50 border-emerald-800/60',
    'bg-emerald-700/60 border-emerald-600/70',
    'bg-emerald-500/70 border-emerald-400/80',
    'bg-emerald-300/80 border-emerald-200/80',
  ],
  ANKI_EXPORT: [
    'bg-white/5 border-white/10',
    'bg-blue-900/50 border-blue-800/60',
    'bg-blue-700/60 border-blue-600/70',
    'bg-blue-500/70 border-blue-400/80',
    'bg-blue-300/80 border-blue-200/80',
  ],
  SHARE: [
    'bg-white/5 border-white/10',
    'bg-purple-900/50 border-purple-800/60',
    'bg-purple-700/60 border-purple-600/70',
    'bg-purple-500/70 border-purple-400/80',
    'bg-purple-300/80 border-purple-200/80',
  ],
};

export const toDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const sinceForRange = (range: StatsRange): string | undefined => {
  if (range === 'all') return undefined;
  const d = new Date();
  const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  d.setDate(d.getDate() - (daysMap[range] ?? 7));
  return toDayKey(d);
};

export const formatDayLabel = (dayKey: string, locale: string) => {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
