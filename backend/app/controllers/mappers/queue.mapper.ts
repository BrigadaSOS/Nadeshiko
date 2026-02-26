import type { getStuckJobs, fetchQueueDetails, getFailedJobs } from '@app/workers/queueAdmin';

type QueueStatsList = Awaited<ReturnType<typeof getStuckJobs>>;
type QueueStatsItem = QueueStatsList[number];
type QueueDetails = NonNullable<Awaited<ReturnType<typeof fetchQueueDetails>>>;
type QueueFailedJobsList = Awaited<ReturnType<typeof getFailedJobs>>;
type QueueFailedJob = QueueFailedJobsList[number];

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

export function toAdminQueueRetryResultDTO(queueName: string, retriedCount: number) {
  return {
    success: true,
    retriedCount,
    message: `Retried ${retriedCount} failed jobs from ${queueName}`,
  };
}

export function toAdminQueuePurgeResultDTO(queueName: string, purgedCount: number) {
  return {
    success: true,
    purgedCount,
    message: `Purged ${purgedCount} failed jobs from ${queueName}`,
  };
}
