// TEMPORARILY DISABLED - lindera.js dependency removed
// import { Dictionary, Tokenizer, type MorphemeResult } from 'lindera.js';
// import { config } from '@config/config';
// import { logger } from '@config/log';
import type { MorphemeData } from '@app/types/morpheme';

// const dictPath = config.LINDERA_DICT_PATH;
// let tokenizer: Tokenizer;

// function getTokenizer(): Tokenizer {
//   if (!tokenizer) {
//     logger.info(`Loading lindera dictionary from: ${dictPath}`);
//     const dict = new Dictionary(dictPath);
//     tokenizer = dict.createTokenizer();
//     logger.info('Lindera tokenizer initialized');
//   }
//   return tokenizer;
// }

// function toMorphemeData(m: MorphemeResult): MorphemeData {
//   return {
//     surface: m.surface,
//     reading: m.reading,
//     baseform: m.baseform,
//     pronunciation: m.pronunciation,
//     pos: m.pos,
//     posShort: m.posShort,
//     begin: m.begin,
//     end: m.end,
//     pitchAccentType: m.pitchAccentType ?? null,
//     pitchCompoundRule: m.pitchCompoundRule ?? null,
//     pitchModificationRule: m.pitchModificationRule ?? null,
//   };
// }

export function analyze(_text: string): MorphemeData[] {
  throw new Error('Morpheme analysis temporarily disabled - lindera.js dependency removed');
}

export function analyzeBatch(
  _items: { id: string; text: string }[],
): { id: string; morphemes: MorphemeData[] }[] {
  throw new Error('Morpheme analysis temporarily disabled - lindera.js dependency removed');
}
