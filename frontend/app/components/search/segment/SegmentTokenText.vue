<script setup lang="ts">
export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  p: string;
}

type Props = {
  tokens: SlimToken[];
  highlight?: string;
  content: string;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  'token-click': [dictionaryForm: string];
}>();

interface EnrichedToken extends SlimToken {
  matchType: 'match' | 'compound' | 'none';
}

const enrichedTokens = computed<EnrichedToken[]>(() => {
  const highlight = props.highlight;
  if (!highlight || props.tokens.length === 0) {
    return props.tokens.map((t) => ({ ...t, matchType: 'none' as const }));
  }

  const matchRanges: Array<{ start: number; end: number; type: 'match' | 'compound' }> = [];
  let charPos = 0;
  let i = 0;

  while (i < highlight.length) {
    if (highlight.startsWith('<em>', i)) {
      const start = charPos;
      i += 4;
      while (i < highlight.length && !highlight.startsWith('</em>', i)) {
        charPos++;
        i++;
      }
      if (highlight.startsWith('</em>', i)) {
        matchRanges.push({ start, end: charPos, type: 'match' });
        i += 5;
      }
    } else if (highlight.startsWith('<mark>', i)) {
      const start = charPos;
      i += 6;
      while (i < highlight.length && !highlight.startsWith('</mark>', i)) {
        charPos++;
        i++;
      }
      if (highlight.startsWith('</mark>', i)) {
        matchRanges.push({ start, end: charPos, type: 'compound' });
        i += 7;
      }
    } else {
      charPos++;
      i++;
    }
  }

  return props.tokens.map((token) => {
    const range = matchRanges.find((r) => token.b < r.end && token.e > r.start);
    return { ...token, matchType: range?.type ?? ('none' as const) };
  });
});

const posClass = (pos: string) => {
  switch (pos) {
    case '動詞': return 'token--verb';
    case '名詞': return 'token--noun';
    case '形容詞': return 'token--adjective';
    case '副詞': return 'token--adverb';
    case '助詞': return 'token--particle';
    case '助動詞': return 'token--auxiliary';
    default: return '';
  }
};
</script>

<template>
  <span class="token-text">
    <span
      v-for="token in enrichedTokens"
      :key="token.b"
      class="token"
      :class="[
        posClass(token.p),
        {
          'token--match': token.matchType === 'match',
          'token--compound': token.matchType === 'compound',
        },
      ]"
      :title="token.d !== token.s ? `${token.d} (${token.r})` : token.r"
      @click="emit('token-click', token.d)"
    >{{ token.s }}</span>
  </span>
</template>

<style scoped>
.token {
  cursor: pointer;
  transition: background-color 0.15s ease;
  border-radius: 2px;
}

.token:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.token--match {
  color: #fbbf24;
  font-weight: 600;
}

.token--compound {
  color: #fbbf24;
  opacity: 0.7;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}
</style>
