# Character & Seiyuu Generated IDs Implementation Plan

**Goal:** Replace AniList IDs as primary keys on `Character` and `Seiyuu` with auto-generated IDs, storing AniList IDs in an `externalIds` JSONB field.

**Architecture:** Since the DB is dropped and recreated from migrations on every test run, we can make a clean breaking change: update the initial schema migration to use `SERIAL` PKs and `external_ids` JSONB on `Seiyuu` and `Character` from the start. No FK remapping migration needed. Then update models, OpenAPI schemas, upsert logic, and fixtures.

**Tech Stack:** TypeORM migrations (raw SQL), TypeScript, OpenAPI YAML, Bun test runner.

---

## Task 1: Update the initial schema migration

**File:** `db/migrations/1706150400000-initial-schema.ts`

Replace the `Seiyuu` and `Character` table definitions. Change `"id" integer PRIMARY KEY` to `"id" SERIAL PRIMARY KEY` and add `"external_ids" jsonb NOT NULL DEFAULT '{}'` to both.

**Seiyuu** (replace existing block):
```sql
CREATE TABLE "Seiyuu" (
  "id" SERIAL PRIMARY KEY,
  "external_ids" jsonb NOT NULL DEFAULT '{}',
  "name_japanese" varchar NOT NULL,
  "name_english" varchar NOT NULL,
  "image_url" varchar NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp
);
```

Add a unique expression index after the table:
```sql
CREATE UNIQUE INDEX "IDX_Seiyuu_anilist_id"
ON "Seiyuu" ((external_ids->>'anilist'))
WHERE external_ids->>'anilist' IS NOT NULL;
```

**Character** (replace existing block):
```sql
CREATE TABLE "Character" (
  "id" SERIAL PRIMARY KEY,
  "external_ids" jsonb NOT NULL DEFAULT '{}',
  "name_japanese" varchar NOT NULL,
  "name_english" varchar NOT NULL,
  "image_url" varchar NOT NULL,
  "seiyuu_id" integer NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp,
  CONSTRAINT "Character_seiyuu_fkey" FOREIGN KEY ("seiyuu_id") REFERENCES "Seiyuu"("id")
);
```

Add a unique expression index after the table:
```sql
CREATE UNIQUE INDEX "IDX_Character_anilist_id"
ON "Character" ((external_ids->>'anilist'))
WHERE external_ids->>'anilist' IS NOT NULL;
```

Also update the `down()` method to drop these two new indexes:
```typescript
await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Character_anilist_id";`);
await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Seiyuu_anilist_id";`);
```
(before dropping the tables)

---

## Task 2: Update TypeORM models

**Files:**
- Modify: `app/models/Seiyuu.ts`
- Modify: `app/models/Character.ts`

**Seiyuu.ts:**
```typescript
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Character } from './Character';

@Entity('Seiyuu')
export class Seiyuu extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'external_ids', type: 'jsonb', default: {} })
  externalIds!: Record<string, string>;

  @Column({ name: 'name_japanese', type: 'varchar' })
  nameJapanese!: string;

  @Column({ name: 'name_english', type: 'varchar' })
  nameEnglish!: string;

  @Column({ name: 'image_url', type: 'varchar' })
  imageUrl!: string;

  @OneToMany('Character', 'seiyuu')
  characters!: Character[];
}
```

**Character.ts:**
```typescript
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Seiyuu } from './Seiyuu';
import type { MediaCharacter } from './MediaCharacter';

@Entity('Character')
export class Character extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'external_ids', type: 'jsonb', default: {} })
  externalIds!: Record<string, string>;

  @Column({ name: 'name_japanese', type: 'varchar' })
  nameJapanese!: string;

  @Column({ name: 'name_english', type: 'varchar' })
  nameEnglish!: string;

  @Column({ name: 'image_url', type: 'varchar' })
  imageUrl!: string;

  @ManyToOne('Seiyuu', 'characters', { cascade: true })
  @JoinColumn({ name: 'seiyuu_id' })
  seiyuu!: Seiyuu;

  @OneToMany('MediaCharacter', 'character')
  mediaAppearances!: MediaCharacter[];
}
```

---

## Task 3: Update OpenAPI schemas

**Files:**
- Modify: `docs/openapi/components/schemas/Character.yaml`
- Modify: `docs/openapi/components/schemas/Seiyuu.yaml`
- Modify: `docs/openapi/components/schemas/CharacterInput.yaml`
- Modify: `docs/openapi/paths/media/v1_media_characters_id.yaml`
- Modify: `docs/openapi/paths/media/v1_media_seiyuu_id.yaml`

**Character.yaml:**
```yaml
type: object
description: Anime character
required:
  - id
  - externalIds
  - nameJa
  - nameEn
  - imageUrl
properties:
  id:
    type: integer
    description: Internal character ID
    example: 1
  externalIds:
    $ref: "./ExternalId.yaml"
  nameJa:
    type: string
    example: "真城最高"
  nameEn:
    type: string
    example: "Moritaka Mashiro"
  imageUrl:
    type: string
    format: uri
    example: "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg"
```

**Seiyuu.yaml:**
```yaml
type: object
description: Japanese voice actor (seiyuu)
required:
  - id
  - externalIds
  - nameJa
  - nameEn
  - imageUrl
properties:
  id:
    type: integer
    description: Internal seiyuu ID
    example: 1
  externalIds:
    $ref: "./ExternalId.yaml"
  nameJa:
    type: string
    example: "阿部敦"
  nameEn:
    type: string
    example: "Atsushi Abe"
  imageUrl:
    type: string
    format: uri
    example: "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
```

**CharacterInput.yaml** — replace flat `id`/`seiyuuId`/`seiyuu*` fields with `externalIds` + nested `seiyuu`:
```yaml
type: object
description: Character data for creating/updating media
required:
  - externalIds
  - nameJa
  - nameEn
  - imageUrl
  - role
  - seiyuu
properties:
  externalIds:
    $ref: "./ExternalId.yaml"
  nameJa:
    type: string
    example: "真城最高"
  nameEn:
    type: string
    example: "Moritaka Mashiro"
  imageUrl:
    type: string
    format: uri
    example: "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg"
  role:
    type: string
    enum: [MAIN, SUPPORTING, BACKGROUND]
    example: "MAIN"
  seiyuu:
    type: object
    required:
      - externalIds
      - nameJa
      - nameEn
      - imageUrl
    properties:
      externalIds:
        $ref: "./ExternalId.yaml"
      nameJa:
        type: string
        example: "阿部敦"
      nameEn:
        type: string
        example: "Atsushi Abe"
      imageUrl:
        type: string
        format: uri
        example: "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
```

Update the `id` parameter description in both path files (remove "AniList character/staff ID", replace with "Internal character/seiyuu ID").

Run codegen:
```
bun run generate:all
```

---

## Task 4: Update mappers

**Files:**
- Modify: `app/controllers/mappers/shared.mapper.ts`
- Modify: `app/controllers/mappers/media.mapper.ts`

**shared.mapper.ts** — add `externalIds` to both DTOs. The existing `toExternalIdMap` helper works for `MediaExternalId[]` arrays; for JSONB we can cast directly since the shape matches `t_ExternalId`:

```typescript
export const toSeiyuuDTO = (seiyuu: Seiyuu): t_Seiyuu => ({
  id: seiyuu.id,
  externalIds: seiyuu.externalIds as t_ExternalId,
  nameJa: seiyuu.nameJapanese,
  nameEn: seiyuu.nameEnglish,
  imageUrl: seiyuu.imageUrl,
});

export const toCharacterDTO = (character: Character): t_Character => ({
  id: character.id,
  externalIds: character.externalIds as t_ExternalId,
  nameJa: character.nameJapanese,
  nameEn: character.nameEnglish,
  imageUrl: character.imageUrl,
});
```

**media.mapper.ts** — delete `toCharacterEntity`. The upsert logic moves into the controller (Task 5).

---

## Task 5: Update media controller upsert logic

**File:** `app/controllers/mediaController.ts`

Replace `toCharacterEntity` usage with a new async helper. Add `Seiyuu` and `Character` to imports.

```typescript
async function upsertCharactersForMedia(
  manager: EntityManager,
  mediaId: number,
  characters: t_CharacterInput[],
): Promise<MediaCharacter[]> {
  return Promise.all(
    characters.map(async (char) => {
      // Upsert Seiyuu by externalIds.anilist
      let seiyuu = await manager
        .createQueryBuilder(Seiyuu, 's')
        .where(`s.external_ids->>'anilist' = :id`, { id: char.seiyuu.externalIds.anilist })
        .getOne();
      if (!seiyuu) {
        seiyuu = manager.create(Seiyuu, {
          externalIds: char.seiyuu.externalIds,
          nameJapanese: char.seiyuu.nameJa,
          nameEnglish: char.seiyuu.nameEn,
          imageUrl: char.seiyuu.imageUrl,
        });
        await manager.save(seiyuu);
      } else {
        await manager.update(Seiyuu, seiyuu.id, {
          nameJapanese: char.seiyuu.nameJa,
          nameEnglish: char.seiyuu.nameEn,
          imageUrl: char.seiyuu.imageUrl,
        });
      }

      // Upsert Character by externalIds.anilist
      let character = await manager
        .createQueryBuilder(Character, 'c')
        .where(`c.external_ids->>'anilist' = :id`, { id: char.externalIds.anilist })
        .getOne();
      if (!character) {
        character = manager.create(Character, {
          externalIds: char.externalIds,
          nameJapanese: char.nameJa,
          nameEnglish: char.nameEn,
          imageUrl: char.imageUrl,
          seiyuu,
        });
        await manager.save(character);
      } else {
        await manager.update(Character, character.id, {
          nameJapanese: char.nameJa,
          nameEnglish: char.nameEn,
          imageUrl: char.imageUrl,
          seiyuu,
        });
      }

      return manager.create(MediaCharacter, {
        mediaId,
        characterId: character.id,
        role: char.role as CharacterRole,
      });
    }),
  );
}
```

Replace usages of `toCharacterEntity` in both `createMedia` and `updateMedia` with calls to `upsertCharactersForMedia`. Both already run inside a transaction via `AppDataSource.transaction`, so pass the `manager` through.

---

## Task 6: Update fixtures

**File:** `tests/fixtures/catalog/index.ts`

Remove explicit `id` fields from all `seiyuu` and `character` fixture entries. Add `externalIds`. Delete the ID allocation comment block entirely.

```typescript
seiyuu: {
  saori: {
    nameJapanese: '早見沙織',
    nameEnglish: 'Saori Hayami',
    externalIds: { anilist: '95991' },
    imageUrl: 'https://example.com/saori.jpg',
  },
},
characters: {
  yor: {
    nameJapanese: 'ヨル',
    nameEnglish: 'Yor',
    externalIds: { anilist: '14545' },
    imageUrl: 'https://example.com/yor.jpg',
    seiyuu: ref('seiyuu.saori'),
  },
},
```

Apply the same pattern to `seiyuuNoCharacters` and `characterNoAppearances` fixture sets.

---

## Task 7: Run tests and fix remaining failures

```
bun test
```

Expected failures will be in `characterController.test.ts` and `seiyuuController.test.ts` due to generated type changes (`t_CharacterInput` now has `externalIds` + nested `seiyuu` instead of flat fields). Fix any assertions referencing the old field names.

---

## Task 8: Commit

```
jj commit -m "feat: use generated IDs for Character and Seiyuu, store AniList ID in externalIds"
```
