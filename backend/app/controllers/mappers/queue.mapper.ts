import type { getStuckJobs, fetchQueueDetails, getFailedJobs } from '@app/workers/queueAdmin';

type QueueStatsList = Awaited<ReturnType<typeof getStuckJobs>>;
type QueueStatsItem = QueueStatsList[number];
type QueueDetails = NonNullable<Awaited<ReturnType<typeof fetchQueueDetails>>>;
type QueueFailedJobsList = Awaited<ReturnType<typeof getFailedJobs>>;
type QueueFailedJob = QueueFailedJobsList[number];

type QueueAction = 'retry' | 'purge';

export function toAdminQueueStatsDTO(stats: QueueStatsList): QueueStatsList {
  return stats.map((entry: QueueStatsItem) => ({
    queue: entry.queue,
    stuckCount: entry.stuckCount,
    failedCount: entry.failedCount,
  }));
}

export function toAdminQueueDetailsDTO(details: QueueDetails): QueueDetails {
  return {
    queue: details.queue,
    stats: {
      deferred: details.stats.deferred,
      queued: details.stats.queued,
      active: details.stats.active,
      total: details.stats.total,
    },
    metadata: {
      policy: details.metadata.policy,
      partition: details.metadata.partition,
      deadLetter: details.metadata.deadLetter,
      warningQueueSize: details.metadata.warningQueueSize,
      retryLimit: details.metadata.retryLimit,
      retryDelay: details.metadata.retryDelay,
      retryBackoff: details.metadata.retryBackoff,
      retryDelayMax: details.metadata.retryDelayMax,
      expireInSeconds: details.metadata.expireInSeconds,
      retentionSeconds: details.metadata.retentionSeconds,
      deleteAfterSeconds: details.metadata.deleteAfterSeconds,
      createdOn: details.metadata.createdOn,
      updatedOn: details.metadata.updatedOn,
      singletonsActive: details.metadata.singletonsActive,
      table: details.metadata.table,
    },
  };
}

export function toAdminQueueFailedJobDTO(job: QueueFailedJob) {
  return {
    id: job.id,
    segmentId: job.segmentId,
    error: job.error,
    createdOn: job.createdOn.toISOString(),
  };
}

export function toAdminQueueFailedJobsDTO(jobs: QueueFailedJobsList) {
  return jobs.map(toAdminQueueFailedJobDTO);
}

export function toAdminQueueActionResultDTO(action: QueueAction, queueName: string, count: number) {
  if (action === 'retry') {
    return {
      success: true,
      retriedCount: count,
      message: `Retried ${count} failed jobs from ${queueName}`,
    };
  }

  return {
    success: true,
    purgedCount: count,
    message: `Purged ${count} failed jobs from ${queueName}`,
  };
}
