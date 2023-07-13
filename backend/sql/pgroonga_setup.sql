CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE OR REPLACE FUNCTION get_variations(_text TEXT, _word TEXT)
RETURNS TABLE (
  original TEXT,
  reading TEXT,
  full_reading TEXT,
  base_form TEXT,
  inflected_type TEXT,
  inflected_form TEXT,
  possible_highlights text[]
) AS
$func$
DECLARE
  js JSON;
  base_word TEXT := get_base_form(_word);
  expanded_word1 TEXT := SPLIT_PART(ja_expand(base_word), ' OR ', 1);
  expanded_word2 TEXT := SPLIT_PART(ja_expand(base_word), ' OR ', 2);
  value TEXT;
  type TEXT;
  inflected_word TEXT[];
BEGIN
  RAISE NOTICE 'Searching for word: %', base_word;
  FOREACH js IN ARRAY pgroonga_tokenize(_text,
    'tokenizer', 'TokenMecab("include_reading", true,
    "use_base_form", true, "include_form", true, "include_class", true)',
      'normalizer', 'NormalizerNFKC100("unify_kana", true)', 'normalizer','NormalizerNFKC100("unify_kana_case", true)')
  LOOP
    RAISE NOTICE 'JS: %', js::text;

    value := js -> 'metadata' ->> 'base_form';
    RAISE NOTICE 'Base form value: %', value;
    IF value IS NULL OR (value != base_word AND value != expanded_word1 AND value != expanded_word2) THEN
      RAISE NOTICE 'Skipping value: %', value;
      CONTINUE;
    END IF;

    original := _word;
    reading := js -> 'metadata' ->> 'reading';
    full_reading := ja_reading(_word);
    inflected_type := js -> 'metadata' ->> 'inflected_type';
    inflected_form := js -> 'metadata' ->> 'inflected_form';
    base_form := js -> 'metadata' ->> 'base_form';
    type := js  -> 'metadata' ->> 'class';

    RAISE NOTICE 'Type: %', type;
    ---------------------------------------------
    -- Handle specific inflected forms
    -- Verb case
    IF(type = '動詞') THEN
        -- Ichidan
        if(inflected_type = '一段') THEN
            --| 〜た (PAST, PLAIN)
            --| 〜て form
            IF(inflected_form = '連用形') THEN
                -- Verbs ending in 〜る change to 〜た
                -- Verbs ending in 〜る change to 〜て
                -- Some cases doesn't have 〜る
                IF(RIGHT(base_form, 1) = 'る') THEN
                  inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'た', LEFT(base_form, LENGTH(base_form) - 1) || 'て', LEFT(base_form, LENGTH(base_form) - 1) ];
                END IF;

            --| 〜よう (VOLITIONAL)
            ELSEIF(inflected_form = '未然ウ接続') THEN
                IF(RIGHT(base_form, 1) = 'る') THEN
                  inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'よう'];
                END IF;

            --| 〜ない (NEGATIVE, PLAIN)
            ELSEIF(inflected_form = '未然形') THEN
                -- Verbs ending in 〜る change to 〜ない
                -- There is no negative but 〜れる (POTENTIAL) has wrong inflected_form, therefore if verb ends in 〜る change to with 〜られる / 〜れる
                -- Some cases doesn't have 〜る or use Kansai dialect
                -- There are abbreviated verbs that ends in 〜な
                IF(RIGHT(base_form, 1) = 'る') THEN
                  inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'ない', LEFT(base_form, LENGTH(base_form) - 1), LEFT(base_form, LENGTH(base_form) - 1) || 'られる', LEFT(base_form, LENGTH(base_form) - 1) || 'れる', LEFT(base_form, LENGTH(base_form) - 1) || 'な' ];
                END IF;

            --| 〜ば (CONDITIONAL)
            ELSEIF(inflected_form like '仮定形') THEN
                -- Verbs ending in 〜る change to 〜れば
                IF(RIGHT(base_form, 1) = 'る') THEN
                  inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'れば' ];
                END IF;

            --| 〜ろ (COMMAND FORM)
            ELSEIF(inflected_form like '命令ｒｏ') THEN
                -- Verbs ending in 〜る change to 〜ろ
                IF(RIGHT(base_form, 1) = 'る') THEN
                  inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'ろ' ];
                END IF;

            END IF;
        -- Godan
        ELSEIF(inflected_type  like '%五段%') THEN
            RAISE NOTICE '%', inflected_type;
            -- Part one: base form + godan case
            -- Part two: verbal times (TODO)
            -- Refer to this video for more details about godan conjugation: https://www.youtube.com/watch?v=FhyrskGBKHE
            IF(RIGHT(base_form, 1) = 'う') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'い',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'わ',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'え',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'お'];
            ELSEIF(RIGHT(base_form, 1) = 'く') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'き',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'か',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'け',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'こ'];
            ELSEIF(RIGHT(base_form, 1) = 'す') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'し',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'さ',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'せ',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'そ'];
            ELSEIF(RIGHT(base_form, 1) = 'つ') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'ち',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'た',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'て',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'と'];
            ELSEIF(RIGHT(base_form, 1) = 'ぬ') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'に',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'な',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'ね',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'の'];
            ELSEIF(RIGHT(base_form, 1) = 'ぶ') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'び',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'ば',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'べ',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'ぼ'];
            ELSEIF(RIGHT(base_form, 1) = 'む') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'み',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'ま',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'め',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'も'];
            ELSEIF(RIGHT(base_form, 1) = 'る') THEN
                inflected_word := ARRAY[LEFT(base_form, LENGTH(base_form) - 1) || 'り',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'ら',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'れ',
                                        LEFT(base_form, LENGTH(base_form) - 1) || 'ろ'];
            END IF;
        ELSE
            inflected_word := ARRAY[base_form];
        END IF;
    ELSE
            inflected_word := ARRAY[base_form];
    END IF;

    possible_highlights := array_cat(ARRAY[original], inflected_word);
    RETURN NEXT;
  END LOOP;
END;
$func$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION get_base_form(_word TEXT)
RETURNS TEXT AS
$func$
DECLARE
  js JSON;
  value TEXT;
BEGIN
  FOREACH js IN ARRAY pgroonga_tokenize(_word,
    'tokenizer', 'TokenMecab("include_reading", true,
    "use_base_form", true, "include_form", true)')
  LOOP
    value := js -> 'metadata' ->> 'base_form';
    IF value IS NOT NULL THEN
      RETURN value;
    END IF;
  END LOOP;
  RETURN _word; -- return the original word if no base form is found
END;
$func$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ja_reading (TEXT) RETURNS TEXT AS
$func$
DECLARE
  js      JSON;
  total   TEXT[] := '{}';
  reading TEXT;
BEGIN
  FOREACH js IN ARRAY pgroonga_tokenize($1,
    'tokenizer', 'TokenMecab("include_reading", true)')
  LOOP
    reading = (js -> 'metadata' ->> 'reading');

    IF reading IS NULL THEN
      total = total || (js ->> 'value');
    ELSE
      total = total || reading;
    END IF;
  END LOOP;

  RETURN array_to_string(total, '');
END;
$func$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ja_expand (TEXT) RETURNS TEXT AS
$func$
BEGIN
  IF $1 ~ '[\u4e00-\u9fa5]' THEN
    RETURN  $1||' OR '||ja_reading($1);
  END IF;

  RETURN $1;
END;
$func$ LANGUAGE plpgsql IMMUTABLE;

CREATE INDEX pgroonga_tag_index
    ON nadedb.public."Segment"
    USING pgroonga (content)
    WITH (tokenizer='TokenMecab("use_base_form", true, "include_form", true, "include_reading", true)',
    normalizers='
        NormalizerNFKC100("unify_kana", true),
         NormalizerNFKC100("unify_kana_case", true)
    ');

CREATE INDEX idx_tatoeba_jpn_base_form ON nadedb.public."Segment"
  USING pgroonga ((content || ''))
  WITH (
    tokenizer='TokenMecab("use_base_form", true)',
    normalizer='NormalizerNFKC100("unify_kana", true),
                NormalizerNFKC100("unify_kana_case", true)'
  );

CREATE INDEX idx_tatoeba_jpn_reading ON nadedb.public."Segment"
  USING pgroonga ((content || '' || ''))
  WITH (
    tokenizer='TokenMecab("use_reading", true)',
    normalizer='NormalizerNFKC100("unify_kana", true),
                NormalizerNFKC100("unify_kana_case", true)    '
  );

WITH Variations AS (
    SELECT DISTINCT ON (s.content, s.uuid) variations.possible_highlights, s.*, ep.number as "episode", se.number as "season", me.english_name, me.japanese_name, me.folder_media_name, me.id as media_id
    FROM nadedb.public."Segment" s
    INNER JOIN nadedb.public."Episode" ep ON s."episodeId" = ep.id
    INNER JOIN nadedb.public."Season" se ON ep."seasonId" = se.id
    INNER JOIN nadedb.public."Media" me ON se."mediaId" = me.id,
    LATERAL get_variations(s.content, '飯') as variations
    WHERE (((s.content || '' )) &@~ ja_expand('飯')
     OR (s.content || '' || '') &@~ ja_expand('飯')) --and (s.content &@~ '身の程わきまえて 生きろよ')
)
SELECT pgroonga_highlight_html(v.content,
                               v.possible_highlights) as content_highlight, v.*
FROM Variations v;