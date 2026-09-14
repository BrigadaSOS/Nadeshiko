import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PatreonRoadmap1787600000000 implements MigrationInterface {
  name = 'PatreonRoadmap1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "RoadmapItem_kind_enum" AS ENUM ('CONTENT', 'FEATURE')`);
    await queryRunner.query(
      `CREATE TYPE "RoadmapItem_status_enum" AS ENUM ('PROPOSED', 'CONSIDERING', 'PLANNED', 'IN_PROGRESS', 'RELEASED', 'DECLINED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "PatreonConnection" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "patreon_user_id" character varying NOT NULL,
        "access_token_ciphertext" text NOT NULL,
        "refresh_token_ciphertext" text NOT NULL,
        "access_token_expires_at" timestamptz NOT NULL,
        "full_name" character varying,
        "campaign_id" character varying,
        "member_id" character varying,
        "patron_status" character varying,
        "entitled_amount_cents" integer NOT NULL DEFAULT 0,
        "membership_checked_at" timestamptz NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "UQ_patreon_connection_user" UNIQUE ("user_id"),
        CONSTRAINT "UQ_patreon_connection_identity" UNIQUE ("patreon_user_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "RoadmapItem" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" "RoadmapItem_kind_enum" NOT NULL,
        "status" "RoadmapItem_status_enum" NOT NULL DEFAULT 'PROPOSED',
        "title" character varying(180) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "source_url" text,
        "cover_url" text,
        "target_date" date,
        "introduced_in_version" character varying(32),
        "sort_order" integer NOT NULL DEFAULT 0,
        "requester_user_id" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "proposer_name" character varying(80),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "UQ_roadmap_item_public_id" UNIQUE ("public_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_roadmap_status_order" ON "RoadmapItem" ("status", "sort_order")`);
    await queryRunner.query(`
      INSERT INTO "RoadmapItem" ("kind", "status", "title", "description", "source_url", "cover_url", "target_date", "sort_order", "proposer_name") VALUES
        ('CONTENT', 'IN_PROGRESS', 'Welcome to the N.H.K.', '', 'https://myanimelist.net/anime/1210/NHK_ni_Youkoso', 'https://cdn.myanimelist.net/images/anime/3/52675.jpg', '2026-09-01', 10, 'keftie'),
        ('CONTENT', 'IN_PROGRESS', 'Hanasaku Iroha', '', 'https://myanimelist.net/anime/9289/Hanasaku_Iroha', 'https://cdn.myanimelist.net/images/anime/1491/117229.jpg', '2026-09-01', 20, 'keftie'),
        ('CONTENT', 'IN_PROGRESS', 'Watamote', '', 'https://myanimelist.net/anime/16742/Watashi_ga_Motenai_no_wa_Dou_Kangaetemo_Omaera_ga_Warui', 'https://cdn.myanimelist.net/images/anime/12/51619.jpg', '2026-09-01', 30, 'keftie'),
        ('CONTENT', 'IN_PROGRESS', 'Serial Experiments Lain', '', 'https://myanimelist.net/anime/339/Serial_Experiments_Lain', 'https://cdn.myanimelist.net/images/anime/1718/91550.jpg', '2026-09-01', 40, 'keftie')
    `);
    await queryRunner.query(`
      INSERT INTO "RoadmapItem" ("kind", "status", "title", "description", "source_url", "cover_url", "target_date", "sort_order", "proposer_name") VALUES
        ('CONTENT', 'RELEASED', 'One Piece', '', 'https://myanimelist.net/anime/21/One_Piece', 'https://cdn.myanimelist.net/images/anime/1244/138851.jpg', '2026-02-01', 10, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'Attack on Titan', '', 'https://myanimelist.net/anime/16498/Shingeki_no_Kyojin', 'https://cdn.myanimelist.net/images/anime/10/47347.jpg', '2026-01-01', 20, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'JoJo’s Bizarre Adventure, Parts 1–3', '', 'https://myanimelist.net/anime/14719/JoJo_no_Kimyou_na_Bouken_TV', 'https://cdn.myanimelist.net/images/anime/3/40409.jpg', '2026-01-01', 30, 'Nadeshiko patreons')
    `);
    await queryRunner.query(`
      INSERT INTO "RoadmapItem" ("kind", "status", "title", "description", "source_url", "cover_url", "target_date", "sort_order", "proposer_name") VALUES
        ('CONTENT', 'RELEASED', 'Odd Taxi', '', 'https://myanimelist.net/anime/46102/Odd_Taxi', 'https://cdn.myanimelist.net/images/anime/1981/113348.jpg', '2026-03-01', 10, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'The Disastrous Life of Saiki K.', '', 'https://myanimelist.net/anime/33255', 'https://cdn.myanimelist.net/images/anime/1973/142750.jpg', '2026-03-01', 20, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'Clannad', '', 'https://nadeshiko.co/search?media=LdaRtuVXSdUX', 'https://cdn.nadeshiko.co/media/2167/cover.webp', '2026-03-01', 30, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'Clannad: After Story', '', 'https://nadeshiko.co/search?media=MRGXvefuSSjf', 'https://cdn.nadeshiko.co/media/4181/cover.webp', '2026-03-01', 40, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'Asobi Asobase', '', 'https://myanimelist.net/anime/37171/Asobi_Asobase', 'https://cdn.myanimelist.net/images/anime/1139/95077.jpg', '2026-05-01', 10, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'The Summer Hikaru Died', '', 'https://myanimelist.net/anime/58913/Hikaru_ga_Shinda_Natsu', 'https://cdn.myanimelist.net/images/anime/1104/148614.jpg', '2026-05-01', 20, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'Bakuman', '', 'https://myanimelist.net/anime/7674/Bakuman', 'https://cdn.myanimelist.net/images/anime/6/26138.jpg', '2026-06-01', 10, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'NIPPON SANGOKU: The Three Nations of the Crimson Sun', '', 'https://anilist.co/anime/206914', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx206914-SHKX08LarRzB.jpg', '2026-06-01', 20, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'Fate/stay night: Unlimited Blade Works — Season 1', '', 'https://myanimelist.net/anime/22297/Fate_stay_night__Unlimited_Blade_Works', 'https://cdn.myanimelist.net/images/anime/12/67333.jpg', '2026-08-01', 10, 'Nadeshiko patreons'),
        ('CONTENT', 'RELEASED', 'The Irregular at Magic High School — additional seasons', '', 'https://myanimelist.net/anime/20785/Mahouka_Koukou_no_Rettousei', 'https://cdn.myanimelist.net/images/anime/11/61039.jpg', '2026-08-01', 20, 'Nadeshiko patreons')
    `);
    await queryRunner.query(`
      INSERT INTO "RoadmapItem" ("kind", "status", "title", "description", "target_date", "sort_order") VALUES
        ('FEATURE', 'IN_PROGRESS', 'Patreon title proposals', 'Patrons can link their membership, propose a title, and follow approved additions on the public roadmap.', NULL, 10),
        ('FEATURE', 'IN_PROGRESS', 'Better search filters', 'Search directly by media name, tags, and other focused filters.', NULL, 20),
        ('FEATURE', 'RELEASED', 'Seven interface languages', 'Nadeshiko expanded beyond English, Spanish, and Japanese with Portuguese, Indonesian, Simplified Chinese, and Traditional Chinese.', '2026-09-13', 20),
        ('FEATURE', 'RELEASED', 'YouTube playback in search', 'YouTube sentences play directly inside results and continue through playlists without leaving Nadeshiko.', '2026-08-25', 40),
        ('FEATURE', 'RELEASED', 'Word cards', 'Click a word in any sentence for readings, definitions, pitch accent, audio, and frequency badges.', '2026-08-19', 50),
        ('FEATURE', 'RELEASED', 'Your own dictionaries', 'Link Shirabe and Nadeshiko uses your ordered dictionary stack, including monolingual and uploaded dictionaries.', '2026-08-19', 60),
        ('FEATURE', 'RELEASED', 'Rich Anki mining', 'Create or update notes with the word, sentence, audio, image, furigana, definitions, and pitch accent.', '2026-08-19', 70),
        ('FEATURE', 'RELEASED', 'Search history and familiar titles', 'Recent searches follow signed-in readers across devices, while favorite and studied titles influence ranking.', '2026-08-19', 80),
        ('FEATURE', 'RELEASED', 'Granular API keys', 'API keys can be read-only, full access, or restricted to explicitly selected permissions.', '2026-08-19', 100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "RoadmapItem"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "PatreonConnection"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "RoadmapItem_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "RoadmapItem_kind_enum"`);
  }
}
