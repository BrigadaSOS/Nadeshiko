import { User } from '@app/models/User';
import { Media } from '@app/models/Media';
import { Episode } from '@app/models/Episode';
import { Series } from '@app/models/Series';
import { SeriesMedia } from '@app/models/SeriesMedia';
import { Seiyuu } from '@app/models/Seiyuu';
import { Character } from '@app/models/Character';
import { MediaCharacter } from '@app/models/MediaCharacter';
import { UserActivity } from '@app/models/UserActivity';
import { FIXTURE_SETS, isFixtureRef, type FixtureCatalog, type FixtureEntityKey, type FixtureSetName } from './catalog';

export type { SeedInput } from './catalog';

export interface LoadedFixtures {
  users: Record<string, User>;
  media: Record<string, Media>;
  episodes: Record<string, Episode>;
  series: Record<string, Series>;
  seriesMedia: Record<string, SeriesMedia>;
  seiyuu: Record<string, Seiyuu>;
  characters: Record<string, Character>;
  mediaCharacters: Record<string, MediaCharacter>;
  activities: Record<string, UserActivity>;
}

const INSERT_ORDER: FixtureEntityKey[] = [
  'users',
  'media',
  'episodes',
  'series',
  'seiyuu',
  'characters',
  'seriesMedia',
  'mediaCharacters',
  'activities',
];

// biome-ignore format: keep aligned
const ENTITY_CLASSES: Record<FixtureEntityKey, new () => { save(): Promise<unknown> }> = {
  users:           User,
  media:           Media,
  episodes:        Episode,
  series:          Series,
  seriesMedia:     SeriesMedia,
  seiyuu:          Seiyuu,
  characters:      Character,
  mediaCharacters: MediaCharacter,
  activities:      UserActivity,
};

function emptyLoadedFixtures(): LoadedFixtures {
  return { users: {}, media: {}, episodes: {}, series: {}, seriesMedia: {}, seiyuu: {}, characters: {}, mediaCharacters: {}, activities: {} };
}

function mergeFixtureSets(setNames: readonly FixtureSetName[]): FixtureCatalog {
  const merged: FixtureCatalog = {};

  for (const setName of setNames) {
    const set = FIXTURE_SETS[setName] as FixtureCatalog;
    if (!set) throw new Error(`Unknown fixture set: ${setName}`);

    for (const entityKey of INSERT_ORDER) {
      const incoming = set[entityKey];
      if (!incoming) continue;

      const target = (merged[entityKey] ??= {});
      for (const [name, payload] of Object.entries(incoming)) {
        if (name in target) throw new Error(`Duplicate fixture key '${entityKey}.${name}' in set '${setName}'`);
        (target as Record<string, unknown>)[name] = payload;
      }
    }
  }

  return merged;
}

function lookupFixtureRef(path: string, fixtures: LoadedFixtures): unknown {
  const [entityKey, fixtureName, ...fieldPath] = path.split('.');
  if (!entityKey || !fixtureName) throw new Error(`Invalid fixture ref '${path}'. Expected '<entity>.<name>[.field]'`);

  const entityFixtures = fixtures[entityKey as keyof LoadedFixtures] as Record<string, unknown> | undefined;
  if (!entityFixtures) throw new Error(`Unknown fixture entity '${entityKey}' in ref '${path}'`);

  let value: unknown = entityFixtures[fixtureName];
  if (value === undefined) throw new Error(`Fixture ref '${path}' not found: '${entityKey}.${fixtureName}'`);

  for (const field of fieldPath) {
    if (typeof value !== 'object' || value === null) throw new Error(`Invalid fixture ref '${path}' at '${field}'`);
    value = (value as Record<string, unknown>)[field];
  }

  return value;
}

function resolveFixtureRefs(value: unknown, fixtures: LoadedFixtures): unknown {
  if (isFixtureRef(value)) return lookupFixtureRef(value.__fixtureRef, fixtures);
  if (Array.isArray(value)) return value.map((item) => resolveFixtureRefs(item, fixtures));
  if (typeof value === 'object' && value !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) resolved[key] = resolveFixtureRefs(item, fixtures);
    return resolved;
  }
  return value;
}

async function saveEntity(entityKey: FixtureEntityKey, payload: Record<string, unknown>) {
  const entity = Object.assign(new ENTITY_CLASSES[entityKey](), payload);
  await entity.save();
  return entity;
}

export async function loadFixtures(
  setNames: readonly FixtureSetName[],
  preloaded?: Partial<LoadedFixtures>,
): Promise<LoadedFixtures> {
  const merged = mergeFixtureSets(setNames);
  const loaded = emptyLoadedFixtures();

  if (preloaded) {
    for (const [key, records] of Object.entries(preloaded)) {
      Object.assign(loaded[key as keyof LoadedFixtures], records);
    }
  }

  for (const entityKey of INSERT_ORDER) {
    const records = merged[entityKey];
    if (!records) continue;

    for (const [name, payload] of Object.entries(records)) {
      const resolvedPayload = resolveFixtureRefs(payload, loaded) as Record<string, unknown>;
      (loaded[entityKey] as Record<string, unknown>)[name] = await saveEntity(entityKey, resolvedPayload);
    }
  }

  return loaded;
}
