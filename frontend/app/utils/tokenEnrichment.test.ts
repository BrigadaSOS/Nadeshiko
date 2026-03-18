import { describe, it, expect } from 'vitest';
import { enrichTokens, type SlimToken } from './tokenEnrichment';

// Helper: clean null fields from DB-extracted fixtures (Sudachi stores nulls for missing pos fields)
function t(token: Record<string, unknown>): SlimToken {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(token)) {
    if (v !== null) clean[k] = v;
  }
  return clean as unknown as SlimToken;
}

// All fixtures below are real Sudachi C-mode tokenizations from the Nadeshiko DB.
// Field mapping: s=surface, d=dictionary_form, r=reading, b=begin, e=end,
// p=pos[0], p1=pos[1], p2=pos[2], p4=pos[4], cf=pos[5]

// Segment 5: 焼けたフライパンに卵をおとして
const YAKETA_TOKENS: SlimToken[] = [
  t({ s: '焼け', d: '焼ける', r: 'ヤケ', b: 0, e: 2, p: '動詞', cf: '連用形-一般', p4: '下一段-カ行' }),
  t({ s: 'た', d: 'た', r: 'タ', b: 2, e: 3, p: '助動詞', cf: '連体形-一般', p4: '助動詞-タ' }),
  t({ s: 'フライパン', d: 'フライパン', r: 'フライパン', b: 3, e: 8, p: '名詞', p1: '普通名詞' }),
  t({ s: 'に', d: 'に', r: 'ニ', b: 8, e: 9, p: '助詞', p1: '格助詞' }),
  t({ s: '卵', d: '卵', r: 'タマゴ', b: 9, e: 10, p: '名詞', p1: '普通名詞' }),
  t({ s: 'を', d: 'を', r: 'ヲ', b: 10, e: 11, p: '助詞', p1: '格助詞' }),
  t({ s: 'おとし', d: 'おとす', r: 'オトシ', b: 11, e: 14, p: '動詞', cf: '連用形-一般', p4: '五段-サ行' }),
  t({ s: 'て', d: 'て', r: 'テ', b: 14, e: 15, p: '助詞', p1: '接続助詞' }),
];

// Segment 10: みんながそろったら
const SOROTTARA_TOKENS: SlimToken[] = [
  t({ s: 'みんな', d: 'みんな', r: 'ミンナ', b: 0, e: 3, p: '名詞', p1: '普通名詞', p2: '副詞可能' }),
  t({ s: 'が', d: 'が', r: 'ガ', b: 3, e: 4, p: '助詞', p1: '格助詞' }),
  t({ s: 'そろっ', d: 'そろう', r: 'ソロッ', b: 4, e: 7, p: '動詞', cf: '連用形-促音便', p4: '五段-ワア行' }),
  t({ s: 'たら', d: 'た', r: 'タラ', b: 7, e: 9, p: '助動詞', cf: '仮定形-一般', p4: '助動詞-タ' }),
];

// Segment 148: 若き哲学学徒よ 待っていた (ている in full form)
const MATTEITA_TOKENS: SlimToken[] = [
  t({ s: '若き', d: '若し', r: 'ワカキ', b: 0, e: 2, p: '形容詞', cf: '連体形-一般', p4: '文語形容詞-ク' }),
  t({ s: '哲学', d: '哲学', r: 'テツガク', b: 2, e: 4, p: '名詞', p1: '普通名詞' }),
  t({ s: '学徒', d: '学徒', r: 'ガクト', b: 4, e: 6, p: '名詞', p1: '普通名詞' }),
  t({ s: 'よ', d: 'よ', r: 'ヨ', b: 6, e: 7, p: '助詞', p1: '終助詞' }),
  t({ s: '待っ', d: '待つ', r: 'マッ', b: 8, e: 10, p: '動詞', cf: '連用形-促音便', p4: '五段-タ行' }),
  t({ s: 'て', d: 'て', r: 'テ', b: 10, e: 11, p: '助詞', p1: '接続助詞' }),
  t({ s: 'い', d: 'いる', r: 'イ', b: 11, e: 12, p: '動詞', p1: '非自立可能', cf: '連用形-一般', p4: '上一段-ア行' }),
  t({ s: 'た', d: 'た', r: 'タ', b: 12, e: 13, p: '助動詞', cf: '終止形-一般', p4: '助動詞-タ' }),
];

// Segment 21: おはようございます 空 起きてました? (contracted てる)
const OKITEMASHITA_TOKENS: SlimToken[] = [
  t({ s: 'おはようございます', d: 'おはようございます', r: 'オハヨウゴザイマス', b: 0, e: 9, p: '感動詞' }),
  t({ s: '空', d: '空', r: 'ソラ', b: 10, e: 11, p: '名詞', p1: '普通名詞' }),
  t({ s: '起き', d: '起きる', r: 'オキ', b: 12, e: 14, p: '動詞', cf: '連用形-一般', p4: '上一段-カ行' }),
  t({ s: 'て', d: 'てる', r: 'テ', b: 14, e: 15, p: '助動詞', cf: '連用形-一般', p4: '下一段-タ行' }),
  t({ s: 'まし', d: 'ます', r: 'マシ', b: 15, e: 17, p: '助動詞', cf: '連用形-一般', p4: '助動詞-マス' }),
  t({ s: 'た', d: 'た', r: 'タ', b: 17, e: 18, p: '助動詞', cf: '終止形-一般', p4: '助動詞-タ' }),
];

// Segment 45: いいよ 済ませてきたから (causative + subsidiary verb くる)
const SUMASETE_KITA_TOKENS: SlimToken[] = [
  t({ s: 'いい', d: 'いい', r: 'イイ', b: 0, e: 2, p: '形容詞', p1: '非自立可能', cf: '終止形-一般', p4: '形容詞' }),
  t({ s: 'よ', d: 'よ', r: 'ヨ', b: 2, e: 3, p: '助詞', p1: '終助詞' }),
  t({ s: '済ま', d: '済む', r: 'スマ', b: 4, e: 6, p: '動詞', cf: '未然形-一般', p4: '五段-マ行' }),
  t({ s: 'せ', d: 'せる', r: 'セ', b: 6, e: 7, p: '助動詞', cf: '連用形-一般', p4: '下一段-サ行' }),
  t({ s: 'て', d: 'て', r: 'テ', b: 7, e: 8, p: '助詞', p1: '接続助詞' }),
  t({ s: 'き', d: 'くる', r: 'キ', b: 8, e: 9, p: '動詞', p1: '非自立可能', cf: '連用形-一般', p4: 'カ行変格' }),
  t({ s: 'た', d: 'た', r: 'タ', b: 9, e: 10, p: '助動詞', cf: '終止形-一般', p4: '助動詞-タ' }),
  t({ s: 'から', d: 'から', r: 'カラ', b: 10, e: 12, p: '助詞', p1: '接続助詞' }),
];

// Segment 142: お掃除してないのかしら (contracted てない)
const SHITENAI_TOKENS: SlimToken[] = [
  t({ s: 'お', d: 'お', r: 'オ', b: 0, e: 1, p: '接頭辞' }),
  t({ s: '掃除', d: '掃除', r: 'ソウジ', b: 1, e: 3, p: '名詞', p1: '普通名詞', p2: 'サ変可能' }),
  t({ s: 'し', d: 'する', r: 'シ', b: 3, e: 4, p: '動詞', p1: '非自立可能', cf: '連用形-一般', p4: 'サ行変格' }),
  t({ s: 'て', d: 'てる', r: 'テ', b: 4, e: 5, p: '助動詞', cf: '未然形-一般', p4: '下一段-タ行' }),
  t({ s: 'ない', d: 'ない', r: 'ナイ', b: 5, e: 7, p: '助動詞', cf: '連体形-一般', p4: '助動詞-ナイ' }),
  t({ s: 'の', d: 'の', r: 'ノ', b: 7, e: 8, p: '助詞', p1: '準体助詞' }),
  t({ s: 'かしら', d: 'かしら', r: 'カシラ', b: 8, e: 11, p: '助詞', p1: '終助詞' }),
];

// Segment 173: これ あの時のじゃないぜ 猫にひっかかれたんだ (passive + past)
const HIKKAKARE_TOKENS: SlimToken[] = [
  t({ s: 'これ', d: 'これ', r: 'コレ', b: 0, e: 2, p: '代名詞' }),
  t({ s: 'あの', d: 'あの', r: 'アノ', b: 3, e: 5, p: '連体詞' }),
  t({ s: '時', d: '時', r: 'トキ', b: 5, e: 6, p: '名詞', p1: '普通名詞', p2: '副詞可能' }),
  t({ s: 'の', d: 'の', r: 'ノ', b: 6, e: 7, p: '助詞', p1: '格助詞' }),
  t({ s: 'じゃ', d: 'だ', r: 'ジャ', b: 7, e: 9, p: '助動詞', cf: '連用形-融合', p4: '助動詞-ダ' }),
  t({ s: 'ない', d: 'ない', r: 'ナイ', b: 9, e: 11, p: '形容詞', p1: '非自立可能', cf: '終止形-一般', p4: '形容詞' }),
  t({ s: 'ぜ', d: 'ぜ', r: 'ゼ', b: 11, e: 12, p: '助詞', p1: '終助詞' }),
  t({ s: '猫', d: '猫', r: 'ネコ', b: 13, e: 14, p: '名詞', p1: '普通名詞' }),
  t({ s: 'に', d: 'に', r: 'ニ', b: 14, e: 15, p: '助詞', p1: '格助詞' }),
  t({ s: 'ひっかか', d: 'ひっかく', r: 'ヒッカカ', b: 15, e: 19, p: '動詞', cf: '未然形-一般', p4: '五段-カ行' }),
  t({ s: 'れ', d: 'れる', r: 'レ', b: 19, e: 20, p: '助動詞', cf: '連用形-一般', p4: '助動詞-レル' }),
  t({ s: 'た', d: 'た', r: 'タ', b: 20, e: 21, p: '助動詞', cf: '連体形-一般', p4: '助動詞-タ' }),
  t({ s: 'ん', d: 'ん', r: 'ン', b: 21, e: 22, p: '助詞', p1: '準体助詞' }),
  t({ s: 'だ', d: 'だ', r: 'ダ', b: 22, e: 23, p: '助動詞', cf: '終止形-一般', p4: '助動詞-ダ' }),
];

// Segment 215: 風間さんに聞きたいことがあるの (desiderative + verb の edge case)
const KIKITAI_TOKENS: SlimToken[] = [
  t({ s: '風間', d: '風間', r: 'カザマ', b: 0, e: 2, p: '名詞', p1: '固有名詞', p2: '人名' }),
  t({ s: 'さん', d: 'さん', r: 'サン', b: 2, e: 4, p: '接尾辞', p1: '名詞的' }),
  t({ s: 'に', d: 'に', r: 'ニ', b: 4, e: 5, p: '助詞', p1: '格助詞' }),
  t({ s: '聞き', d: '聞く', r: 'キキ', b: 5, e: 7, p: '動詞', cf: '連用形-一般', p4: '五段-カ行' }),
  t({ s: 'たい', d: 'たい', r: 'タイ', b: 7, e: 9, p: '助動詞', cf: '連体形-一般', p4: '助動詞-タイ' }),
  t({ s: 'こと', d: 'こと', r: 'コト', b: 9, e: 11, p: '名詞', p1: '普通名詞' }),
  t({ s: 'が', d: 'が', r: 'ガ', b: 11, e: 12, p: '助詞', p1: '格助詞' }),
  t({ s: 'ある', d: 'ある', r: 'アル', b: 12, e: 14, p: '動詞', p1: '非自立可能', cf: '連体形-一般', p4: '五段-ラ行' }),
  t({ s: 'の', d: 'の', r: 'ノ', b: 14, e: 15, p: '助詞', p1: '終助詞' }),
];

// Segment 100: つらくない? (adjective negative)
const TSURAKUNAI_TOKENS: SlimToken[] = [
  t({ s: 'つらく', d: 'つらい', r: 'ツラク', b: 0, e: 3, p: '形容詞', cf: '連用形-一般', p4: '形容詞' }),
  t({ s: 'ない', d: 'ない', r: 'ナイ', b: 3, e: 5, p: '形容詞', p1: '非自立可能', cf: '終止形-一般', p4: '形容詞' }),
];

// Segment 101: みんなが居てくれた方が さみしくなくていいわ (subsidiary verbs chain + adj chain)
const ITE_KURETA_TOKENS: SlimToken[] = [
  t({ s: 'みんな', d: 'みんな', r: 'ミンナ', b: 0, e: 3, p: '名詞', p1: '普通名詞', p2: '副詞可能' }),
  t({ s: 'が', d: 'が', r: 'ガ', b: 3, e: 4, p: '助詞', p1: '格助詞' }),
  t({ s: '居', d: '居る', r: 'イ', b: 4, e: 5, p: '動詞', p1: '非自立可能', cf: '連用形-一般', p4: '上一段-ア行' }),
  t({ s: 'て', d: 'て', r: 'テ', b: 5, e: 6, p: '助詞', p1: '接続助詞' }),
  t({
    s: 'くれ',
    d: 'くれる',
    r: 'クレ',
    b: 6,
    e: 8,
    p: '動詞',
    p1: '非自立可能',
    cf: '連用形-一般',
    p4: '下一段-ラ行',
  }),
  t({ s: 'た', d: 'た', r: 'タ', b: 8, e: 9, p: '助動詞', cf: '連体形-一般', p4: '助動詞-タ' }),
  t({ s: '方', d: '方', r: 'ホウ', b: 9, e: 10, p: '名詞', p1: '普通名詞' }),
  t({ s: 'が', d: 'が', r: 'ガ', b: 10, e: 11, p: '助詞', p1: '格助詞' }),
  t({ s: 'さみしく', d: 'さみしい', r: 'サミシク', b: 12, e: 16, p: '形容詞', cf: '連用形-一般', p4: '形容詞' }),
  t({ s: 'なく', d: 'ない', r: 'ナク', b: 16, e: 18, p: '形容詞', p1: '非自立可能', cf: '連用形-一般', p4: '形容詞' }),
  t({ s: 'て', d: 'て', r: 'テ', b: 18, e: 19, p: '助詞', p1: '接続助詞' }),
  t({ s: 'いい', d: 'いい', r: 'イイ', b: 19, e: 21, p: '形容詞', p1: '非自立可能', cf: '終止形-一般', p4: '形容詞' }),
  t({ s: 'わ', d: 'わ', r: 'ワ', b: 21, e: 22, p: '助詞', p1: '終助詞' }),
];

// Segment 98 (partial): 来てもらう (subsidiary verb chain)
const KITE_MORAU_TOKENS: SlimToken[] = [
  t({ s: '来', d: '来る', r: 'キ', b: 16, e: 17, p: '動詞', p1: '非自立可能', cf: '連用形-一般', p4: 'カ行変格' }),
  t({ s: 'て', d: 'て', r: 'テ', b: 17, e: 18, p: '助詞', p1: '接続助詞' }),
  t({
    s: 'もらう',
    d: 'もらう',
    r: 'モラウ',
    b: 18,
    e: 21,
    p: '動詞',
    p1: '非自立可能',
    cf: '連体形-一般',
    p4: '五段-ワア行',
  }),
];

function getVisibleTokens(tokens: SlimToken[], highlight?: string) {
  const enriched = enrichTokens(tokens, highlight);
  return enriched.filter((t) => t.groupId === null || t.isGroupStem);
}

function auxLabelsEn(tokens: SlimToken[], highlight?: string) {
  const visible = getVisibleTokens(tokens, highlight);
  return Object.fromEntries(
    visible.filter((t) => t.auxMeanings.length > 0).map((t) => [t.displaySurface, t.auxMeanings.map((a) => a.en)]),
  );
}

describe('empty and single-token inputs', () => {
  it('returns empty array for empty input', () => {
    expect(enrichTokens([])).toEqual([]);
  });

  it('standalone noun has no group', () => {
    const tokens: SlimToken[] = [t({ s: '猫', d: '猫', r: 'ネコ', b: 0, e: 1, p: '名詞', p1: '普通名詞' })];
    const enriched = enrichTokens(tokens);
    expect(enriched).toHaveLength(1);
    expect(enriched[0]?.groupId).toBeNull();
    expect(enriched[0]?.displaySurface).toBe('猫');
  });

  it('standalone verb has no group (single-token groups are suppressed)', () => {
    const tokens: SlimToken[] = [
      t({ s: '食べる', d: '食べる', r: 'タベル', b: 0, e: 3, p: '動詞', cf: '終止形-一般' }),
    ];
    const enriched = enrichTokens(tokens);
    expect(enriched[0]?.groupId).toBeNull();
  });
});

describe('token grouping', () => {
  it('groups verb + た (past): 焼けた', () => {
    const visible = getVisibleTokens(YAKETA_TOKENS);
    const surfaces = visible.map((t) => t.displaySurface);
    expect(surfaces).toEqual(['焼けた', 'フライパン', 'に', '卵', 'を', 'おとして']);
    expect(auxLabelsEn(YAKETA_TOKENS)).toEqual({
      焼けた: ['Past'],
      おとして: ['Te-form'],
    });
  });

  it('groups verb + たら (conditional past): そろったら', () => {
    const visible = getVisibleTokens(SOROTTARA_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['みんな', 'が', 'そろったら']);
    expect(auxLabelsEn(SOROTTARA_TOKENS)).toEqual({ そろったら: ['Past'] });
  });

  it('groups verb + て + いる + た (full ている + past): 待っていた', () => {
    const visible = getVisibleTokens(MATTEITA_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['若き', '哲学', '学徒', 'よ', '待っていた']);
    expect(auxLabelsEn(MATTEITA_TOKENS)).toEqual({
      待っていた: ['Te-form', 'Progressive', 'Past'],
    });
  });

  it('groups verb + てる + ます + た (contracted progressive): 起きてました', () => {
    const visible = getVisibleTokens(OKITEMASHITA_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['おはようございます', '空', '起きてました']);
    expect(auxLabelsEn(OKITEMASHITA_TOKENS)).toEqual({
      起きてました: ['Progressive', 'Polite', 'Past'],
    });
  });

  it('groups verb + せる + て + くる + た (causative + subsidiary): 済ませてきた', () => {
    const visible = getVisibleTokens(SUMASETE_KITA_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['いい', 'よ', '済ませてきた', 'から']);
    expect(auxLabelsEn(SUMASETE_KITA_TOKENS)).toEqual({
      済ませてきた: ['Causative', 'Te-form', 'Gradual change', 'Past'],
    });
  });

  it('groups contracted てない: してない', () => {
    const visible = getVisibleTokens(SHITENAI_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['お', '掃除', 'してない', 'の', 'かしら']);
    expect(auxLabelsEn(SHITENAI_TOKENS)).toEqual({
      してない: ['Progressive', 'Negative'],
    });
  });

  it('groups verb + れる + た (passive + past): ひっかかれた', () => {
    const visible = getVisibleTokens(HIKKAKARE_TOKENS);
    const surfaces = visible.map((t) => t.displaySurface);
    expect(surfaces).toContain('ひっかかれた');
    expect(auxLabelsEn(HIKKAKARE_TOKENS)['ひっかかれた']).toEqual(['Passive/Potential', 'Past']);
  });

  it('groups verb + たい (desiderative): 聞きたい', () => {
    const visible = getVisibleTokens(KIKITAI_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toContain('聞きたい');
    expect(auxLabelsEn(KIKITAI_TOKENS)['聞きたい']).toEqual(['Desiderative']);
  });

  it('groups adjective + ない (adjective negation): つらくない', () => {
    const visible = getVisibleTokens(TSURAKUNAI_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['つらくない']);
    expect(auxLabelsEn(TSURAKUNAI_TOKENS)).toEqual({ つらくない: ['Negative'] });
  });

  it('groups subsidiary verb chain: 居てくれた', () => {
    const visible = getVisibleTokens(ITE_KURETA_TOKENS);
    const surfaces = visible.map((t) => t.displaySurface);
    expect(surfaces).toContain('居てくれた');
    expect(auxLabelsEn(ITE_KURETA_TOKENS)['居てくれた']).toEqual(['Te-form', 'For me', 'Past']);
  });

  it('groups adjective + ない + て + いい: さみしくなくていい', () => {
    const visible = getVisibleTokens(ITE_KURETA_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toContain('さみしくなくていい');
    expect(auxLabelsEn(ITE_KURETA_TOKENS)['さみしくなくていい']).toEqual(['Negative', 'Te-form', 'OK/Fine']);
  });

  it('groups subsidiary verbs: 来てもらう', () => {
    const visible = getVisibleTokens(KITE_MORAU_TOKENS);
    expect(visible.map((t) => t.displaySurface)).toEqual(['来てもらう']);
    expect(auxLabelsEn(KITE_MORAU_TOKENS)).toEqual({
      来てもらう: ['Te-form', 'Receive favor'],
    });
  });
});

describe('particle exclusion', () => {
  it('does not group verb + の (準体助詞)', () => {
    const visible = getVisibleTokens(SHITENAI_TOKENS);
    const noToken = visible.find((t) => t.s === 'の');
    expect(noToken).toBeDefined();
    expect(noToken?.groupId).toBeNull();
  });

  it('does not group verb + が (格助詞)', () => {
    const visible = getVisibleTokens(SOROTTARA_TOKENS);
    const gaToken = visible.find((t) => t.s === 'が');
    expect(gaToken).toBeDefined();
    expect(gaToken?.groupId).toBeNull();
  });

  it('does not group verb + の (終助詞) after ある', () => {
    const visible = getVisibleTokens(KIKITAI_TOKENS);
    const noToken = visible.find((t) => t.s === 'の');
    expect(noToken).toBeDefined();
    expect(noToken?.groupId).toBeNull();
  });

  it('does not group verb + から (接続助詞 but clausal)', () => {
    const visible = getVisibleTokens(SUMASETE_KITA_TOKENS);
    const karaToken = visible.find((t) => t.s === 'から');
    expect(karaToken).toBeDefined();
    expect(karaToken?.groupId).toBeNull();
  });

  it('does not group じゃない as a verb group (copula + adjective)', () => {
    const enriched = enrichTokens(HIKKAKARE_TOKENS);
    const ja = enriched.find((t) => t.s === 'じゃ');
    const nai = enriched.find((t) => t.s === 'ない' && t.p === '形容詞');
    expect(ja?.groupId).toBeNull();
    expect(nai?.groupId).toBeNull();
  });
});

describe('stem properties', () => {
  it('uses stem dictionary form for group', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '待っていた');
    expect(stem).toBeDefined();
    expect(stem?.dictForm).toBe('待つ');
    expect(stem?.posJa).toBe('動詞');
    expect(stem?.posEn).toBe('Verb');
  });

  it('uses stem dictionary form for causative group', () => {
    const enriched = enrichTokens(SUMASETE_KITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '済ませてきた');
    expect(stem).toBeDefined();
    expect(stem?.dictForm).toBe('済む');
  });

  it('uses adjective stem for adj + ない group', () => {
    const enriched = enrichTokens(TSURAKUNAI_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem);
    expect(stem).toBeDefined();
    expect(stem?.dictForm).toBe('つらい');
    expect(stem?.posJa).toBe('形容詞');
  });
});

describe('searchText', () => {
  it('uses dictionary form for standalone tokens', () => {
    const enriched = enrichTokens(YAKETA_TOKENS);
    const frypan = enriched.find((t) => t.s === 'フライパン');
    expect(frypan?.searchText).toBe('フライパン');
  });

  it('uses stem dictionary form for grouped tokens', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '待っていた');
    expect(stem?.searchText).toBe('待つ');
  });
});

describe('非自立可能 verb at sentence start acts as stem', () => {
  it('居る starts its own group when not preceded by another verb', () => {
    const enriched = enrichTokens(ITE_KURETA_TOKENS);
    const iru = enriched.find((t) => t.s === '居');
    expect(iru).toBeDefined();
    expect(iru?.isGroupStem).toBe(true);
  });

  it('いい as standalone (non-group) adjective still works', () => {
    const enriched = enrichTokens(SUMASETE_KITA_TOKENS);
    const ii = enriched.find((t) => t.s === 'いい');
    expect(ii).toBeDefined();
    expect(ii?.groupId).toBeNull();
  });
});

describe('posSubJa suppression', () => {
  it('suppresses 非自立可能 in sub-POS display for grouped stems', () => {
    const enriched = enrichTokens(ITE_KURETA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '居てくれた');
    expect(stem?.posSubJa).toBe('');
    expect(stem?.posSubEn).toBe('');
  });

  it('shows sub-POS for non-非自立可能 tokens', () => {
    const enriched = enrichTokens(KIKITAI_TOKENS);
    const kazama = enriched.find((t) => t.s === '風間');
    expect(kazama?.posSubJa).toBe('固有名詞');
    expect(kazama?.posSubEn).toBe('Proper Noun');
  });
});

describe('highlight matching', () => {
  it('marks stem as match and non-stem as compound', () => {
    const highlight = '<em>焼け</em>たフライパンに卵をおとして';
    const enriched = enrichTokens(YAKETA_TOKENS, highlight);
    const yaketa = enriched.filter((t) => t.displaySurface === '焼けた');
    const stem = yaketa.find((t) => t.isGroupStem);
    expect(stem?.matchType).toBe('match');
    const aux = yaketa.find((t) => !t.isGroupStem);
    expect(aux?.matchType).toBe('compound');
  });

  it('marks all group tokens as compound when stem matches', () => {
    const highlight = '若き哲学学徒よ <em>待っ</em>ていた';
    const enriched = enrichTokens(MATTEITA_TOKENS, highlight);
    const group = enriched.filter((t) => t.displaySurface === '待っていた');
    const stem = group.find((t) => t.isGroupStem);
    expect(stem?.matchType).toBe('match');
    const nonStems = group.filter((t) => !t.isGroupStem);
    for (const t of nonStems) {
      expect(t.matchType).toBe('compound');
    }
  });

  it('does not mark unrelated tokens', () => {
    const highlight = '<em>焼け</em>たフライパンに卵をおとして';
    const enriched = enrichTokens(YAKETA_TOKENS, highlight);
    const frypan = enriched.find((t) => t.s === 'フライパン');
    expect(frypan?.matchType).toBe('none');
  });

  it('all tokens are none when no highlight provided', () => {
    const enriched = enrichTokens(YAKETA_TOKENS);
    for (const t of enriched) {
      expect(t.matchType).toBe('none');
    }
  });
});

describe('conjugation class (p4)', () => {
  it('shows godan class for 五段 verb: 待つ', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '待っていた');
    expect(stem?.conjClassJa).toBe('五段');
    expect(stem?.conjClassEn).toBe('Godan');
  });

  it('shows ichidan class for 下一段 verb: 焼ける', () => {
    const enriched = enrichTokens(YAKETA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '焼けた');
    expect(stem?.conjClassJa).toBe('下一段');
    expect(stem?.conjClassEn).toBe('Ichidan (-eru)');
  });

  it('shows i-adjective class for 形容詞', () => {
    const enriched = enrichTokens(TSURAKUNAI_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem);
    expect(stem?.conjClassJa).toBe('形容詞');
    expect(stem?.conjClassEn).toBe('I-adjective');
  });

  it('shows irregular class for サ行変格 (する)', () => {
    const enriched = enrichTokens(SHITENAI_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === 'してない');
    expect(stem?.conjClassJa).toBe('サ行変格');
    expect(stem?.conjClassEn).toBe('Irregular (する)');
  });

  it('shows irregular class for カ行変格 (くる) — uses stem p4', () => {
    const enriched = enrichTokens(SUMASETE_KITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '済ませてきた');
    expect(stem?.conjClassJa).toBe('五段');
    expect(stem?.conjClassEn).toBe('Godan');
  });

  it('no conjugation class for nouns or particles', () => {
    const enriched = enrichTokens(YAKETA_TOKENS);
    const frypan = enriched.find((t) => t.s === 'フライパン');
    expect(frypan?.conjClassJa).toBe('');
    expect(frypan?.conjClassEn).toBe('');
  });
});

describe('conjugation form for standalone tokens', () => {
  it('shows conjugation form for standalone adjective: 若き → 連体形', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const wakaki = enriched.find((t) => t.s === '若き');
    expect(wakaki?.conjFormJa).toBe('連体形');
    expect(wakaki?.conjFormEn).toBe('Attributive');
  });

  it('does not show conjugation form for grouped tokens', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '待っていた');
    expect(stem?.conjFormJa).toBe('');
    expect(stem?.conjFormEn).toBe('');
  });
});

describe('で as te-form', () => {
  it('groups verb + で (te-form for 五段 verbs)', () => {
    // Synthetic fixture: 読んで (読む godan → 読ん + で)
    const tokens: SlimToken[] = [
      t({ s: '読ん', d: '読む', r: 'ヨン', b: 0, e: 2, p: '動詞', cf: '連用形-撥音便', p4: '五段-マ行' }),
      t({ s: 'で', d: 'で', r: 'デ', b: 2, e: 3, p: '助詞', p1: '接続助詞' }),
    ];
    const visible = enrichTokens(tokens).filter((t) => t.groupId === null || t.isGroupStem);
    expect(visible.map((t) => t.displaySurface)).toEqual(['読んで']);
  });
});

describe('reading generation', () => {
  it('concatenates group readings in hiragana', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '待っていた');
    expect(stem?.reading).toBe('まっていた');
  });

  it('converts katakana to hiragana for standalone tokens', () => {
    const enriched = enrichTokens(YAKETA_TOKENS);
    const frypan = enriched.find((t) => t.s === 'フライパン');
    expect(frypan?.reading).toBe('ふらいぱん');
  });

  it('dictReading is empty for compound groups (cannot derive dict form reading from surface reading)', () => {
    const enriched = enrichTokens(MATTEITA_TOKENS);
    const stem = enriched.find((t) => t.isGroupStem && t.displaySurface === '待っていた');
    expect(stem?.dictReading).toBe('');
  });

  it('dictReading equals token reading for standalone tokens', () => {
    const enriched = enrichTokens(YAKETA_TOKENS);
    const frypan = enriched.find((t) => t.s === 'フライパン');
    expect(frypan?.dictReading).toBe('ふらいぱん');
  });
});
