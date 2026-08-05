import type { AdminReportGroup } from '@brigadasos/nadeshiko-sdk';

export type ReportGroup = AdminReportGroup;
export type ReportGroupItem = AdminReportGroup['reports'][number];

export const ALL_STATUSES = ['OPEN', 'PROCESSING', 'FIXED', 'DISMISSED'] as const;

export const statusClass = (status: string) => {
  switch (status) {
    case 'OPEN':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-600';
    case 'PROCESSING':
      return 'bg-blue-500/20 text-blue-400 border-blue-600';
    case 'FIXED':
      return 'bg-green-500/20 text-green-400 border-green-600';
    case 'DISMISSED':
      return 'bg-neutral-500/20 text-neutral-400 border-neutral-600';
    default:
      return 'bg-neutral-500/20 text-neutral-400 border-neutral-600';
  }
};

export const sourceClass = (source: string) => {
  return source === 'USER'
    ? 'bg-indigo-500/20 text-indigo-400 border-indigo-600'
    : 'bg-cyan-500/20 text-cyan-400 border-cyan-600';
};

export const formatNumber = (value: number, locale: string) => new Intl.NumberFormat(locale).format(value);

export const formatDate = (iso: string, locale: string) => {
  return new Date(iso).toLocaleString(locale);
};

export const formatRelativeDate = (iso: string, locale: string) => {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return formatter.format(-Math.max(minutes, 0), 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  return formatter.format(-days, 'day');
};
