import type { User } from '@app/models/User';
import { Experiment } from '@app/models/Experiment';
import crypto from 'crypto';

// --- Cache ---

const EXPERIMENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let experimentCacheMap: Map<string, Experiment> | null = null;
let experimentCacheExpiresAt = 0;
let experimentCacheLoading: Promise<Map<string, Experiment>> | null = null;
// Incremented on invalidation so any in-flight load discards its result rather
// than overwriting the cache after it was intentionally cleared.
let experimentCacheGeneration = 0;

async function getExperimentMap(): Promise<Map<string, Experiment>> {
  if (experimentCacheMap && Date.now() < experimentCacheExpiresAt) {
    return experimentCacheMap;
  }
  if (experimentCacheLoading) {
    return experimentCacheLoading;
  }
  const generation = experimentCacheGeneration;
  experimentCacheLoading = Experiment.find()
    .then((experiments) => {
      // Discard result if the cache was invalidated while the load was in flight.
      if (experimentCacheGeneration === generation) {
        experimentCacheMap = new Map(experiments.map((e) => [e.key, e]));
        experimentCacheExpiresAt = Date.now() + EXPERIMENT_CACHE_TTL_MS;
        experimentCacheLoading = null;
        return experimentCacheMap;
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

/** Invalidate the experiment cache — call in tests after inserting rows. */
export function invalidateExperimentCache(): void {
  experimentCacheGeneration++;
  experimentCacheMap = null;
  experimentCacheExpiresAt = 0;
  experimentCacheLoading = null;
}

// --- Rollout ---

function isInRollout(userId: number, key: string, percentage: number): boolean {
  const hash = crypto.createHash('md5').update(`${userId}:${key}`).digest();
  return hash.readUInt16BE(0) % 100 < percentage;
}

function _isEligible(user: User, experiment: Experiment): boolean {
  return (
    experiment.allowedUserIds.includes(user.id) || isInRollout(user.id, experiment.key, experiment.rolloutPercentage)
  );
}

// --- Public API ---

/**
 * Is this experiment currently active for the user?
 *
 * For enforced experiments (flags): active if enabled AND (in rollout OR in allowedUserIds).
 * For non-enforced experiments (labs): active only if user explicitly enrolled.
 */
export async function isExperimentActive(user: User, key: string): Promise<boolean> {
  const map = await getExperimentMap();
  const experiment = map.get(key);
  if (!experiment || !experiment.enabled) return false;

  if (experiment.enforced) {
    return _isEligible(user, experiment);
  }

  return user.experimentEnrollments?.some((e) => e.experimentKey === key) ?? false;
}

/**
 * Can this user see and enroll in this lab?
 * Returns false for enforced experiments — those are never user-controllable.
 */
export async function isUserEligibleForExperiment(user: User, key: string): Promise<boolean> {
  const map = await getExperimentMap();
  const experiment = map.get(key);
  if (!experiment || !experiment.enabled || experiment.enforced) return false;

  return _isEligible(user, experiment);
}

/**
 * Returns all experiments the user can see (eligible labs) or that are
 * active for them (enforced flags), paired with their active state.
 * Used by the listUserLabs controller to build the API response.
 */
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
