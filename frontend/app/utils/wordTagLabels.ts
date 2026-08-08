/**
 * Chip labels for the tags Shirabe hangs on a sense, in the reader's language.
 *
 * Shirabe resolves `?locale=` into ONE language for the labels it returns, but
 * it only ships a UI in English and Spanish, and JMdict's own tag labels are
 * English whatever you ask for -- so the label riding on the response was
 * English on every card, and a reader on the Spanish or Japanese interface met
 * "Ichidan verb" among their own prose.
 *
 * The wording is Shirabe's Legend (`app/models/legend.rb` plus
 * `legend.terms.<slug>.label` / `.jp` in its `config/locales/*.yml`), so a word
 * reads the same in both products and a chip here means exactly what the panel
 * over there explains. The code → slug mapping is its `legend_slug` and
 * `USAGE_LEGEND_SLUGS` from `search_helper.rb`.
 *
 * Two deliberate departures from the Legend, both about chip granularity:
 *
 *   - `num` and `ctr` share the Legend's "counter" entry, whose label reads
 *     "Counter & numbers" -- true of the pair, wrong as the only word on a chip
 *     for 三. They keep separate labels here.
 *   - JMdict's finer POS codes (`n-pref`, `aux-v`, `cop`, `vk`, the rarer
 *     adjective classes) have no Legend entry of their own. Rather than print
 *     the coarse parent in Spanish and Japanese while English says the precise
 *     thing, each carries its own translation.
 *
 * A handful of Legend entries have no Japanese term (`jp` is blank upstream:
 * vulgar, derogatory, familiar, archaic, obsolete, rare, jocular). Those fall
 * back to English rather than being invented here; fill them in when Shirabe
 * does.
 */

/** The languages a chip can be written in. Wider than `GlossLanguage`: this is
 *  the interface language, and Nadeshiko ships a Japanese one even though no
 *  dictionary writes definitions in Japanese. */
export type TagLanguage = 'en' | 'es' | 'ja';

export function tagLanguage(uiLocale: string): TagLanguage {
  if (uiLocale === 'es') return 'es';
  if (uiLocale === 'ja') return 'ja';
  return 'en';
}

/** en / es / ja for one Legend slug. `ja` omitted where Shirabe has no term. */
type LegendLabel = { en: string; es: string; ja?: string };

const LEGEND_LABELS: Record<string, LegendLabel> = {
  // Parts of speech.
  noun: { en: 'Noun', es: 'Sustantivo', ja: '名詞' },
  'noun-prefix': { en: 'Noun (prefix)', es: 'Sustantivo (prefijo)', ja: '名詞（接頭）' },
  'noun-suffix': { en: 'Noun (suffix)', es: 'Sustantivo (sufijo)', ja: '名詞（接尾）' },
  numeric: { en: 'Numeric', es: 'Numeral', ja: '数詞' },
  counter: { en: 'Counter', es: 'Contador', ja: '助数詞' },
  pronoun: { en: 'Pronoun', es: 'Pronombre', ja: '代名詞' },
  adjective: { en: 'Adjective', es: 'Adjetivo', ja: '形容詞' },
  'i-adjective': { en: 'I-adjective', es: 'Adjetivo en i', ja: 'い形容詞' },
  'na-adjective': { en: 'Na-adjective', es: 'Adjetivo en na', ja: 'な形容詞' },
  'no-adjective': { en: 'No-adjective', es: 'Adjetivo en no', ja: 'の形容詞' },
  'taru-adjective': { en: 'Taru-adjective', es: 'Adjetivo en taru', ja: 'たる形容詞' },
  prenominal: { en: 'Prenominal', es: 'Prenominal', ja: '連体詞' },
  adverb: { en: 'Adverb', es: 'Adverbio', ja: '副詞' },
  verb: { en: 'Verb', es: 'Verbo', ja: '動詞' },
  'ichidan-verb': { en: 'Ichidan verb', es: 'Verbo ichidan', ja: '一段動詞' },
  'godan-verb': { en: 'Godan verb', es: 'Verbo godan', ja: '五段動詞' },
  'suru-verb': { en: 'Suru verb', es: 'Verbo suru', ja: 'する動詞' },
  'kuru-verb': { en: 'Kuru verb', es: 'Verbo kuru', ja: 'カ変動詞' },
  'classical-verb': { en: 'Classical verb', es: 'Verbo clásico', ja: '文語動詞' },
  'transitive-verb': { en: 'Transitive verb', es: 'Verbo transitivo', ja: '他動詞' },
  'intransitive-verb': { en: 'Intransitive verb', es: 'Verbo intransitivo', ja: '自動詞' },
  particle: { en: 'Particle', es: 'Partícula', ja: '助詞' },
  conjunction: { en: 'Conjunction', es: 'Conjunción', ja: '接続詞' },
  interjection: { en: 'Interjection', es: 'Interjección', ja: '感動詞' },
  expression: { en: 'Expression', es: 'Expresión', ja: '表現' },
  prefix: { en: 'Prefix', es: 'Prefijo', ja: '接頭辞' },
  suffix: { en: 'Suffix', es: 'Sufijo', ja: '接尾辞' },
  auxiliary: { en: 'Auxiliary', es: 'Auxiliar', ja: '助動詞' },
  'auxiliary-verb': { en: 'Aux. verb', es: 'Verbo auxiliar', ja: '助動詞' },
  'auxiliary-adjective': { en: 'Aux. adjective', es: 'Adjetivo auxiliar', ja: '助形容詞' },
  copula: { en: 'Copula', es: 'Cópula', ja: '繋辞' },
  name: { en: 'Name', es: 'Nombre propio', ja: '固有名詞' },

  // Usage qualifiers: the misc flags JMdict hangs on a sense.
  'kana-alone': { en: 'Usually kana', es: 'Normalmente en kana', ja: '仮名書き' },
  abbreviation: { en: 'Abbreviation', es: 'Abreviatura', ja: '略語' },
  colloquial: { en: 'Colloquial', es: 'Coloquial', ja: '口語' },
  slang: { en: 'Slang', es: 'Argot', ja: '俗語' },
  vulgar: { en: 'Vulgar', es: 'Vulgar' },
  derogatory: { en: 'Derogatory', es: 'Despectivo' },
  honorific: { en: 'Honorific', es: 'Honorífico', ja: '尊敬語' },
  humble: { en: 'Humble', es: 'Humilde', ja: '謙譲語' },
  polite: { en: 'Polite', es: 'Cortés', ja: '丁寧語' },
  familiar: { en: 'Familiar', es: 'Familiar' },
  feminine: { en: 'Feminine', es: 'Femenino', ja: '女性語' },
  masculine: { en: 'Masculine', es: 'Masculino', ja: '男性語' },
  archaic: { en: 'Archaic', es: 'Arcaísmo' },
  obsolete: { en: 'Obsolete', es: 'Obsoleto' },
  rare: { en: 'Rare', es: 'Poco común' },
  jocular: { en: 'Jocular', es: 'Jocoso' },
  euphemistic: { en: 'Euphemistic', es: 'Eufemístico', ja: '婉曲' },
  onomatopoeic: { en: 'Onomatopoeic', es: 'Onomatopéyico', ja: '擬音・擬態語' },
  yojijukugo: { en: 'Four-character idiom', es: 'Modismo de cuatro kanji', ja: '四字熟語' },
  proverb: { en: 'Proverb', es: 'Refrán', ja: '諺' },
  idiomatic: { en: 'Idiomatic', es: 'Idiomático', ja: '慣用句' },
  childish: { en: "Children's language", es: 'Lenguaje infantil', ja: '児童語' },
  poetic: { en: 'Poetic', es: 'Poético', ja: '詩的表現' },
  dated: { en: 'Dated', es: 'Anticuado', ja: '古風' },
  formal: { en: 'Formal', es: 'Formal', ja: '文語・改まった言い方' },
  historical: { en: 'Historical', es: 'Histórico', ja: '歴史用語' },
  'internet-slang': { en: 'Internet slang', es: 'Jerga de internet', ja: 'ネットスラング' },
  'manga-slang': { en: 'Manga slang', es: 'Jerga del manga', ja: '漫画スラング' },
  sensitive: { en: 'Sensitive', es: 'Delicado', ja: '差別語・要注意' },
  // JMdict's proper-name / entity tags share one bucket, as they do in the
  // Legend: the chips keep their own labels, the class is explained once.
  'name-entity': { en: 'Name / entity', es: 'Nombre / entidad', ja: '固有名詞' },
};

/** JMdict part-of-speech code → slug, for the codes that map exactly. The verb
 *  and adjective families are matched by prefix in `posSlug` instead, because
 *  JMdict spells out every godan ending (`v5k`, `v5r`, `v5aru`, …). */
const POS_SLUGS: Record<string, string> = {
  n: 'noun',
  'n-pref': 'noun-prefix',
  'n-suf': 'noun-suffix',
  num: 'numeric',
  ctr: 'counter',
  pn: 'pronoun',
  'adj-i': 'i-adjective',
  'adj-ix': 'i-adjective',
  'adj-na': 'na-adjective',
  'adj-no': 'no-adjective',
  'adj-t': 'taru-adjective',
  'adj-pn': 'prenominal',
  'adj-f': 'prenominal',
  adv: 'adverb',
  'adv-to': 'adverb',
  vt: 'transitive-verb',
  vi: 'intransitive-verb',
  vs: 'suru-verb',
  'vs-i': 'suru-verb',
  'vs-s': 'suru-verb',
  'vs-c': 'suru-verb',
  vk: 'kuru-verb',
  prt: 'particle',
  conj: 'conjunction',
  int: 'interjection',
  exp: 'expression',
  pref: 'prefix',
  suf: 'suffix',
  aux: 'auxiliary',
  'aux-v': 'auxiliary-verb',
  'aux-adj': 'auxiliary-adjective',
  cop: 'copula',
};

/** JMdict misc code → slug. Register, era, gender and form flags get their own
 *  entry; the proper-name / entity tags share `name-entity`. */
const MISC_SLUGS: Record<string, string> = {
  uk: 'kana-alone',
  abbr: 'abbreviation',
  col: 'colloquial',
  sl: 'slang',
  vulg: 'vulgar',
  derog: 'derogatory',
  hon: 'honorific',
  hum: 'humble',
  pol: 'polite',
  fam: 'familiar',
  fem: 'feminine',
  male: 'masculine',
  arch: 'archaic',
  obs: 'obsolete',
  rare: 'rare',
  joc: 'jocular',
  euph: 'euphemistic',
  'on-mim': 'onomatopoeic',
  yoji: 'yojijukugo',
  proverb: 'proverb',
  id: 'idiomatic',
  chn: 'childish',
  poet: 'poetic',
  dated: 'dated',
  form: 'formal',
  hist: 'historical',
  'net-sl': 'internet-slang',
  'm-sl': 'manga-slang',
  sens: 'sensitive',
  organization: 'name-entity',
  company: 'name-entity',
  work: 'name-entity',
  product: 'name-entity',
  person: 'name-entity',
  place: 'name-entity',
  surname: 'name-entity',
  given: 'name-entity',
  char: 'name-entity',
  creat: 'name-entity',
  dei: 'name-entity',
  myth: 'name-entity',
  leg: 'name-entity',
  fict: 'name-entity',
  serv: 'name-entity',
  ev: 'name-entity',
  ship: 'name-entity',
  group: 'name-entity',
  unclass: 'name-entity',
  obj: 'name-entity',
  doc: 'name-entity',
  quote: 'name-entity',
  relig: 'name-entity',
};

/** The Legend slug for a part-of-speech code, or undefined when it has none. */
export function posSlug(code: string): string | undefined {
  const exact = POS_SLUGS[code];
  if (exact) return exact;

  if (/^v5/.test(code)) return 'godan-verb';
  if (/^v1/.test(code)) return 'ichidan-verb';
  if (/^v[24]/.test(code)) return 'classical-verb';
  if (/^v/.test(code)) return 'verb';
  if (/^adj/.test(code)) return 'adjective';
  return undefined;
}

/** JMdict's own wording, shortened for a chip: its parenthetical romaji asides
 *  and trailing " - ..." note dropped. The last resort, for a code with no
 *  Legend entry (a field, a dialect, a tag a newer JMdict added). English
 *  whatever the reader's language, because that is the only language it exists
 *  in -- there is nothing here to translate from. */
function shortened(code: string, full: string): string {
  const stripped = full
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+-\s.*$/, '')
    .trim();
  if (!stripped) return code;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** The Legend entry a tag belongs to, by Shirabe's category. Field and dialect
 *  are absent on purpose: the Legend has no entry for either, and they render as
 *  plain chips there too. */
function legendSlug(category: string, code: string): string | undefined {
  switch (category) {
    case 'partOfSpeech':
      return posSlug(code);
    case 'nameType':
      return 'name';
    case 'misc':
      return MISC_SLUGS[code];
    default:
      return undefined;
  }
}

/**
 * The chip label for one tag, in the reader's interface language.
 *
 * `category` is Shirabe's: 'partOfSpeech' and 'nameType' name what a word IS,
 * 'misc' the register it is used in. Field and dialect carry no Legend entry
 * and print JMdict's own wording.
 */
export function tagLabel(category: string, code: string, full: string, lang: TagLanguage): string {
  const entry = LEGEND_LABELS[legendSlug(category, code) ?? ''];
  if (!entry) return shortened(code, full);

  // Japanese falls back to English, not to Spanish: the Legend leaves a few
  // terms without a Japanese word, and English is the language the rest of a
  // Japanese-interface reader's card is already in.
  return (lang === 'ja' ? entry.ja : entry[lang]) ?? entry.en;
}
