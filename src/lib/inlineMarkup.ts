/**
 * 本文中のインライン記法（ルビ・傍点）を解析するモジュール。
 *
 * 商業出版の小説では振り仮名（ルビ）と傍点が欠かせないため、本文の
 * プレーンテキストに以下の記法を埋め込めるようにしている。記法は
 * 青空文庫・小説投稿サイトで広く使われているものに合わせてある。
 *
 * - `｜親文字《ふりがな》`  … 親文字を明示してルビを振る（`|` 半角縦棒も可）
 * - `親文字《ふりがな》`    … 直前の漢字列を自動的に親文字にする
 * - `《《強調したい文字》》`  … 傍点（圏点）を打つ
 * - `※《` `※》` `※｜`      … 記号そのものを本文に書きたいときのエスケープ
 *
 * 解析結果はEPUB（`<ruby>`）・DOCX（`w:ruby`）・印刷プレビュー・縦書き
 * リーダーのそれぞれに変換される。
 */

/**
 * 各トークンは、元の文字列（記法を含む）のどこから何文字ぶんだったかを
 * `start` / `rawLength` で保持する。縦書きリーダーのページ分割で、記法の
 * 途中でページを切ってしまわないようにするために使う。
 */
interface TokenSpan {
  start: number;
  rawLength: number;
}

export type InlineToken = TokenSpan &
  (
    | { type: 'text'; text: string }
    | { type: 'ruby'; base: string; ruby: string }
    | { type: 'emphasis'; text: string }
  );

const RUBY_OPEN = '《';
const RUBY_CLOSE = '》';
const BASE_MARKS = '｜|';
const ESCAPE = '※';

/** 自動ルビで親文字として拾う文字（漢字・々・ヶ・〆） */
const BASE_CHAR = /[\u3005\u3006\u3007\u303B\u30F6\u4E00-\u9FFF\uF900-\uFAFF]/;

/** ルビとして許容する最大長。極端に長い《》は本文中の記号とみなす。 */
const MAX_RUBY_LENGTH = 24;

export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buf = '';
  let bufStart = 0;
  let i = 0;

  /** 溜めていた地の文を、元の文字列の [bufStart, end) 範囲として確定する。 */
  const flush = (end: number) => {
    if (buf) {
      tokens.push({ type: 'text', text: buf, start: bufStart, rawLength: end - bufStart });
      buf = '';
    }
    bufStart = end;
  };
  const append = (s: string) => {
    if (!buf) bufStart = i;
    buf += s;
  };

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    // エスケープ（※《 → 《）
    if (
      ch === ESCAPE &&
      next !== undefined &&
      (next === RUBY_OPEN || next === RUBY_CLOSE || BASE_MARKS.includes(next))
    ) {
      append(next);
      i += 2;
      continue;
    }

    // 傍点 《《…》》
    if (ch === RUBY_OPEN && next === RUBY_OPEN) {
      const end = line.indexOf('》》', i + 2);
      const inner = end > 0 ? line.slice(i + 2, end) : '';
      if (end > 0 && inner.length > 0 && !inner.includes(RUBY_OPEN)) {
        flush(i);
        tokens.push({ type: 'emphasis', text: inner, start: i, rawLength: end + 2 - i });
        i = end + 2;
        bufStart = i;
        continue;
      }
    }

    // 親文字を明示するルビ ｜親文字《ふりがな》
    if (BASE_MARKS.includes(ch)) {
      const open = line.indexOf(RUBY_OPEN, i + 1);
      const close = open > 0 ? line.indexOf(RUBY_CLOSE, open + 1) : -1;
      if (open > i + 1 && close > open) {
        const base = line.slice(i + 1, open);
        const ruby = line.slice(open + 1, close);
        if (ruby.length > 0 && ruby.length <= MAX_RUBY_LENGTH && !base.includes(RUBY_OPEN)) {
          flush(i);
          tokens.push({ type: 'ruby', base, ruby, start: i, rawLength: close + 1 - i });
          i = close + 1;
          bufStart = i;
          continue;
        }
      }
      append(ch);
      i++;
      continue;
    }

    // 自動ルビ 親文字《ふりがな》（直前の漢字列を親文字にする）
    if (ch === RUBY_OPEN) {
      const close = line.indexOf(RUBY_CLOSE, i + 1);
      const ruby = close > i ? line.slice(i + 1, close) : '';
      if (close > i + 1 && ruby.length <= MAX_RUBY_LENGTH && !ruby.includes(RUBY_OPEN)) {
        let k = buf.length;
        while (k > 0 && BASE_CHAR.test(buf[k - 1])) k--;
        const base = buf.slice(k);
        if (base.length > 0) {
          // 親文字は漢字だけなのでエスケープを含まず、文字数＝元の文字数
          const baseStart = i - base.length;
          buf = buf.slice(0, k);
          flush(baseStart);
          tokens.push({
            type: 'ruby',
            base,
            ruby,
            start: baseStart,
            rawLength: close + 1 - baseStart,
          });
          i = close + 1;
          bufStart = i;
          continue;
        }
      }
      append(ch);
      i++;
      continue;
    }

    append(ch);
    i++;
  }

  flush(line.length);
  return tokens;
}

/**
 * ページや行を分割してよい位置（記法の途中でない位置）の集合を返す。
 * ルビ・傍点は途中で切ると記法が壊れるため、その内部は含めない。
 */
export function inlineSafeBoundaries(line: string): Set<number> {
  const safe = new Set<number>([0, line.length]);
  for (const token of parseInline(line)) {
    const end = token.start + token.rawLength;
    if (token.type === 'text') {
      for (let offset = token.start; offset <= end; offset++) safe.add(offset);
    } else {
      safe.add(token.start);
      safe.add(end);
    }
  }
  return safe;
}

/** 記法を取り除き、本文だけの文字列にする（文字数カウント・TXT出力用）。 */
export function stripInline(text: string): string {
  if (!hasInlineMarkup(text)) return text;
  return text
    .split(/\r?\n/)
    .map((line) =>
      parseInline(line)
        .map((t) => (t.type === 'ruby' ? t.base : t.text))
        .join('')
    )
    .join('\n');
}

/** ルビ・傍点記法が含まれる可能性があるか（高速な事前判定）。 */
export function hasInlineMarkup(text: string): boolean {
  return text.includes(RUBY_OPEN) || text.includes(ESCAPE);
}

export interface InlineHtmlOptions {
  /** ルビ非対応ビューア向けに (ふりがな) を併記する rp 要素を出力する */
  withRp?: boolean;
  /** 文字列をHTMLエスケープする関数 */
  escape: (s: string) => string;
}

/** 1行分のインライン記法をHTMLに変換する。 */
export function inlineToHtml(line: string, opts: InlineHtmlOptions): string {
  const esc = opts.escape;
  return parseInline(line)
    .map((token) => {
      if (token.type === 'text') return esc(token.text);
      if (token.type === 'emphasis') {
        return `<em class="boten">${esc(token.text)}</em>`;
      }
      const rp = opts.withRp
        ? `<rp>（</rp><rt>${esc(token.ruby)}</rt><rp>）</rp>`
        : `<rt>${esc(token.ruby)}</rt>`;
      return `<ruby>${esc(token.base)}${rp}</ruby>`;
    })
    .join('');
}

/**
 * 選択範囲にルビ記法を挿入した文字列を返す（執筆画面のツールバー用）。
 * 選択範囲が空のときは記法の雛形を挿入する。
 */
export function insertRubyNotation(
  text: string,
  start: number,
  end: number,
  ruby: string
): { text: string; selectionStart: number; selectionEnd: number } {
  const base = text.slice(start, end);
  const inserted = `｜${base}《${ruby}》`;
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    selectionStart: start + 1 + base.length + 1,
    selectionEnd: start + 1 + base.length + 1 + ruby.length,
  };
}

/** 選択範囲を傍点記法で囲んだ文字列を返す。 */
export function insertEmphasisNotation(
  text: string,
  start: number,
  end: number
): { text: string; selectionStart: number; selectionEnd: number } {
  const inner = text.slice(start, end);
  const inserted = `《《${inner}》》`;
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    selectionStart: start + 2,
    selectionEnd: start + 2 + inner.length,
  };
}
