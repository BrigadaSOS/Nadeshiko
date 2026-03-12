import { describe, expect, it } from 'bun:test';
import { enhanceHighlight } from '@app/models/segmentDocument/HighlightEnhancer';
import type { SlimToken } from '@app/models/SegmentDocument';

function token(s: string, d: string, b: number, e: number, p: string): SlimToken {
  return { s, d, r: '', b, e, p };
}

describe('enhanceHighlight', () => {
  it('returns original highlight when no tokens', () => {
    const result = enhanceHighlight('test <em>word</em>', []);
    expect(result).toBe('test <em>word</em>');
  });

  it('returns original highlight when no em tags', () => {
    const tokens = [token('test', 'test', 0, 4, '名詞')];
    const result = enhanceHighlight('test word', tokens);
    expect(result).toBe('test word');
  });

  it('extends verb highlight to include trailing auxiliary', () => {
    // "今日は食べました" → tokens: 今日(0-2), は(2-3), 食べ(3-5), ました(5-8)
    const tokens = [
      token('今日', '今日', 0, 2, '名詞'),
      token('は', 'は', 2, 3, '助詞'),
      token('食べ', '食べる', 3, 5, '動詞'),
      token('ました', 'ます', 5, 8, '助動詞'),
    ];
    const highlight = '今日は<em>食べ</em>ました';
    const result = enhanceHighlight(highlight, tokens);
    expect(result).toBe('今日は<em>食べ</em><mark>ました</mark>');
  });

  it('extends verb highlight across multiple auxiliaries', () => {
    // "食べられました" → tokens: 食べ(0-2), られ(2-4), ました(4-7)
    const tokens = [
      token('食べ', '食べる', 0, 2, '動詞'),
      token('られ', 'られる', 2, 4, '助動詞'),
      token('ました', 'ます', 4, 7, '助動詞'),
    ];
    const highlight = '<em>食べ</em>られました';
    const result = enhanceHighlight(highlight, tokens);
    expect(result).toBe('<em>食べ</em><mark>られました</mark>');
  });

  it('does not extend when next token is a particle', () => {
    const tokens = [
      token('猫', '猫', 0, 1, '名詞'),
      token('が', 'が', 1, 2, '助詞'),
      token('好き', '好き', 2, 4, '形容詞'),
    ];
    const highlight = '<em>猫</em>が好き';
    const result = enhanceHighlight(highlight, tokens);
    expect(result).toBe('<em>猫</em>が好き');
  });

  it('stops extending at non-auxiliary tokens', () => {
    // "言われたこと" → 言わ(verb), れ(aux), た(aux), こと(noun)
    const tokens = [
      token('言わ', '言う', 0, 2, '動詞'),
      token('れ', 'れる', 2, 3, '助動詞'),
      token('た', 'た', 3, 4, '助動詞'),
      token('こと', 'こと', 4, 6, '名詞'),
    ];
    const highlight = '<em>言わ</em>れたこと';
    const result = enhanceHighlight(highlight, tokens);
    expect(result).toBe('<em>言わ</em><mark>れた</mark>こと');
  });

  it('handles no compound extension needed', () => {
    const tokens = [token('猫', '猫', 0, 1, '名詞'), token('です', 'です', 1, 3, '助動詞')];
    const highlight = '猫<em>です</em>';
    const result = enhanceHighlight(highlight, tokens);
    // "です" is 助動詞, not a stem POS, so no extension
    expect(result).toBe('猫<em>です</em>');
  });

  it('handles multiple highlighted regions', () => {
    // Two separate highlighted words
    const tokens = [
      token('食べ', '食べる', 0, 2, '動詞'),
      token('た', 'た', 2, 3, '助動詞'),
      token('り', 'り', 3, 4, '助詞'),
      token('飲ん', '飲む', 4, 6, '動詞'),
      token('だ', 'だ', 6, 7, '助動詞'),
      token('り', 'り', 7, 8, '助詞'),
    ];
    const highlight = '<em>食べ</em>たり<em>飲ん</em>だり';
    const result = enhanceHighlight(highlight, tokens);
    expect(result).toBe('<em>食べ</em><mark>たり</mark><em>飲ん</em><mark>だり</mark>');
  });

  it('handles empty highlight string', () => {
    const tokens = [token('test', 'test', 0, 4, '名詞')];
    expect(enhanceHighlight('', tokens)).toBe('');
  });

  it('handles highlight that already covers full compound form', () => {
    // If ES already highlighted the full form, no extension needed
    const tokens = [token('食べ', '食べる', 0, 2, '動詞'), token('ました', 'ます', 2, 5, '助動詞')];
    const highlight = '<em>食べました</em>';
    const result = enhanceHighlight(highlight, tokens);
    // The em already covers everything, no compound range needed
    expect(result).toBe('<em>食べました</em>');
  });
});
