/**
 * 本を「読み上げる単位」に切り分ける。
 *
 * 朗読では、本文をまるごと声に渡してはいけない。
 *   ・どこを読んでいるか分からなくなる（画面で追えない、途中から再開できない）
 *   ・長すぎる文字列で止まるブラウザがある
 *   ・万一のとき、外へ渡りうる量が「本一冊」になってしまう
 * そこで一文ずつに切り、1回に渡すのは常に一文だけにする。
 *
 * ■ 「見せる文」と「読ませる文」を分ける
 *
 * ルビ（漢字のふりがな）は、目で読むときは漢字を、耳で聞くときは
 * ふりがなを使いたい。`｜漢字《かんじ》` は画面に「漢字」と出し、
 * 声には「かんじ」と渡す。これで難読な固有名詞も正しく読まれる。
 */

import type { Block, Inline } from '../read/markdown';
import type { BookContent } from '../read/book';

export interface Line {
  /** 画面に出す文（漢字のまま） */
  text: string;
  /** 声に渡す文（ルビはふりがなに置き換わっている） */
  spoken: string;
  /** 何章目か */
  chapter: number;
  /** 見出しか（画面で大きく見せ、読み上げでは少し間を置く） */
  heading: boolean;
}

/** 1回に渡す文の長さの上限。これを超えたら読点で割る。 */
const MAX_LINE = 120;

/** 文の終わりとみなす文字。 */
const SENTENCE_END = /([。！？!?…]+[」』）\]"']*|\n)/;

interface Rendered {
  text: string;
  spoken: string;
}

/** インライン要素を「見せる文」と「読ませる文」の両方にする。 */
function renderInlines(nodes: Inline[]): Rendered {
  let text = '';
  let spoken = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        text += node.text;
        spoken += node.text;
        break;
      case 'ruby':
        // 目には漢字を、耳にはふりがなを
        text += node.base;
        spoken += node.ruby;
        break;
      case 'boten':
        text += node.text;
        spoken += node.text;
        break;
      case 'em':
      case 'strong':
      case 'del':
      case 'link': {
        const inner = renderInlines(node.children);
        text += inner.text;
        spoken += inner.spoken;
        break;
      }
      case 'image':
        // 画像は読み上げない（説明文があるときだけ、そこに絵があると伝える）
        if (node.alt.trim() !== '') {
          text += `（図：${node.alt}）`;
          spoken += `図、${node.alt}。`;
        }
        break;
      case 'br':
        text += '\n';
        spoken += '\n';
        break;
    }
  }
  return { text, spoken };
}

/**
 * 長い段落を文に割る。
 *
 * 「。」や「？」で切るが、その直後に閉じ括弧が続くときは括弧まで含める
 * （`と言った。」` のような会話文を、括弧だけ置き去りにしないため）。
 */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  const tokens = text.split(SENTENCE_END);
  for (const token of tokens) {
    if (token === undefined || token === '') continue;
    buffer += token;
    if (SENTENCE_END.test(token) && token.trim() !== '') {
      parts.push(buffer);
      buffer = '';
    } else if (token === '\n') {
      if (buffer.trim() !== '') parts.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim() !== '') parts.push(buffer);

  // 句点が一度も出てこない長い文は、読点で割る
  const capped: string[] = [];
  for (const part of parts) {
    if (part.length <= MAX_LINE) {
      capped.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > MAX_LINE) {
      const cut = rest.lastIndexOf('、', MAX_LINE);
      const at = cut > MAX_LINE / 3 ? cut + 1 : MAX_LINE;
      capped.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    if (rest.trim() !== '') capped.push(rest);
  }
  return capped.map((s) => s.trim()).filter((s) => s !== '');
}

export interface SegmentOptions {
  /** 見出しも読み上げる */
  headings: boolean;
  /** ソースコードのかたまりも読み上げる（既定では飛ばす） */
  code: boolean;
  /** 表を読み上げる（既定では飛ばす） */
  tables: boolean;
}

export const DEFAULT_SEGMENT: SegmentOptions = {
  headings: true,
  code: false,
  tables: false,
};

/** ひとつのかたまりから、読み上げる文を取り出す。 */
function linesOfBlock(
  block: Block,
  chapter: number,
  opts: SegmentOptions,
  out: Line[]
): void {
  switch (block.type) {
    case 'heading': {
      if (!opts.headings) return;
      const r = renderInlines(block.children);
      if (r.text.trim() === '') return;
      out.push({ text: r.text, spoken: r.spoken, chapter, heading: true });
      return;
    }
    case 'paragraph': {
      const r = renderInlines(block.children);
      const shown = splitSentences(r.text);
      const said = splitSentences(r.spoken);
      /*
       * ルビの有無で文の数がずれることがある（ふりがなに句点は入らないので
       * 普通はずれないが、絶対とは言えない）。数が合わないときは、
       * 段落まるごとを1つの文として扱い、見せる字と読む字がちぐはぐに
       * ならないようにする。
       */
      if (shown.length === said.length) {
        for (let i = 0; i < shown.length; i++) {
          out.push({ text: shown[i], spoken: said[i], chapter, heading: false });
        }
      } else if (r.text.trim() !== '') {
        out.push({ text: r.text, spoken: r.spoken, chapter, heading: false });
      }
      return;
    }
    case 'quote':
      for (const child of block.children) linesOfBlock(child, chapter, opts, out);
      return;
    case 'list':
      for (const item of block.items) {
        for (const child of item) linesOfBlock(child, chapter, opts, out);
      }
      return;
    case 'table': {
      if (!opts.tables) return;
      for (const row of block.rows) {
        const cells = row.map((cell) => renderInlines(cell));
        const text = cells.map((c) => c.text).join('、');
        const spoken = cells.map((c) => c.spoken).join('、');
        if (text.trim() !== '') out.push({ text, spoken, chapter, heading: false });
      }
      return;
    }
    case 'code': {
      if (!opts.code) return;
      for (const row of block.code.split('\n')) {
        if (row.trim() === '') continue;
        out.push({ text: row, spoken: row, chapter, heading: false });
      }
      return;
    }
    case 'figure':
    case 'hr':
      return;
  }
}

/** 本ぜんたいを、読み上げる文の並びにする。 */
export function segmentBook(book: BookContent, opts: SegmentOptions): Line[] {
  const lines: Line[] = [];
  book.chapters.forEach((chapter, index) => {
    for (const block of chapter.blocks) linesOfBlock(block, index, opts, lines);
  });
  return lines;
}

/** 各章が、文の並びの何番目から始まるか。 */
export function chapterStarts(lines: Line[], chapterCount: number): number[] {
  const starts = new Array<number>(chapterCount).fill(-1);
  lines.forEach((line, i) => {
    if (starts[line.chapter] === -1) starts[line.chapter] = i;
  });
  // 中身の無い章は、次に中身のある章の頭に寄せる
  let last = lines.length;
  for (let i = chapterCount - 1; i >= 0; i--) {
    if (starts[i] === -1) starts[i] = last;
    else last = starts[i];
  }
  return starts;
}

/** 読み上げにかかるおおよその時間（秒）。速さ1.0で毎分およそ350字として。 */
export function estimateSeconds(lines: Line[], from: number, rate: number): number {
  let chars = 0;
  for (let i = from; i < lines.length; i++) chars += lines[i].spoken.length;
  return Math.round((chars / 350) * 60 / Math.max(0.1, rate));
}

/** 秒を「1時間23分」のような言葉にする。 */
export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}
