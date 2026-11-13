# Sorting by difficulty

Search can order sentences by estimated difficulty: `DIFFICULTY_ASC` (easiest first) and
`DIFFICULTY_DESC` (hardest first), issue #542. It is free for everyone.

Readers were already using "shortest first" as a stand-in for "easy sentences" (it is the most
used non-default sort). Difficulty orders by how rare a sentence's words are, so a short line
full of rare words no longer counts as easy.

It measures **vocabulary rarity only**. It does not know about grammar, speaking speed, or which
words a particular reader already knows. The tooltip in the sort menu says so.

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

   If none of those match, these repairs are tried in order: drop a trailing elongation
   (ねこー), drop an honorific or plural suffix (さくらちゃん, 貴様ら), map a potential verb to its
   plain form (勝てる → 勝つ), and map three known bad lemmas (なた → なる, あた → ある,
   感ずる → 感じる).
3. **Tier.** `tier = min(62, floor(4 * log2(rank)))`, so there are four tiers per doubling of rank.
   A word with no match counts as a rank-5,000 word (tier 49), not the rarest: most of these are character names,
   which a reader picks up from the show, and counting them as the rarest filled "hardest first" with
   name-heavy lines. Expressions (連語 such
   as のだ, そうだ, すると) are capped at the tier of rank 5,000, because the list splits them into
   their parts and lists the whole far rarer than the words in it.
4. **Score.** Take the two hardest *distinct* lemmas: `difficulty = hardest * 64 + second`, where
   `second` is 0 when there is only one content word. The range is 0–4030, stored as an
   Elasticsearch `short`. Every search result contains the searched word, so this keeps together the
   sentences where only that word is hard and orders them by everything else.
5. **Sort.** `difficulty`, then `characterCount` in the same direction, then the usual tie-breakers
   (`mediaId`, `episode`, `position`). Difficulty sorts are explicit sorts, so there is no rounds-by-title
   diversification and `preferMedia` is ignored.

## Unscored segments

A segment with no tokens or no content word gets no `difficulty` field. The sort sets an explicit
`missing` value (32767 ascending, -1 descending), so these segments come last in both directions.
Do not use `_last`: Elasticsearch returns it as Long.MAX/MIN, which a JSON number cannot carry,
and that breaks the keyset cursor. The field also has `unmapped_type: 'short'`, so an index that
predates the field still sorts.

When `WordFrequency` is empty (it was never seeded), every segment is indexed without a difficulty
instead of every word counting as unknown.

## Operations

- **Reseeding `WordFrequency` requires a full reindex.** Difficulty is computed when a segment is
  indexed, from the list as loaded at that moment. A long-running server reloads the list at most
  once an hour, for segments it indexes afterwards. Run `scripts/seed-word-frequency.ts`, then
  `npm run es:reindex` (or `scripts/remote-db.sh <env> reindex`).
- The seed stores the list's `Form` column in `WordFrequency.form` (migration `1790300000000`). The kana
  reading fallback needs it.
- `difficulty` is in `ADDITIVE_MAPPING_FIELDS`, so a live index gets the mapping at boot. Documents
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
