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
