# Sorting by difficulty

Search can order sentences by estimated difficulty: `DIFFICULTY_ASC` (easiest first) and
`DIFFICULTY_DESC` (hardest first), issue #542. It is free for everyone.

Readers were already using "shortest first" as a stand-in for "easy sentences" (it is the most
used non-default sort). Difficulty orders by how rare a sentence's words are and how advanced its
conjugations are, so a short line full of rare words or causative-passives no longer counts as easy.

It does **not** measure speaking speed or which words a particular reader already knows. The tooltip
in the sort menu says so.

## The rule

Code: `app/services/search/segmentDocument/difficulty.ts`.

1. **Content words.** Particles, auxiliaries, punctuation, interjections (感動詞), numbers and
   letterless tokens do not count. Tokens with Shirabe's `kind` use it (`function` and `symbol` are
   skipped). Older tokens without a `kind` fall back to the UniDic part of speech.
2. **Rank.** Each content word is looked up in `WordFrequency` (an anime word-frequency list),
   keeping the lowest rank per key. The rank is the best of:
   - the lemma;
   - the surface form;
   - the kana reading, only when the word is written in kana as its own lemma;
   - for a grouped token, its rarest part.

   If none of those match, these repairs are tried in order (each must leave at least two characters,
   so にぃ is not read as the particle に): drop a trailing elongation
   (ねこー), drop an honorific or plural suffix (さくらちゃん, 貴様ら), map a potential verb to its
   plain form (勝てる → 勝つ), and map three known bad lemmas (なた → なる, あた → ある,
   感ずる → 感じる).
3. **Tier.** `tier = min(62, floor(4 * log2(rank)))`, so there are four tiers per doubling of rank.
   A word with no match counts as a rank-5,000 word (tier 49), not the rarest: most of these are character names,
   which a reader picks up from the show, and counting them as the rarest filled "hardest first" with
   name-heavy lines. Listed proper names are capped the same way: the seed marks entries that are only names
   (in JMnedict but not JMdict, also checking a katakana entry as hiragana so イチゴ stays a word; such as 田中
   or ナルト) and their rank counts as at most 5,000, since how often a
   name occurs says nothing about how hard it is to read. Expressions (連語 such
   as のだ, そうだ, すると) are capped at the tier of rank 5,000, because the list splits them into
   their parts and lists the whole far rarer than the words in it.
4. **Grammar.** A light term on top of the vocabulary: every conjugated token contributes how much longer
   its surface is than its dictionary form (食べさせられた over 食べる is 4 characters, 食べました 2, 食べた 0),
   and the sum, at about 1.7 tiers per character, is added to the second place below, capped at 62. Grammar
   therefore orders sentences within the group their hardest word sets and never moves one into a harder
   group.

   A first version graded Shirabe's inflection labels (〜たら, causative, 〜ていただく…) and let them compete
   with words for the hardest place. In a blind test of 40 pairs it agreed with the reader less often than
   vocabulary alone (3 of 8 decided pairs) because it overweighted causatives and set phrases (行かせない,
   待たせてもらいました, 行ってくる), so it was replaced by this term.
5. **Score.** Take the two hardest *distinct* lemmas: `difficulty = hardest * 64 + second + grammar`,
   where `second` is 0 when there is only one content word. The range is 0–4030, stored as an
   Elasticsearch `short`. Every search result contains the searched word, so this keeps together the
   sentences where only that word is hard and orders them by everything else.
6. **Fragments.** A line is a fragment when it has fewer than two distinct content words (大丈夫！), or
   ends on a comma, or ends on a case or binding particle (が, を, に, へ, で, と, は, も) without a closing
   `?` or `!`, which is usually a sentence cut across subtitle cues (記録上 あの子は幼いころに). With the mark
   it is an inverted or elliptical sentence and is kept (何を?, なんだ… これは!, 学校で!). Sentence-final and
   conjunctive particles (よ, ね, か, から, けど) end real lines and do not count. There is no minimum length:
   on staging a six-distinct-character threshold mostly caught short full sentences (ただの無謀だ). Indexed as
   `fragment` (`byte`, 1 or 0).
7. **Sort.** `fragment` ascending in both directions (full sentences first), then `difficulty`, then
   `characterCount` in the same direction, then the usual tie-breakers
   (`mediaId`, `episode`, `position`). Difficulty sorts are explicit sorts, so there is no rounds-by-title
   diversification and `preferMedia` is ignored.

## Unscored segments

A segment with no tokens or no content word gets no `difficulty` field, and without tokens no
`fragment` either. The sort treats a missing `fragment` as 1 and sets an explicit `difficulty`
`missing` value (32767 ascending, -1 descending), so these segments come last in both directions.
Do not use `_last`: Elasticsearch returns it as Long.MAX/MIN, which a JSON number cannot carry,
and that breaks the keyset cursor. Both fields also have an `unmapped_type`, so an index that
predates them still sorts. `fragment` is a number rather than a boolean for the same reason: its
sort value goes into the cursor.

When `WordFrequency` is empty (it was never seeded), every segment is indexed without a difficulty
instead of every word counting as unknown.

## Operations

- **Reseeding `WordFrequency` requires a full reindex.** Difficulty is computed when a segment is
  indexed, from the list as loaded at that moment. A long-running server reloads the list at most
  once an hour, for segments it indexes afterwards. Run `scripts/seed-word-frequency.ts`, then
  `npm run es:reindex` (or `scripts/remote-db.sh <env> reindex`).
- The seed stores the list's `Form` column in `WordFrequency.form` (migration `1790300000000`). The kana
  reading fallback needs it.
- The seed also downloads JMnedict and JMdict from EDRDG (about 23 MB, CC BY-SA 4.0) to set
  `WordFrequency.is_name`. On the current list that marks about 43,000 entries, almost all past rank 20,000.
- `difficulty` and `fragment` are in `ADDITIVE_MAPPING_FIELDS`, so a live index gets the mapping at boot. Documents
  only get values once they are indexed again, so a full reindex is what makes the sort useful.

## Measurements (staging, 2026-11-13)

Measured read-only on a 50,000-segment sample of ACTIVE segments.

| | Content-token match | Sentences with an unknown word |
|---|---|---|
| Lemma only | 94.0% | — |
| Lemma, surface, reading | 95.4% | 16.2% |
| With the repairs above | 97.7% | 8.3% |

No ACTIVE segment was untokenized. The remaining unknown words are mostly character names, laughs,
and single Latin letters. Counting unknown words as the rarest put mostly
name-heavy lines at the hardest end of `DIFFICULTY_DESC`, which is why they now count as rank 5,000.
Names the list does include (at rank 40k and beyond) still read as rare; skipping proper nouns outright
would need UniDic's POS subcategory, which the stored tokens no longer carry.

## Blind test (2026-11-14)

The operator judged 40 pairs of full sentences from staging that share the searched word, without seeing
any score. Against "shortest first", this order agreed on 8 of 13 decided pairs and length on 5 (7 were
"about the same"). That is the direction we want, on too few pairs to be conclusive.
