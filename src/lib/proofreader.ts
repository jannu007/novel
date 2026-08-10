/**
 * 日本語小説向けの校正・推敲エンジン。
 *
 * 商業出版・KDPで販売する原稿では、内容の面白さとは別に「組版と表記が
 * 整っていること」が読者の信頼を大きく左右する。ここでは出版社の校正で
 * 定番となっているチェック項目のうち、機械的に判定できるものだけを
 * 実装している（外部APIは使わず、すべて端末内で完結する）。
 *
 * すべての指摘は「本文中の位置（index）と長さ（length）」で表現し、
 * 自動修正できるものは置換後の文字列（replacement）を持つ。位置ベースに
 * 統一することで、複数のルールの修正をまとめて安全に適用できる
 * （後ろの位置から順に置換していけば、前の位置がずれない）。
 */

import { stripInline } from './inlineMarkup';
import { parseImageLine } from './blockContent';

export type Severity = 'error' | 'warning' | 'info';

export interface ProofRule {
  id: string;
  label: string;
  description: string;
  severity: Severity;
  /** 自動修正できるか */
  fixable: boolean;
  /** 既定で有効か（作風によって好みが分かれるものは false） */
  defaultOn: boolean;
}

export interface RawIssue {
  ruleId: string;
  index: number;
  length: number;
  message: string;
  /** 自動修正時に置き換える文字列。undefined の場合は手動修正のみ。 */
  replacement?: string;
}

export interface ProofIssue extends RawIssue {
  chapterId: string;
  chapterTitle: string;
  severity: Severity;
  ruleLabel: string;
  /** 前後を含めた抜粋（ハイライト表示用） */
  before: string;
  target: string;
  after: string;
  line: number;
}

export interface ProofOptions {
  /** 有効なルールID */
  enabled: Set<string>;
  /** 「一文が長い」と判定する文字数 */
  maxSentenceLength: number;
}

// ---------------------------------------------------------------------------
// 文字種・記号の定義
// ---------------------------------------------------------------------------

const OPEN_BRACKETS = '「『（【〈〔｛［';
const CLOSE_BRACKETS = '」』）】〉〕｝］';
/** 会話文・引用などで行頭の字下げを行わない開始文字 */
const NO_INDENT_HEAD = '　「『（【〈〔｛［”“〝＊*—―…・○●◇◆□■△▲▽▼☆★';
/**
 * 段落の末尾として自然な文字。半角の「!」「?」「｡」も含めているのは、
 * それらは「半角の！？」「半角カタカナ」ルールが全角に直す担当であり、
 * 同じ位置に二つのルールの修正が重なるのを避けるため。
 */
const OK_LINE_END = '。！？!?｡…―」』）】〉〕｝］｣”〟＊*：；、';

const HANKAKU_KANA =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮ｡｢｣､･ｰ';
const ZENKAKU_KANA =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョ。「」、・ー';
const DAKUTEN_MAP: Record<string, string> = {
  ｶ: 'ガ', ｷ: 'ギ', ｸ: 'グ', ｹ: 'ゲ', ｺ: 'ゴ',
  ｻ: 'ザ', ｼ: 'ジ', ｽ: 'ズ', ｾ: 'ゼ', ｿ: 'ゾ',
  ﾀ: 'ダ', ﾁ: 'ヂ', ﾂ: 'ヅ', ﾃ: 'デ', ﾄ: 'ド',
  ﾊ: 'バ', ﾋ: 'ビ', ﾌ: 'ブ', ﾍ: 'ベ', ﾎ: 'ボ',
  ｳ: 'ヴ',
};
const HANDAKUTEN_MAP: Record<string, string> = {
  ﾊ: 'パ', ﾋ: 'ピ', ﾌ: 'プ', ﾍ: 'ペ', ﾎ: 'ポ',
};

/** 半角カタカナ（濁点・半濁点を含む）を全角に変換する。 */
export function toFullWidthKana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (next === 'ﾞ' && DAKUTEN_MAP[ch]) {
      out += DAKUTEN_MAP[ch];
      i++;
      continue;
    }
    if (next === 'ﾟ' && HANDAKUTEN_MAP[ch]) {
      out += HANDAKUTEN_MAP[ch];
      i++;
      continue;
    }
    const idx = HANKAKU_KANA.indexOf(ch);
    out += idx >= 0 ? ZENKAKU_KANA[idx] : ch;
  }
  return out;
}

const KANJI_RE = /[\u3005\u3006\u4E00-\u9FFF\uF900-\uFAFF]/;
const HIRAGANA_RE = /[\u3041-\u309F]/;
const KATAKANA_RE = /[\u30A0-\u30FF]/;

// ---------------------------------------------------------------------------
// 解析の下ごしらえ
// ---------------------------------------------------------------------------

interface LineInfo {
  text: string;
  start: number;
  no: number;
  /** 挿絵の記法だけの行（校正の対象にしない） */
  isImage: boolean;
}

function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  let no = 1;
  for (const part of text.split('\n')) {
    lines.push({ text: part, start, no, isImage: parseImageLine(part) !== null });
    start += part.length + 1;
    no++;
  }
  return lines;
}

/**
 * 会話文（「」『』の内側）の範囲を求める。地の文だけを対象にしたい
 * ルール（ら抜き言葉など）で使う。
 */
function dialogueMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '「' || ch === '『') {
      depth++;
      mask[i] = true;
      continue;
    }
    if (ch === '」' || ch === '』') {
      mask[i] = true;
      if (depth > 0) depth--;
      continue;
    }
    mask[i] = depth > 0;
  }
  return mask;
}

interface Sentence {
  text: string;
  start: number;
}

/** 句点・感嘆符などで文を切り出す（閉じ括弧は文に含める）。 */
function splitSentences(lineText: string, lineStart: number): Sentence[] {
  const result: Sentence[] = [];
  let buf = '';
  let start = lineStart;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    buf += ch;
    if ('。！？'.includes(ch)) {
      // 直後に続く閉じ括弧や記号は同じ文に含める
      let j = i + 1;
      while (j < lineText.length && '」』）】〉…！？'.includes(lineText[j])) {
        buf += lineText[j];
        j++;
      }
      i = j - 1;
      if (buf.trim()) result.push({ text: buf, start });
      start = lineStart + i + 1;
      buf = '';
    }
  }
  if (buf.trim()) result.push({ text: buf, start });
  return result;
}

// ---------------------------------------------------------------------------
// 重言・ら抜き言葉の辞書
// ---------------------------------------------------------------------------

/** 重言（意味が重複した言い回し）。fix があれば自動修正できる。 */
const REDUNDANT: { find: string; fix?: string; note: string }[] = [
  { find: '頭痛が痛', note: '「頭が痛い」「頭痛がする」に言い換えられます' },
  { find: '一番最初', fix: '最初', note: '「最初」だけで意味が通ります' },
  { find: '一番最後', fix: '最後', note: '「最後」だけで意味が通ります' },
  { find: 'まず最初に', fix: '最初に', note: '「まず」と「最初」が重複しています' },
  { find: '後で後悔', note: '「後悔する」だけで足ります' },
  { find: '違和感を感じ', fix: '違和感を覚え', note: '「感」が重複しています' },
  { find: '必ず必要', fix: '必要', note: '意味が重複しています' },
  { find: '返事を返', note: '「返事をする」に言い換えられます' },
  { find: '炎天下の下', fix: '炎天下', note: '「下」が重複しています' },
  { find: '過半数を超え', fix: '半数を超え', note: '「過半数」に「超える」の意味が含まれます' },
  { find: '元旦の朝', fix: '元旦', note: '「元旦」は元日の朝を指します' },
  { find: '各都道府県ごと', fix: '都道府県ごと', note: '「各」と「ごと」が重複しています' },
  { find: '射程距離', fix: '射程', note: '「射程」に距離の意味が含まれます' },
  { find: '存亡の危機', fix: '存亡の機', note: '慣用表現は「存亡の機」「存続の危機」です' },
  { find: '被害を被', note: '「被害を受ける」に言い換えられます' },
  { find: 'あとで後悔', note: '「後悔する」だけで足ります' },
  { find: '今の現状', fix: '現状', note: '意味が重複しています' },
  { find: '思いがけないハプニング', fix: 'ハプニング', note: '意味が重複しています' },
  { find: 'いまだ未解決', fix: '未解決', note: '意味が重複しています' },
];

/** ら抜き言葉（地の文では避けるのが一般的）。 */
const RANUKI: { find: string; fix: string }[] = [
  { find: '見れる', fix: '見られる' },
  { find: '見れた', fix: '見られた' },
  { find: '見れな', fix: '見られな' },
  { find: '食べれ', fix: '食べられ' },
  { find: '来れる', fix: '来られる' },
  { find: '来れた', fix: '来られた' },
  { find: '来れな', fix: '来られな' },
  { find: '出れる', fix: '出られる' },
  { find: '出れた', fix: '出られた' },
  { find: '出れな', fix: '出られな' },
  { find: '起きれ', fix: '起きられ' },
  { find: '寝れる', fix: '寝られる' },
  { find: '寝れた', fix: '寝られた' },
  { find: '寝れな', fix: '寝られな' },
  { find: '着れる', fix: '着られる' },
  { find: '着れな', fix: '着られな' },
  { find: '信じれ', fix: '信じられ' },
  { find: '感じれ', fix: '感じられ' },
  { find: '考えれる', fix: '考えられる' },
  { find: '答えれ', fix: '答えられ' },
  { find: '覚えれ', fix: '覚えられ' },
  { find: '止めれ', fix: '止められ' },
  { find: '決めれ', fix: '決められ' },
  { find: '逃げれ', fix: '逃げられ' },
  { find: '投げれ', fix: '投げられ' },
  { find: '受けれ', fix: '受けられ' },
  { find: '掛けれ', fix: '掛けられ' },
  { find: '続けれ', fix: '続けられ' },
];

// ---------------------------------------------------------------------------
// ルール定義
// ---------------------------------------------------------------------------

export const PROOF_RULES: ProofRule[] = [
  {
    id: 'halfwidth-kana',
    label: '半角カタカナ',
    description: '半角カタカナは電子書籍で文字化けや表示崩れの原因になります。全角に統一します。',
    severity: 'error',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'halfwidth-mark',
    label: '半角の！？',
    description: '日本語の本文中の感嘆符・疑問符は全角に統一するのが出版の慣例です。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'ellipsis',
    label: '三点リーダーの使い方',
    description: '三点リーダーは「……」と2つ1組で使い、「...」「・・・」は使わないのが原則です。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'dash',
    label: 'ダッシュの使い方',
    description: 'ダッシュも「――」と2つ1組で使います。全角ダッシュ（―）に統一します。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'mark-space',
    label: '！？のあとの空白',
    description: '「！」「？」の直後に文が続くときは、全角スペースを1つ入れるのが組版の慣例です。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'indent',
    label: '段落の字下げ',
    description: '地の文の段落は行頭に全角スペースを1つ入れます（会話文・記号始まりの行は除く）。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'indent-dialogue',
    label: '会話文の字下げを外す',
    description: '会話文（「」で始まる行）の行頭の全角スペースを取り除きます。作風により好みが分かれるため既定では無効です。',
    severity: 'info',
    fixable: true,
    defaultOn: false,
  },
  {
    id: 'quote-period',
    label: '閉じ括弧の直前の句点',
    description: '「〜。」のように閉じ括弧の直前に句点を置かないのが出版の慣例です。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'bracket-balance',
    label: '括弧の対応',
    description: '開き括弧と閉じ括弧の数が合っていない箇所を検出します。',
    severity: 'error',
    fixable: false,
    defaultOn: true,
  },
  {
    id: 'double-punct',
    label: '句読点の重複',
    description: '「、、」「。。」のように句読点が続いている箇所を検出します。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'wave-dash',
    label: '波ダッシュの統一',
    description: '「～」（全角チルダ）を「〜」（波ダッシュ）に統一します。環境によって表示が変わるためです。',
    severity: 'info',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'latin-quote',
    label: '欧文引用符',
    description: '“ ” " などの欧文引用符は、日本語の本文では「」『』に置き換えます。',
    severity: 'info',
    fixable: false,
    defaultOn: true,
  },
  {
    id: 'line-end',
    label: '段落末の句点漏れ',
    description: '句点や記号で終わっていない段落を検出します。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'long-sentence',
    label: '一文が長い',
    description: '規定の文字数を超える文を検出します。読点で切るか、二文に分けると読みやすくなります。',
    severity: 'info',
    fixable: false,
    defaultOn: true,
  },
  {
    id: 'repeated-ending',
    label: '文末表現の連続',
    description: '同じ文末（「〜た。」など）が3文以上続いている箇所を検出します。単調な印象の原因になります。',
    severity: 'info',
    fixable: false,
    defaultOn: true,
  },
  {
    id: 'repeated-word',
    label: '同語の繰り返し',
    description: '同じ段落の中で同じ語が3回以上使われている箇所を検出します。',
    severity: 'info',
    fixable: false,
    defaultOn: true,
  },
  {
    id: 'redundant',
    label: '重言（意味の重複）',
    description: '「頭痛が痛い」のように意味が重複した言い回しを検出します。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'ranuki',
    label: 'ら抜き言葉',
    description: '地の文の「見れる」などのら抜き言葉を検出します（会話文は話し言葉として除外します）。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'double-particle',
    label: '助詞の重複',
    description: '「がが」「をを」のような打ち間違いを検出します。',
    severity: 'warning',
    fixable: true,
    defaultOn: true,
  },
  {
    id: 'arabic-number',
    label: '算用数字（縦書き向け）',
    description: '縦書きの本文では漢数字が読みやすいため、半角数字を漢数字にする提案をします。既定では無効です。',
    severity: 'info',
    fixable: true,
    defaultOn: false,
  },
  {
    id: 'space-run',
    label: '連続する全角スペース',
    description: '行の途中で全角スペースが2つ以上続いている箇所を検出します。既定では無効です。',
    severity: 'info',
    fixable: true,
    defaultOn: false,
  },
];

export const DEFAULT_ENABLED_RULES = new Set(
  PROOF_RULES.filter((r) => r.defaultOn).map((r) => r.id)
);

export const DEFAULT_MAX_SENTENCE_LENGTH = 70;

// ---------------------------------------------------------------------------
// 個別ルールの検出
// ---------------------------------------------------------------------------

function pushMatches(
  out: RawIssue[],
  text: string,
  re: RegExp,
  build: (m: RegExpExecArray) => Omit<RawIssue, 'index' | 'length'> | null
) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const built = build(m);
    if (built) out.push({ ...built, index: m.index, length: m[0].length });
  }
}

function detectHalfwidthKana(text: string, out: RawIssue[]) {
  pushMatches(out, text, /[｡-ﾟ]+/g, (m) => ({
    ruleId: 'halfwidth-kana',
    message: '半角カタカナが使われています。',
    replacement: toFullWidthKana(m[0]),
  }));
}

function detectHalfwidthMark(text: string, out: RawIssue[]) {
  pushMatches(out, text, /[!?]/g, (m) => ({
    ruleId: 'halfwidth-mark',
    message: `半角の「${m[0]}」が使われています。`,
    replacement: m[0] === '!' ? '！' : '？',
  }));
}

function detectEllipsis(text: string, out: RawIssue[]) {
  // 「...」「・・・」など、三点リーダー以外での表現
  pushMatches(out, text, /\.{2,}|・{3,}|｡{3,}/g, () => ({
    ruleId: 'ellipsis',
    message: '三点リーダーは「……」を使います。',
    replacement: '……',
  }));
  // 「…」の数が奇数
  pushMatches(out, text, /…+/g, (m) =>
    m[0].length % 2 === 1
      ? {
          ruleId: 'ellipsis',
          message: '三点リーダーは偶数個（……）で使うのが原則です。',
          replacement: m[0] + '…',
        }
      : null
  );
}

function detectDash(text: string, out: RawIssue[]) {
  // EMダッシュ(—)・ホリゾンタルバー(―)以外の代用文字を全角ダッシュに寄せる
  pushMatches(out, text, /[—―]+/g, (m) => {
    const normalized = '―'.repeat(m[0].length + (m[0].length % 2));
    if (normalized === m[0]) return null;
    return {
      ruleId: 'dash',
      message:
        m[0].length % 2 === 1
          ? 'ダッシュは偶数個（――）で使うのが原則です。'
          : '全角ダッシュ（―）に統一します。',
      replacement: normalized,
    };
  });
}

function detectMarkSpace(text: string, out: RawIssue[]) {
  // 感嘆符・疑問符のあとに本文が続く場合だけ対象にする（閉じ括弧・句読点・
  // 行末が続くときは空白を入れないのが組版のルール）。
  pushMatches(
    out,
    text,
    /[！？]+(?=[^！？」』）】〉》〕｝］。、，．…―　\n\r])/g,
    (m) => ({
      ruleId: 'mark-space',
      message: '「！」「？」のあとに全角スペースを入れると読みやすくなります。',
      replacement: m[0] + '　',
    })
  );
}

function detectIndent(lines: LineInfo[], out: RawIssue[], enabled: Set<string>) {
  for (const line of lines) {
    const t = line.text;
    if (t.trim() === '') continue;
    const head = t[0];
    if (enabled.has('indent') && !NO_INDENT_HEAD.includes(head)) {
      out.push({
        ruleId: 'indent',
        index: line.start,
        length: 0,
        message: '段落の行頭に全角スペース（字下げ）がありません。',
        replacement: '　',
      });
    }
    if (
      enabled.has('indent-dialogue') &&
      head === '　' &&
      t.length > 1 &&
      '「『'.includes(t[1])
    ) {
      out.push({
        ruleId: 'indent-dialogue',
        index: line.start,
        length: 1,
        message: '会話文の行頭の字下げを外します。',
        replacement: '',
      });
    }
  }
}

function detectQuotePeriod(text: string, out: RawIssue[]) {
  pushMatches(out, text, /。(?=[」』])/g, () => ({
    ruleId: 'quote-period',
    message: '閉じ括弧の直前の句点は省くのが慣例です。',
    replacement: '',
  }));
}

function detectBracketBalance(text: string, out: RawIssue[]) {
  const stack: { ch: string; index: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const openIdx = OPEN_BRACKETS.indexOf(ch);
    if (openIdx >= 0) {
      stack.push({ ch, index: i });
      continue;
    }
    const closeIdx = CLOSE_BRACKETS.indexOf(ch);
    if (closeIdx >= 0) {
      const expectedOpen = OPEN_BRACKETS[closeIdx];
      const top = stack[stack.length - 1];
      if (top && top.ch === expectedOpen) {
        stack.pop();
      } else {
        out.push({
          ruleId: 'bracket-balance',
          index: i,
          length: 1,
          message: `対応する「${expectedOpen}」が見つからない「${ch}」があります。`,
        });
      }
    }
  }
  for (const left of stack) {
    const closing = CLOSE_BRACKETS[OPEN_BRACKETS.indexOf(left.ch)];
    out.push({
      ruleId: 'bracket-balance',
      index: left.index,
      length: 1,
      message: `「${left.ch}」に対応する「${closing}」が見つかりません。`,
    });
  }
}

function detectDoublePunct(text: string, out: RawIssue[]) {
  pushMatches(out, text, /、{2,}/g, () => ({
    ruleId: 'double-punct',
    message: '読点が連続しています。',
    replacement: '、',
  }));
  pushMatches(out, text, /。{2,}/g, (m) => ({
    ruleId: 'double-punct',
    message: '句点が連続しています。',
    replacement: m[0].length >= 3 ? '……' : '。',
  }));
}

function detectWaveDash(text: string, out: RawIssue[]) {
  pushMatches(out, text, /～+/g, (m) => ({
    ruleId: 'wave-dash',
    message: '全角チルダ（～）は環境によって表示が変わります。波ダッシュ（〜）に統一します。',
    replacement: '〜'.repeat(m[0].length),
  }));
}

function detectLatinQuote(text: string, out: RawIssue[]) {
  pushMatches(out, text, /[“”‘’"]/g, (m) => ({
    ruleId: 'latin-quote',
    message: `欧文引用符（${m[0]}）が使われています。「」『』に置き換えてください。`,
  }));
}

function detectLineEnd(lines: LineInfo[], out: RawIssue[]) {
  for (const line of lines) {
    const t = line.text.trimEnd();
    if (t.trim().length < 8) continue;
    const last = t[t.length - 1];
    if (OK_LINE_END.includes(last)) continue;
    out.push({
      ruleId: 'line-end',
      index: line.start + t.length - 1,
      length: 1,
      message: '段落が句点で終わっていません。',
      replacement: last + '。',
    });
  }
}

function detectLongSentence(
  lines: LineInfo[],
  out: RawIssue[],
  maxLength: number
) {
  for (const line of lines) {
    for (const s of splitSentences(line.text, line.start)) {
      const visible = stripInline(s.text).replace(/\s/g, '');
      if (visible.length > maxLength) {
        out.push({
          ruleId: 'long-sentence',
          index: s.start,
          length: s.text.length,
          message: `一文が${visible.length}文字あります（目安${maxLength}文字）。読点で区切るか、二文に分けると読みやすくなります。`,
        });
      }
    }
  }
}

/** 文末（句点の直前2文字）を取り出す。 */
function endingKey(sentence: string): string | null {
  const t = stripInline(sentence).replace(/[」』）】〉…！？　\s]+$/g, '');
  if (!t.endsWith('。')) return null;
  const body = t.slice(0, -1);
  if (body.length < 2) return null;
  return body.slice(-2);
}

function detectRepeatedEnding(lines: LineInfo[], out: RawIssue[]) {
  let runKey: string | null = null;
  let runCount = 0;
  let runStart: Sentence | null = null;
  const flush = (last: Sentence | null) => {
    if (runCount >= 3 && runStart && last) {
      out.push({
        ruleId: 'repeated-ending',
        index: runStart.start,
        length: Math.max(1, last.start + last.text.length - runStart.start),
        message: `文末が「${runKey}。」の形で${runCount}文続いています。語尾に変化をつけると印象が良くなります。`,
      });
    }
    runKey = null;
    runCount = 0;
    runStart = null;
  };

  for (const line of lines) {
    if (line.text.trim() === '') {
      flush(null);
      continue;
    }
    let lastSentence: Sentence | null = null;
    for (const s of splitSentences(line.text, line.start)) {
      // 会話文は語り口として繰り返すことがあるため対象外
      if (s.text.trimStart().startsWith('「')) {
        flush(lastSentence);
        lastSentence = s;
        continue;
      }
      const key = endingKey(s.text);
      if (key === null) {
        flush(lastSentence);
        lastSentence = s;
        continue;
      }
      if (key === runKey) {
        runCount++;
      } else {
        flush(lastSentence);
        runKey = key;
        runCount = 1;
        runStart = s;
      }
      lastSentence = s;
    }
    flush(lastSentence);
  }
}

function detectRepeatedWord(lines: LineInfo[], out: RawIssue[]) {
  const TERM_RE = /[一-鿿]{2,6}|[ァ-ヺー]{3,10}/g;
  for (const line of lines) {
    const body = line.text;
    if (stripInline(body).length < 60) continue;
    const counts = new Map<string, number[]>();
    TERM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TERM_RE.exec(body)) !== null) {
      const list = counts.get(m[0]) ?? [];
      list.push(m.index);
      counts.set(m[0], list);
    }
    for (const [term, positions] of counts) {
      if (positions.length >= 3) {
        out.push({
          ruleId: 'repeated-word',
          index: line.start + positions[0],
          length: term.length,
          message: `同じ段落で「${term}」が${positions.length}回使われています。言い換えや指示語を検討してください。`,
        });
      }
    }
  }
}

function detectRedundant(text: string, out: RawIssue[]) {
  for (const entry of REDUNDANT) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(entry.find, from);
      if (idx < 0) break;
      out.push({
        ruleId: 'redundant',
        index: idx,
        length: entry.find.length,
        message: `重言の可能性があります：${entry.note}。`,
        replacement: entry.fix,
      });
      from = idx + entry.find.length;
    }
  }
}

function detectRanuki(text: string, mask: boolean[], out: RawIssue[]) {
  for (const entry of RANUKI) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(entry.find, from);
      if (idx < 0) break;
      from = idx + entry.find.length;
      if (mask[idx]) continue; // 会話文は話し言葉として許容する
      out.push({
        ruleId: 'ranuki',
        index: idx,
        length: entry.find.length,
        message: `ら抜き言葉です。「${entry.fix}」が本来の形です。`,
        replacement: entry.fix,
      });
    }
  }
}

function detectDoubleParticle(text: string, out: RawIssue[]) {
  pushMatches(out, text, /(が|を|に|へ|で)\1/g, (m) => ({
    ruleId: 'double-particle',
    message: `助詞「${m[1]}」が重なっています。打ち間違いの可能性があります。`,
    replacement: m[1],
  }));
}

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 0〜9999 の算用数字を漢数字（位取りあり）に変換する。 */
export function toKanjiNumber(value: number): string {
  if (value === 0) return '〇';
  const units = ['', '十', '百', '千'];
  const digits = String(value).split('').map(Number).reverse();
  let out = '';
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i];
    if (d === 0) continue;
    if (i > 0 && d === 1) out += units[i];
    else out += KANJI_DIGITS[d] + units[i];
  }
  return out;
}

function detectArabicNumber(text: string, out: RawIssue[]) {
  pushMatches(out, text, /[0-9]{1,4}/g, (m) => {
    const value = Number(m[0]);
    if (!Number.isFinite(value)) return null;
    return {
      ruleId: 'arabic-number',
      message: '縦書きでは漢数字のほうが読みやすくなります。',
      replacement: toKanjiNumber(value),
    };
  });
}

function detectSpaceRun(lines: LineInfo[], out: RawIssue[]) {
  for (const line of lines) {
    const re = /　{2,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text)) !== null) {
      if (m.index === 0) continue; // 行頭の字下げは対象外
      out.push({
        ruleId: 'space-run',
        index: line.start + m.index,
        length: m[0].length,
        message: '全角スペースが連続しています。',
        replacement: '　',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 章単位・作品単位の校正
// ---------------------------------------------------------------------------

/**
 * 挿絵の記法の行を同じ長さの空白に置き換える。
 * 文字位置をずらさずに校正の対象から外すための下ごしらえ。
 */
function maskImageLines(lines: LineInfo[], text: string): string {
  if (!lines.some((l) => l.isImage)) return text;
  const chars = [...text];
  for (const line of lines) {
    if (!line.isImage) continue;
    for (let i = 0; i < line.text.length; i++) chars[line.start + i] = ' ';
  }
  return chars.join('');
}

export function proofreadText(text: string, options: ProofOptions): RawIssue[] {
  const out: RawIssue[] = [];
  if (!text) return out;
  const { enabled } = options;
  const allLines = splitLines(text);
  // 挿絵の行は字下げも句点も不要なので、行単位のルールからは除く
  const lines = allLines.filter((l) => !l.isImage);
  text = maskImageLines(allLines, text);

  if (enabled.has('halfwidth-kana')) detectHalfwidthKana(text, out);
  if (enabled.has('halfwidth-mark')) detectHalfwidthMark(text, out);
  if (enabled.has('ellipsis')) detectEllipsis(text, out);
  if (enabled.has('dash')) detectDash(text, out);
  if (enabled.has('mark-space')) detectMarkSpace(text, out);
  if (enabled.has('indent') || enabled.has('indent-dialogue')) {
    detectIndent(lines, out, enabled);
  }
  if (enabled.has('quote-period')) detectQuotePeriod(text, out);
  if (enabled.has('bracket-balance')) detectBracketBalance(text, out);
  if (enabled.has('double-punct')) detectDoublePunct(text, out);
  if (enabled.has('wave-dash')) detectWaveDash(text, out);
  if (enabled.has('latin-quote')) detectLatinQuote(text, out);
  if (enabled.has('line-end')) detectLineEnd(lines, out);
  if (enabled.has('long-sentence')) {
    detectLongSentence(lines, out, options.maxSentenceLength);
  }
  if (enabled.has('repeated-ending')) detectRepeatedEnding(lines, out);
  if (enabled.has('repeated-word')) detectRepeatedWord(lines, out);
  if (enabled.has('redundant')) detectRedundant(text, out);
  if (enabled.has('ranuki')) detectRanuki(text, dialogueMask(text), out);
  if (enabled.has('double-particle')) detectDoubleParticle(text, out);
  if (enabled.has('arabic-number')) detectArabicNumber(text, out);
  if (enabled.has('space-run')) detectSpaceRun(lines, out);

  return out.sort((a, b) => a.index - b.index || a.length - b.length);
}

const RULE_BY_ID = new Map(PROOF_RULES.map((r) => [r.id, r]));

/** ルールIDから重要度を引く（出版前チェックなどで件数を絞るのに使う）。 */
export function ruleSeverity(ruleId: string): Severity {
  return RULE_BY_ID.get(ruleId)?.severity ?? 'info';
}

const EXCERPT_RADIUS = 24;

export function decorateIssues(
  raw: RawIssue[],
  text: string,
  chapterId: string,
  chapterTitle: string
): ProofIssue[] {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const lineOf = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  return raw.map((issue) => {
    const rule = RULE_BY_ID.get(issue.ruleId);
    const start = issue.index;
    const end = issue.index + issue.length;
    return {
      ...issue,
      chapterId,
      chapterTitle,
      severity: rule?.severity ?? 'info',
      ruleLabel: rule?.label ?? issue.ruleId,
      before: text.slice(Math.max(0, start - EXCERPT_RADIUS), start).replace(/\n/g, '⏎'),
      target: text.slice(start, Math.min(end, start + 120)).replace(/\n/g, '⏎'),
      after: text.slice(end, end + EXCERPT_RADIUS).replace(/\n/g, '⏎'),
      line: lineOf(start),
    };
  });
}

/**
 * 指摘のうち自動修正できるものを本文に適用する。
 * 後ろの位置から順に置換することで、前方の位置がずれないようにしている。
 * 範囲が重なる指摘は、先に処理したものを優先して読み飛ばす。
 */
export function applyFixes(text: string, issues: RawIssue[]): { text: string; applied: number } {
  const fixable = issues
    .filter((i) => i.replacement !== undefined)
    .sort((a, b) => b.index - a.index || b.length - a.length);
  let out = text;
  let applied = 0;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const issue of fixable) {
    const end = issue.index + issue.length;
    if (end > lastStart) continue; // 直前に適用した範囲と重なる
    out = out.slice(0, issue.index) + issue.replacement + out.slice(end);
    lastStart = issue.index;
    applied++;
  }
  return { text: out, applied };
}

// ---------------------------------------------------------------------------
// 表記ゆれの検出
// ---------------------------------------------------------------------------

/**
 * 小説で頻出する表記ゆれの候補群（どちらに統一するかは作者が選ぶ）。
 *
 * 一括置換は単純な文字列置換で行うため、他の語の一部として現れうる表記は
 * 意図しない置換を招く。そのため「時／とき」「事／こと」のように単独では
 * 判別できない語は、あえて辞書に含めていない。
 */
const VARIANT_DICTIONARY: string[][] = [
  ['できる', '出来る'],
  ['できた', '出来た'],
  ['できない', '出来ない'],
  ['ください', '下さい'],
  ['いただく', '頂く'],
  ['いたします', '致します'],
  ['ありがとう', '有難う'],
  ['すべて', '全て'],
  ['ほとんど', '殆ど'],
  ['たくさん', '沢山'],
  ['もちろん', '勿論'],
  ['なぜ', '何故'],
  ['どこ', '何処'],
  ['いつも', '何時も'],
  ['ぜひ', '是非'],
  ['ただし', '但し'],
  ['または', '又は'],
  ['および', '及び'],
  ['さらに', '更に'],
  ['すぐに', '直ぐに'],
  ['ちょうど', '丁度'],
  ['とにかく', '兎に角'],
  ['振り返る', '振りかえる', 'ふり返る'],
  ['問い合わせ', '問合せ', '問い合せ'],
  ['受け付け', '受付け', '受け付'],
  ['引っ越し', '引越し', '引越'],
  ['打ち合わせ', '打合せ', '打ち合せ'],
  ['話し掛ける', '話しかける'],
  ['見つめる', '見詰める'],
  ['呟く', 'つぶやく'],
  ['囁く', 'ささやく'],
  ['頷く', 'うなずく'],
  ['微笑む', 'ほほ笑む', 'ほほえむ'],
  ['溜め息', 'ため息', '溜息'],
  ['たたずむ', '佇む'],
  ['すれ違う', '擦れ違う'],
  ['分かる', '解る', '判る', 'わかる'],
  ['きれい', '綺麗'],
  ['あいさつ', '挨拶'],
  ['子ども', '子供'],
];

export interface VariantGroup {
  /** 見つかった表記とその出現回数 */
  forms: { form: string; count: number }[];
  total: number;
}

/** カタカナ語の長音の有無（サーバ / サーバー）を自動で拾う。 */
function detectKatakanaVariants(text: string): string[][] {
  const counts = new Map<string, number>();
  const re = /[ァ-ヺー]{3,12}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  const groups: string[][] = [];
  for (const word of counts.keys()) {
    if (!word.endsWith('ー')) continue;
    const without = word.slice(0, -1);
    if (counts.has(without)) groups.push([word, without]);
  }
  return groups;
}

/** 作品全体を走査し、両方の表記が使われている語を洗い出す。 */
export function detectVariantGroups(texts: string[]): VariantGroup[] {
  const joined = texts.join('\n');
  const candidates = [...VARIANT_DICTIONARY, ...detectKatakanaVariants(joined)];
  const groups: VariantGroup[] = [];
  const seen = new Set<string>();

  for (const forms of candidates) {
    const counted = countForms(joined, forms).filter((f) => f.count > 0);
    if (counted.length < 2) continue;
    const key = counted.map((c) => c.form).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    counted.sort((a, b) => b.count - a.count);
    groups.push({
      forms: counted,
      total: counted.reduce((s, c) => s + c.count, 0),
    });
  }
  return groups.sort((a, b) => b.total - a.total);
}

/**
 * 表記ゆれの各候補が何回使われているかを数える。
 *
 * 「サーバ」は「サーバー」の一部でもあるため、単純に数えると短いほうが
 * 過大に集計されてしまう。長い表記から順に数え、数え終わった箇所を
 * 伏せ字に置き換えることで、二重に数えないようにしている。
 */
function countForms(text: string, forms: string[]): { form: string; count: number }[] {
  const mark = pickPlaceholder(text);
  if (!mark) return forms.map((form) => ({ form, count: 0 }));
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  const counts = new Map<string, number>();
  let work = text;
  for (const form of ordered) {
    if (!form) {
      counts.set(form, 0);
      continue;
    }
    const parts = work.split(form);
    counts.set(form, parts.length - 1);
    if (parts.length > 1) work = parts.join(mark.repeat(form.length));
  }
  return forms.map((form) => ({ form, count: counts.get(form) ?? 0 }));
}

/** 本文中に現れない1文字を選ぶ（一括置換の作業用の目印にする）。 */
function pickPlaceholder(text: string): string {
  for (let code = 0xe000; code <= 0xe0ff; code++) {
    const ch = String.fromCharCode(code);
    if (!text.includes(ch)) return ch;
  }
  return '';
}

/**
 * 指定した表記に統一した本文を返す。
 *
 * 候補どうしが部分文字列の関係にあっても壊れないよう、いったんすべての
 * 候補を目印に置き換えてから、まとめて統一先の表記に戻している
 * （「サーバ」→「サーバー」の置換で「サーバーー」になるのを防ぐ）。
 */
export function unifyVariant(text: string, group: VariantGroup, chosen: string): string {
  const mark = pickPlaceholder(text);
  if (!mark) return text;
  const forms = group.forms
    .map((f) => f.form)
    .filter((f) => f.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const form of forms) {
    out = out.split(form).join(mark);
  }
  return out.split(mark).join(chosen);
}

// ---------------------------------------------------------------------------
// 品質メトリクス
// ---------------------------------------------------------------------------

export interface MetricRow {
  key: string;
  label: string;
  value: number;
  display: string;
  idealText: string;
  status: 'good' | 'warn';
  hint: string;
}

export interface QualityMetrics {
  chars: number;
  sentences: number;
  paragraphs: number;
  rows: MetricRow[];
  score: number;
}

function bandScore(value: number, low: number, high: number, span: number): number {
  if (value >= low && value <= high) return 100;
  const distance = value < low ? low - value : value - high;
  return Math.max(0, Math.round(100 - (distance / span) * 100));
}

export function analyzeQuality(
  texts: string[],
  maxSentenceLength = DEFAULT_MAX_SENTENCE_LENGTH
): QualityMetrics {
  const raw = texts.join('\n');
  const plain = stripInline(raw);
  const chars = plain.replace(/\s/g, '').length;

  const paragraphs = plain.split('\n').filter((l) => l.trim() !== '').length;
  const sentences: string[] = [];
  for (const line of plain.split('\n')) {
    if (line.trim() === '') continue;
    for (const s of splitSentences(line, 0)) sentences.push(s.text.trim());
  }

  const sentenceLengths = sentences.map((s) => s.replace(/\s/g, '').length);
  const totalSentenceChars = sentenceLengths.reduce((a, b) => a + b, 0);
  const avgSentence = sentences.length ? totalSentenceChars / sentences.length : 0;
  const longCount = sentenceLengths.filter((l) => l > maxSentenceLength).length;
  const longRatio = sentences.length ? (longCount / sentences.length) * 100 : 0;

  // 会話文比率
  let dialogueChars = 0;
  const mask = dialogueMask(plain);
  for (let i = 0; i < plain.length; i++) {
    if (mask[i] && !/\s/.test(plain[i])) dialogueChars++;
  }
  const dialogueRatio = chars ? (dialogueChars / chars) * 100 : 0;

  // 文字種の比率
  let kanji = 0;
  let hiragana = 0;
  let katakana = 0;
  for (const ch of plain) {
    if (KANJI_RE.test(ch)) kanji++;
    else if (HIRAGANA_RE.test(ch)) hiragana++;
    else if (KATAKANA_RE.test(ch)) katakana++;
  }
  const kanjiRatio = chars ? (kanji / chars) * 100 : 0;
  const hiraganaRatio = chars ? (hiragana / chars) * 100 : 0;
  const katakanaRatio = chars ? (katakana / chars) * 100 : 0;

  // 読点の密度
  const commas = (plain.match(/、/g) ?? []).length;
  const commaPerSentence = sentences.length ? commas / sentences.length : 0;

  // 文末表現のバリエーション（連続する文の文末2文字のユニーク率）
  const endings = sentences
    .map((s) => endingKey(s))
    .filter((e): e is string => e !== null);
  const endingVariety = endings.length
    ? (new Set(endings).size / endings.length) * 100
    : 100;

  const rows: MetricRow[] = [
    {
      key: 'dialogue',
      label: '会話文の比率',
      value: dialogueRatio,
      display: `${dialogueRatio.toFixed(1)}%`,
      idealText: '20〜45%',
      status: dialogueRatio >= 20 && dialogueRatio <= 45 ? 'good' : 'warn',
      hint:
        dialogueRatio < 20
          ? '会話が少なめです。地の文が続くと読者の集中が切れやすくなります。'
          : dialogueRatio > 45
            ? '会話が多めです。情景や心情の描写を足すと厚みが出ます。'
            : '読みやすいバランスです。',
    },
    {
      key: 'avg-sentence',
      label: '平均の文の長さ',
      value: avgSentence,
      display: `${avgSentence.toFixed(1)}字`,
      idealText: '25〜45字',
      status: avgSentence >= 25 && avgSentence <= 45 ? 'good' : 'warn',
      hint:
        avgSentence < 25
          ? '短文が続いています。リズムは良い一方、単調にならないか確認してください。'
          : avgSentence > 45
            ? '一文が長めです。読点で区切るか二文に分けると読みやすくなります。'
            : '読みやすい長さです。',
    },
    {
      key: 'long-ratio',
      label: `長い文（${maxSentenceLength}字超）の割合`,
      value: longRatio,
      display: `${longRatio.toFixed(1)}%`,
      idealText: '10%以下',
      status: longRatio <= 10 ? 'good' : 'warn',
      hint:
        longRatio > 10
          ? '長い文が多めです。推敲タブの指摘から分割候補を確認できます。'
          : '問題ありません。',
    },
    {
      key: 'kanji',
      label: '漢字の比率',
      value: kanjiRatio,
      display: `${kanjiRatio.toFixed(1)}%`,
      idealText: '25〜35%',
      status: kanjiRatio >= 25 && kanjiRatio <= 35 ? 'good' : 'warn',
      hint:
        kanjiRatio > 35
          ? '漢字が多めで硬い印象になります。ひらがなに開く語を検討してください。'
          : kanjiRatio < 25
            ? '漢字が少なめです。幼い印象にならないか確認してください。'
            : '読みやすい配分です。',
    },
    {
      key: 'comma',
      label: '一文あたりの読点',
      value: commaPerSentence,
      display: `${commaPerSentence.toFixed(2)}個`,
      idealText: '0.8〜2.0個',
      status: commaPerSentence >= 0.8 && commaPerSentence <= 2 ? 'good' : 'warn',
      hint:
        commaPerSentence < 0.8
          ? '読点が少なめです。息継ぎの位置を意識すると読みやすくなります。'
          : commaPerSentence > 2
            ? '読点が多めです。文を分けたほうが締まることがあります。'
            : '自然な密度です。',
    },
    {
      key: 'ending',
      label: '文末表現のバリエーション',
      value: endingVariety,
      display: `${endingVariety.toFixed(1)}%`,
      idealText: '60%以上',
      status: endingVariety >= 60 ? 'good' : 'warn',
      hint:
        endingVariety < 60
          ? '同じ語尾が繰り返されています。体言止めや倒置を混ぜると単調さが和らぎます。'
          : '語尾に変化がついています。',
    },
    {
      key: 'katakana',
      label: 'カタカナの比率',
      value: katakanaRatio,
      display: `${katakanaRatio.toFixed(1)}%`,
      idealText: '15%以下',
      status: katakanaRatio <= 15 ? 'good' : 'warn',
      hint:
        katakanaRatio > 15
          ? 'カタカナ語が多めです。固有名詞以外は和語に置き換えられないか確認してください。'
          : '問題ありません。',
    },
    {
      key: 'hiragana',
      label: 'ひらがなの比率',
      value: hiraganaRatio,
      display: `${hiraganaRatio.toFixed(1)}%`,
      idealText: '45〜65%',
      status: hiraganaRatio >= 45 && hiraganaRatio <= 65 ? 'good' : 'warn',
      hint: '漢字とひらがなの配分の目安です。',
    },
  ];

  const score = chars
    ? Math.round(
        (bandScore(dialogueRatio, 20, 45, 30) +
          bandScore(avgSentence, 25, 45, 25) +
          bandScore(longRatio, 0, 10, 20) +
          bandScore(kanjiRatio, 25, 35, 15) +
          bandScore(commaPerSentence, 0.8, 2, 1) +
          bandScore(endingVariety, 60, 100, 40)) /
          6
      )
    : 0;

  return {
    chars,
    sentences: sentences.length,
    paragraphs,
    rows,
    score,
  };
}
