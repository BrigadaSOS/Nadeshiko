import type { MigrationInterface, QueryRunner } from 'typeorm';

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

const JAPANESE_RE = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uff9f]/;

function hasJapaneseChars(text: string): boolean {
  return JAPANESE_RE.test(text);
}

export class AddMediaSlug1742800000000 implements MigrationInterface {
  name = 'AddMediaSlug1742800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Media" ADD COLUMN "slug" VARCHAR`);

    const media: { id: number; romaji_name: string; english_name: string }[] = await queryRunner.query(
      `SELECT id, romaji_name, english_name FROM "Media" ORDER BY id ASC`,
    );

    const usedSlugs = new Map<string, number>();

    for (const row of media) {
      const romaji = row.romaji_name;
      const baseName = romaji && !hasJapaneseChars(romaji) ? romaji : row.english_name;
      const baseSlug = slugify(baseName);

      const count = usedSlugs.get(baseSlug) ?? 0;
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      usedSlugs.set(baseSlug, count + 1);

      await queryRunner.query(`UPDATE "Media" SET "slug" = $1 WHERE "id" = $2`, [slug, row.id]);
    }

    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "slug" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_Media_slug" ON "Media" ("slug")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_Media_slug"`);
    await queryRunner.query(`ALTER TABLE "Media" DROP COLUMN "slug"`);
  }
}
