CREATE EXTENSION IF NOT EXISTS pgroonga;
------------------------------------------
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
------------------------------------------
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
------------------------------------------
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
  inflected_word TEXT;
BEGIN
  RAISE NOTICE 'Searching for word: %', base_word;
  FOREACH js IN ARRAY pgroonga_tokenize(_text,
    'tokenizer', 'TokenMecab("include_reading", true,
    "use_base_form", true, "include_form", true, "include_class", true)',
    'normalizer', 'NormalizerNFKC100("unify_kana", true)', 
    'normalizer','NormalizerNFKC100("unify_kana_case", true)')
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

    -- Handle specific inflected forms
    RAISE NOTICE 'Type: %', type;
    --- Verb case
    IF(type = '動詞') THEN
    -- TODO: Finish all possible japanese verb conjugation
    --- Recognize type, Ichidan or Godan verb 
        IF inflected_form = '連用形' AND RIGHT(base_form, 1) = 'る' THEN
          inflected_word := LEFT(base_form, LENGTH(base_form) - 1) || 'て';
        ELSE
          inflected_word := base_form;
        END IF;
    ELSE
        inflected_word := base_form;
    END IF;
    possible_highlights := ARRAY[original, inflected_word];
    RETURN NEXT;
  END LOOP;
END;
$func$ LANGUAGE plpgsql IMMUTABLE;