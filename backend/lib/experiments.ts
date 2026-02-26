import type { User } from '@app/models/User';
import { Experiment } from '@app/models/Experiment';
import crypto from 'crypto';
import { Cache, createCacheNamespace } from '@lib/cache';

const EXPERIMENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EXPERIMENT_CACHE = createCacheNamespace('experiments');
const EXPERIMENT_CACHE_KEY = 'all';

let experimentCacheLoading: Promise<Map<string, Experiment>> | null = null;
let experimentCacheGeneration = 0;

async function getExperimentMap(): Promise<Map<string, Experiment>> {
  const cached = Cache.get<Map<string, Experiment>>(EXPERIMENT_CACHE, EXPERIMENT_CACHE_KEY);
  if (cached) {
    return cached;
  }

  if (experimentCacheLoading) {
    return experimentCacheLoading;
  }

  const generation = experimentCacheGeneration;
  experimentCacheLoading = Experiment.find()
    .then((experiments) => {
      const map = new Map(experiments.map((e) => [e.key, e]));

      // Discard result if the cache was invalidated while the load was in flight.
      if (experimentCacheGeneration === generation) {
        Cache.set(EXPERIMENT_CACHE, EXPERIMENT_CACHE_KEY, map, EXPERIMENT_CACHE_TTL_MS);
        experimentCacheLoading = null;
        return map;
      }
      // Superseded — clear the loading sentinel so the next caller re-fetches.
      experimentCacheLoading = null;
      return getExperimentMap();
    })
    .catch((err) => {
      // Reset so the next caller can retry rather than receiving the rejected promise forever.
      experimentCacheLoading = null;
      throw err;
    });
  return experimentCacheLoading;
}

export function invalidateExperimentCache(): void {
  experimentCacheGeneration++;
  experimentCacheLoading = null;
  Cache.invalidate(EXPERIMENT_CACHE);
}

function isInRollout(userId: number, key: string, percentage: number): boolean {
  const hash = crypto.createHash('md5').update(`${userId}:${key}`).digest();
  return hash.readUInt16BE(0) % 100 < percentage;
}

function _isEligible(user: User, experiment: Experiment): boolean {
  return (
    experiment.allowedUserIds.includes(user.id) || isInRollout(user.id, experiment.key, experiment.rolloutPercentage)
  );
}

export async function isExperimentActive(user: User, key: string): Promise<boolean> {
  const map = await getExperimentMap();
  const experiment = map.get(key);
  if (!experiment || !experiment.enabled) return false;

  if (experiment.enforced) {
    return _isEligible(user, experiment);
  }

  return user.experimentEnrollments?.some((e) => e.experimentKey === key) ?? false;
}

export async function isUserEligibleForExperiment(user: User, key: string): Promise<boolean> {
  const map = await getExperimentMap();
  const experiment = map.get(key);
  if (!experiment || !experiment.enabled || experiment.enforced) return false;

  return _isEligible(user, experiment);
}

export async function getExperimentsForUser(user: User): Promise<Array<{ experiment: Experiment; active: boolean }>> {
  const map = await getExperimentMap();
  const results: Array<{ experiment: Experiment; active: boolean }> = [];

  for (const experiment of map.values()) {
    if (!experiment.enabled) continue;

    if (experiment.enforced) {
      const active = _isEligible(user, experiment);
      if (active) {
        results.push({ experiment, active: true });
      }
    } else {
      const eligible = _isEligible(user, experiment);
      if (eligible) {
        const active = user.experimentEnrollments?.some((e) => e.experimentKey === experiment.key) ?? false;
        results.push({ experiment, active });
      }
    }
  }

  return results;
}
