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
