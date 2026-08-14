/**
 * Markdown を本（電子書籍）に変換するための解析器。
 *
 * 外部のMarkdownライブラリは使わず、この一枚で完結させている。理由は二つ。
 *
 *  1. 供給網（サプライチェーン）の安全性。取り込んだ原稿は個人の未発表作品
 *     そのものなので、第三者のコードを増やさないほど安全に保てる。
 *  2. 生HTMLを一切通さないという方針を、パーサの段階で保証できる。
 *     `<script>` などは中身ごと捨て、その他のタグは文字だけ残す。
 *     したがって、この解析器の出力に実行可能なHTMLは含まれない。
 *
 * 対応記法（CommonMark + GFM の実用的な範囲）:
 *   見出し / 段落 / 箇条書き・番号付き（入れ子可） / 引用 / 水平線 /
 *   コード（フェンス・インライン） / 表 / リンク（参照・自動リンク含む） /
 *   画像 / 脚注 `[^1]` / 強調・斜体・打ち消し / 改行 / YAMLフロントマター
 *
 * これに加えて、日本語の小説組版に必要な記法を通す（青空文庫互換）:
 *   ｜親文字《ふりがな》 … ルビ、《《文字》》 … 傍点
 */

import { parseInline } from '../lib/inlineMarkup';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** 章をまたいだ内部リンクの行き先（章立てを決めたあとで解決する）。 */
export interface LinkTarget {
  chapterIndex: number;
  anchor: string;
}

export type Span =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Span[] }
  | { type: 'em'; children: Span[] }
  | { type: 'strike'; children: Span[] }
  | { type: 'code'; text: string }
  | { type: 'ruby'; base: string; ruby: string }
  | { type: 'boten'; text: string }
  | { type: 'break' }
  | { type: 'footnote'; id: string; index: number }
  | {
      type: 'link';
      href: string;
      title: string;
      children: Span[];
      /** 同じ本の中を指すリンク。章立てを決めたあとで埋める。 */
      target?: LinkTarget;
      /** 本の外（Web）へのリンク。 */
      external: boolean;
    }
  | { type: 'image'; src: string; alt: string };

export type Align = 'left' | 'center' | 'right' | '';

export type Block =
  | { type: 'heading'; level: number; children: Span[]; text: string; anchor: string }
  | { type: 'paragraph'; children: Span[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string; lang: string }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'table'; header: Span[][]; rows: Span[][][]; align: Align[] }
  | { type: 'image'; src: string; alt: string; caption: string }
  | { type: 'hr' };

export interface Footnote {
  id: string;
  index: number;
  blocks: Block[];
}

export type WarningKind =
  | 'raw-html'
  | 'remote-image'
  | 'missing-image'
  | 'blocked-link'
  | 'missing-anchor'
  | 'missing-footnote'
  | 'huge-input';

export interface Warning {
  kind: WarningKind;
  message: string;
  detail?: string;
}

export interface ParsedDoc {
  frontMatter: Record<string, string>;
  blocks: Block[];
  footnotes: Footnote[];
  warnings: Warning[];
  /** 本文中で参照された画像のうち、手元にファイルが無かったもの。 */
  missingImages: string[];
}

export interface ParseOptions {
  /**
   * 一緒に取り込んだ画像ファイル。キーはファイル名とパスの両方で引ける。
   * ここに無い画像は、内容に合わせた自動生成の挿絵で埋める。
   */
  assets?: Map<string, string>;
}

// ---------------------------------------------------------------------------
// 入力の下ごしらえ
// ---------------------------------------------------------------------------

/** 実行可能な内容ごと捨てる要素。 */
const DANGEROUS_ELEMENTS = /<(script|style|iframe|object|embed|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const OPEN_DANGEROUS = /<(script|style|iframe|object|embed|template|svg|math)\b[^>]*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** タグらしきもの。ただし `<https://…>`（自動リンク）は対象外にする。 */
const ANY_TAG = /<\/?(?![a-zA-Z][a-zA-Z0-9+.-]*:)[a-zA-Z][^>]*>/g;

/**
 * 生HTMLを落とす。タグの中身が実行され得るものは中身ごと、
 * それ以外は文字だけ残す（`<b>強い</b>` → `強い`）。
 * 取り除いた数を数えて、あとで利用者に知らせる。
 */
function stripHtml(src: string): { text: string; removed: number } {
  let removed = 0;
  const count = (s: string) => {
    removed++;
    return s.startsWith('<br') || s.startsWith('<BR') ? '\n' : '';
  };
  let out = src.replace(HTML_COMMENT, () => {
    removed++;
    return '';
  });
  out = out.replace(DANGEROUS_ELEMENTS, () => {
    removed++;
    return '';
  });
  out = out.replace(OPEN_DANGEROUS, () => {
    removed++;
    return '';
  });
  out = out.replace(ANY_TAG, count);
  return { text: out, removed };
}

/** コードブロックの中身はHTML除去の対象外にするため、先に退避しておく。 */
function protectFences(src: string): { text: string; restore: (s: string) => string } {
  const stash: string[] = [];
  const text = src.replace(/^([ \t]*)(```|~~~)([^\n]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm, (m) => {
    stash.push(m);
    return `\u0000FENCE${stash.length - 1}\u0000`;
  });
  return {
    text,
    // eslint-disable-next-line no-control-regex -- 目印として使う制御文字はここで確実に戻す
    restore: (s: string) => s.replace(/\u0000FENCE(\d+)\u0000/g, (_, i) => stash[Number(i)]),
  };
}

/** YAMLフロントマター（先頭の `---` で囲まれた領域）から書誌情報を取り出す。 */
function extractFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { meta, body: src };
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) meta[kv[1].toLowerCase()] = value;
  }
  return { meta, body: src.slice(m[0].length) };
}

// ---------------------------------------------------------------------------
// URLの安全確認
// ---------------------------------------------------------------------------

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
/** 電子書籍に埋め込める画像のデータURL。 */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

export type UrlKind = 'internal' | 'external' | 'image-data' | 'asset' | 'blocked';

/**
 * リンク先を分類する。`javascript:` のような実行を伴うものは通さない。
 * これは表示側（React）で守られているかどうかに関係なく、
 * 書き出したEPUB/DOCXにも危険なURLを残さないための入口の防壁である。
 */
export function classifyUrl(raw: string): UrlKind {
  const url = raw.trim();
  if (!url) return 'blocked';
  if (url.startsWith('#')) return 'internal';
  if (SAFE_DATA_IMAGE.test(url)) return 'image-data';
  if (SAFE_SCHEME.test(url)) return 'external';
  // スキームを持たないもの（相対パス）は、同梱ファイルの参照とみなす
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return 'blocked';
  return 'asset';
}

// ---------------------------------------------------------------------------
// 見出しのアンカー
// ---------------------------------------------------------------------------

/** 見出し文字列を、リンク（`#…`）で指せる名前に正規化する。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, '-');
}

/** EPUB/XHTML の id として使える文字列にする（先頭は英字でなければならない）。 */
export function anchorId(index: number): string {
  return `h${index}`;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

interface Ctx {
  linkDefs: Map<string, { href: string; title: string }>;
  footnoteOrder: Map<string, number>;
  footnoteBodies: Map<string, string[]>;
  warnings: Map<string, Warning>;
  assets: Map<string, string>;
  missingImages: Set<string>;
  headingCount: number;
}

function warn(ctx: Ctx, kind: WarningKind, message: string, detail?: string) {
  if (!ctx.warnings.has(kind)) ctx.warnings.set(kind, { kind, message, detail });
}

/** 上限。極端に大きな入力でブラウザが固まらないようにする。 */
const MAX_CHARS = 4_000_000;

export function parseMarkdown(source: string, options: ParseOptions = {}): ParsedDoc {
  const warnings = new Map<string, Warning>();

  let src = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  if (src.length > MAX_CHARS) {
    src = src.slice(0, MAX_CHARS);
    warnings.set('huge-input', {
      kind: 'huge-input',
      message: `原稿が大きすぎるため、先頭 ${MAX_CHARS.toLocaleString()} 文字だけを読み込みました。`,
    });
  }

  const { meta, body } = extractFrontMatter(src);

  // コードブロックを守ったうえで生HTMLを落とす
  const fenced = protectFences(body);
  const stripped = stripHtml(fenced.text);
  if (stripped.removed > 0) {
    warnings.set('raw-html', {
      kind: 'raw-html',
      message: `HTMLタグ ${stripped.removed} 件を取り除きました（文字はそのまま残しています）。`,
      detail: '安全のため、原稿に書かれたHTMLは実行も出力もしません。',
    });
  }
  const text = fenced.restore(stripped.text);

  const ctx: Ctx = {
    linkDefs: new Map(),
    footnoteOrder: new Map(),
    footnoteBodies: new Map(),
    warnings,
    assets: options.assets ?? new Map(),
    missingImages: new Set(),
    headingCount: 0,
  };

  const lines = collectDefinitions(text.split('\n'), ctx);
  const blocks = parseBlocks(lines, ctx);

  // 脚注は本文での登場順に並べる
  const footnotes: Footnote[] = [];
  for (const [id, index] of [...ctx.footnoteOrder.entries()].sort((a, b) => a[1] - b[1])) {
    const bodyLines = ctx.footnoteBodies.get(id);
    if (!bodyLines) {
      warn(ctx, 'missing-footnote', `脚注 [^${id}] の説明が見つかりませんでした。`);
      continue;
    }
    footnotes.push({ id, index, blocks: parseBlocks(bodyLines, ctx) });
  }

  return {
    frontMatter: meta,
    blocks,
    footnotes,
    warnings: [...warnings.values()],
    missingImages: [...ctx.missingImages],
  };
}

/** リンク参照定義と脚注定義を抜き出し、本文の行から取り除く。 */
function collectDefinitions(lines: string[], ctx: Ctx): string[] {
  const out: string[] = [];
  let inFence = false;
  let fenceMark = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^ {0,3}(```|~~~)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1];
      } else if (line.trim().startsWith(fenceMark)) {
        inFence = false;
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const fn = /^ {0,3}\[\^([^\]\s]+)\]:\s?(.*)$/.exec(line);
    if (fn) {
      const bodyLines = [fn[2]];
      // 続く行のうち、インデントされたもの（＋間の空行）は脚注の続きとみなす
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next.trim() === '') {
          const after = lines[j + 1];
          if (after !== undefined && /^ {2,}\S/.test(after)) {
            bodyLines.push('');
            j++;
            continue;
          }
          break;
        }
        if (!/^ {2,}\S/.test(next)) break;
        bodyLines.push(next.replace(/^ {2,4}/, ''));
        j++;
      }
      ctx.footnoteBodies.set(fn[1], bodyLines);
      i = j - 1;
      continue;
    }

    const def = /^ {0,3}\[([^\]^][^\]]*)\]:\s*(\S+)(?:\s+["'(]([^"')]*)["')])?\s*$/.exec(line);
    if (def) {
      ctx.linkDefs.set(def[1].trim().toLowerCase(), { href: def[2], title: def[3] ?? '' });
      continue;
    }

    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ブロック解析
// ---------------------------------------------------------------------------

const RE_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const RE_FENCE = /^( {0,3})(```+|~~~+)[ \t]*([^\s`]*)[ \t]*$/;
const RE_QUOTE = /^ {0,3}>[ ]?/;
const RE_BULLET = /^( {0,6})([-*+])[ \t]+(.*)$/;
const RE_ORDERED = /^( {0,6})(\d{1,9})[.)][ \t]+(.*)$/;
const RE_TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

function isBlockStart(line: string): boolean {
  return (
    line.trim() === '' ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_FENCE.test(line) ||
    RE_QUOTE.test(line) ||
    RE_BULLET.test(line) ||
    RE_ORDERED.test(line)
  );
}

function parseBlocks(lines: string[], ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = RE_FENCE.exec(line);
    if (fence) {
      const mark = fence[2][0].repeat(3);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) {
        buf.push(lines[i].slice(fence[1].length));
        i++;
      }
      i++; // 閉じフェンス
      blocks.push({ type: 'code', text: buf.join('\n'), lang: fence[3] ?? '' });
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      const raw = heading[2];
      ctx.headingCount++;
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseSpans(raw, ctx),
        text: plainText(raw),
        anchor: anchorId(ctx.headingCount),
      });
      i++;
      continue;
    }

    if (RE_HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && (RE_QUOTE.test(lines[i]) || (lines[i].trim() !== '' && buf.length > 0 && !isBlockStart(lines[i])))) {
        buf.push(lines[i].replace(RE_QUOTE, ''));
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(buf, ctx) });
      continue;
    }

    if (RE_BULLET.test(line) || RE_ORDERED.test(line)) {
      const [list, next] = parseList(lines, i, ctx);
      blocks.push(list);
      i = next;
      continue;
    }

    // 表（見出し行のすぐ下が区切り行）
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const [table, next] = parseTable(lines, i, ctx);
      blocks.push(table);
      i = next;
      continue;
    }

    // 段落（Setext見出しも見る）
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const cur = lines[i];
      if (buf.length > 0) {
        if (/^ {0,3}={2,}[ \t]*$/.test(cur)) {
          ctx.headingCount++;
          blocks.push(setext(buf.join('\n'), 1, ctx));
          buf.length = 0;
          i++;
          break;
        }
        if (/^ {0,3}-{2,}[ \t]*$/.test(cur)) {
          ctx.headingCount++;
          blocks.push(setext(buf.join('\n'), 2, ctx));
          buf.length = 0;
          i++;
          break;
        }
        if (isBlockStart(cur)) break;
      }
      buf.push(cur.trim());
      i++;
    }
    if (buf.length > 0) {
      const paragraph = buf.join('\n');
      const image = onlyImage(paragraph, ctx);
      blocks.push(image ?? { type: 'paragraph', children: parseSpans(paragraph, ctx) });
    }
  }

  return blocks;
}

function setext(text: string, level: number, ctx: Ctx): Block {
  return {
    type: 'heading',
    level,
    children: parseSpans(text, ctx),
    text: plainText(text),
    anchor: anchorId(ctx.headingCount),
  };
}

/** 段落が画像1枚だけなら、挿絵ブロックとして扱う（キャプション付きで組める）。 */
function onlyImage(paragraph: string, ctx: Ctx): Block | null {
  const m = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+["']([^"']*)["'])?\s*\)$/.exec(paragraph.trim());
  if (!m) return null;
  const src = resolveImage(m[2], ctx);
  if (!src) return null;
  return { type: 'image', src, alt: m[1], caption: m[3] ?? m[1] };
}

function parseList(lines: string[], start: number, ctx: Ctx): [Block, number] {
  const first = RE_ORDERED.exec(lines[start]);
  const ordered = Boolean(first);
  const startNumber = first ? Number(first[2]) : 1;
  const items: string[][] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const bullet = ordered ? RE_ORDERED.exec(line) : RE_BULLET.exec(line);
    if (!bullet) {
      // 空行のあとも同じ種類の項目が続くなら、まだ同じ箇条書き
      if (line.trim() === '') {
        const next = lines[i + 1];
        if (next !== undefined && (ordered ? RE_ORDERED.test(next) : RE_BULLET.test(next))) {
          i++;
          continue;
        }
        if (next !== undefined && /^ {2,}\S/.test(next)) {
          items[items.length - 1]?.push('');
          i++;
          continue;
        }
      }
      // 字下げされた続きの行は、直前の項目の内容
      if (/^ {2,}\S/.test(line) && items.length > 0) {
        items[items.length - 1].push(line.replace(/^ {2}/, ''));
        i++;
        continue;
      }
      break;
    }
    items.push([bullet[3]]);
    i++;
  }

  return [
    {
      type: 'list',
      ordered,
      start: startNumber,
      items: items.map((item) => parseBlocks(item, ctx)),
    },
    i,
  ];
}

function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseTable(lines: string[], start: number, ctx: Ctx): [Block, number] {
  const header = splitRow(lines[start]);
  const align: Align[] = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const rows: Span[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
    rows.push(splitRow(lines[i]).map((cell) => parseSpans(cell, ctx)));
    i++;
  }
  return [
    {
      type: 'table',
      header: header.map((cell) => parseSpans(cell, ctx)),
      align,
      rows,
    },
    i,
  ];
}

// ---------------------------------------------------------------------------
// インライン解析
// ---------------------------------------------------------------------------

const PUNCT = '\\`*_{}[]()#+-.!|~<>"\'';

function resolveImage(rawSrc: string, ctx: Ctx): string | null {
  const src = rawSrc.trim();
  const kind = classifyUrl(src);
  if (kind === 'image-data') return src;
  if (kind === 'asset') {
    const file = src.replace(/^\.?\//, '');
    const found = ctx.assets.get(file) ?? ctx.assets.get(file.split('/').pop() ?? '');
    if (found) return found;
    ctx.missingImages.add(src);
    warn(
      ctx,
      'missing-image',
      '原稿から参照された画像ファイルが見つかりませんでした。',
      '画像も一緒に読み込むか、自動生成の挿絵で埋めることができます。'
    );
    return null;
  }
  if (kind === 'external') {
    ctx.missingImages.add(src);
    warn(
      ctx,
      'remote-image',
      'インターネット上の画像は取り込みません。',
      'このアプリは通信を一切行わない設計です。該当箇所は自動生成の挿絵に置き換えられます。'
    );
    return null;
  }
  return null;
}

/** ルビ・傍点の記法を展開しつつ、素の文字列をスパンにする。 */
function textSpans(text: string): Span[] {
  if (!text) return [];
  const spans: Span[] = [];
  for (const token of parseInline(text)) {
    if (token.type === 'ruby') spans.push({ type: 'ruby', base: token.base, ruby: token.ruby });
    else if (token.type === 'emphasis') spans.push({ type: 'boten', text: token.text });
    else spans.push({ type: 'text', text: token.text });
  }
  return spans;
}

function parseSpans(source: string, ctx: Ctx): Span[] {
  const spans: Span[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) {
      spans.push(...textSpans(buf));
      buf = '';
    }
  };

  while (i < source.length) {
    const ch = source[i];
    const rest = source.slice(i);

    // 記号のエスケープ
    if (ch === '\\' && PUNCT.includes(source[i + 1] ?? '')) {
      buf += source[i + 1];
      i += 2;
      continue;
    }

    // 改行。日本語の原稿では改行そのものに意味があることが多いため、
    // 行末に空白があってもなくても改行として残す。段落として分けるかどうかは、
    // 章立てを組むとき（book.ts）に設定で切り替える。
    if (ch === '\n') {
      buf = buf.replace(/[ ]+$/, '').replace(/\\$/, '');
      flush();
      spans.push({ type: 'break' });
      i++;
      continue;
    }

    // インラインコード
    if (ch === '`') {
      const run = /^`+/.exec(rest)![0];
      const close = source.indexOf(run, i + run.length);
      if (close > 0) {
        flush();
        spans.push({ type: 'code', text: source.slice(i + run.length, close).trim() });
        i = close + run.length;
        continue;
      }
    }

    // 画像
    if (ch === '!' && source[i + 1] === '[') {
      const parsed = matchLink(source, i + 1);
      if (parsed) {
        const dest = resolveDestination(parsed, ctx);
        const src = dest ? resolveImage(dest.href, ctx) : null;
        flush();
        if (src) spans.push({ type: 'image', src, alt: parsed.label });
        else if (parsed.label) spans.push(...textSpans(parsed.label));
        i = parsed.end;
        continue;
      }
    }

    // 脚注参照
    if (ch === '[' && source[i + 1] === '^') {
      const close = source.indexOf(']', i + 2);
      if (close > 0) {
        const id = source.slice(i + 2, close);
        if (id && !/\s/.test(id)) {
          flush();
          let index = ctx.footnoteOrder.get(id);
          if (index === undefined) {
            index = ctx.footnoteOrder.size + 1;
            ctx.footnoteOrder.set(id, index);
          }
          spans.push({ type: 'footnote', id, index });
          i = close + 1;
          continue;
        }
      }
    }

    // リンク
    if (ch === '[') {
      const parsed = matchLink(source, i);
      if (parsed) {
        const dest = resolveDestination(parsed, ctx);
        flush();
        if (!dest) {
          warn(
            ctx,
            'blocked-link',
            '安全でないリンクを取り除きました。',
            'javascript: など、開くと動作するリンクは本に入れません。'
          );
          spans.push(...parseSpans(parsed.label, ctx));
        } else {
          const kind = classifyUrl(dest.href);
          spans.push({
            type: 'link',
            href: dest.href,
            title: dest.title,
            children: parseSpans(parsed.label, ctx),
            external: kind === 'external',
          });
        }
        i = parsed.end;
        continue;
      }
    }

    // 自動リンク <https://…>
    if (ch === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest);
      if (auto) {
        flush();
        spans.push({
          type: 'link',
          href: auto[1],
          title: '',
          children: [{ type: 'text', text: auto[1] }],
          external: true,
        });
        i += auto[0].length;
        continue;
      }
    }

    // 裸のURL
    if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(rest)) {
      const url = /^https?:\/\/[^\s<>「」（）()【】、。]+/i.exec(rest)![0].replace(/[.,]$/, '');
      flush();
      spans.push({
        type: 'link',
        href: url,
        title: '',
        children: [{ type: 'text', text: url }],
        external: true,
      });
      i += url.length;
      continue;
    }

    // 打ち消し
    if (ch === '~' && source[i + 1] === '~') {
      const close = source.indexOf('~~', i + 2);
      if (close > 0) {
        flush();
        spans.push({ type: 'strike', children: parseSpans(source.slice(i + 2, close), ctx) });
        i = close + 2;
        continue;
      }
    }

    // 強調（**…** / __…__）
    if ((ch === '*' && source[i + 1] === '*') || (ch === '_' && source[i + 1] === '_')) {
      const mark = ch + ch;
      const close = source.indexOf(mark, i + 2);
      if (close > i + 2) {
        flush();
        spans.push({ type: 'strong', children: parseSpans(source.slice(i + 2, close), ctx) });
        i = close + 2;
        continue;
      }
    }

    // 斜体（*…* / _…_）。`_` は語中では使わない（snake_case を壊さないため）
    if (ch === '*' || (ch === '_' && !/[\p{L}\p{N}]/u.test(source[i - 1] ?? ''))) {
      const close = source.indexOf(ch, i + 1);
      if (close > i + 1 && !/^\s/.test(source.slice(i + 1))) {
        const inner = source.slice(i + 1, close);
        if (!inner.includes('\n')) {
          flush();
          spans.push({ type: 'em', children: parseSpans(inner, ctx) });
          i = close + 1;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return spans;
}

interface LinkMatch {
  label: string;
  href?: string;
  title?: string;
  ref?: string;
  end: number;
}

/** `[ラベル](行き先 "題")` / `[ラベル][参照]` / `[参照]` を読む。 */
function matchLink(source: string, start: number): LinkMatch | null {
  let depth = 0;
  let i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  const label = source.slice(start + 1, i);
  const after = source.slice(i + 1);

  // `(行き先 "題")`。行き先には空白（日本語の見出し名など）も入りうるので、
  // 正規表現ではなく、対応する閉じ括弧を数えて切り出す。
  if (after.startsWith('(')) {
    let depth = 0;
    let j = 0;
    for (; j < after.length; j++) {
      const ch = after[j];
      if (ch === '\\') {
        j++;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0 && j < after.length) {
      let inner = after.slice(1, j).trim();
      let title = '';
      const withTitle = /\s+["'(]([^"')]*)["')]$/.exec(inner);
      if (withTitle) {
        title = withTitle[1];
        inner = inner.slice(0, withTitle.index).trim();
      }
      return {
        label,
        href: inner.replace(/^<|>$/g, ''),
        title,
        end: i + 1 + j + 1,
      };
    }
  }
  const ref = /^\[([^\]]*)\]/.exec(after);
  if (ref) {
    return { label, ref: (ref[1] || label).trim(), end: i + 1 + ref[0].length };
  }
  return { label, ref: label.trim(), end: i + 1 };
}

function resolveDestination(
  match: LinkMatch,
  ctx: Ctx
): { href: string; title: string } | null {
  let href = match.href;
  let title = match.title ?? '';
  if (href === undefined) {
    const def = ctx.linkDefs.get((match.ref ?? '').toLowerCase());
    if (!def) return null;
    href = def.href;
    title = title || def.title;
  }
  if (classifyUrl(href) === 'blocked') return null;
  return { href, title };
}

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

/** 記法を取り除いた素の文字列（見出し名・目次・文字数カウント用）。 */
export function plainText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/｜([^《]*)《[^》]*》/g, '$1')
    .replace(/《《([^》]*)》》/g, '$1')
    .replace(/《[^》]*》/g, '')
    .trim();
}

/** スパンの並びから素の文字列を取り出す。 */
export function spansToText(spans: Span[]): string {
  return spans
    .map((span) => {
      switch (span.type) {
        case 'text':
          return span.text;
        case 'code':
          return span.text;
        case 'boten':
          return span.text;
        case 'ruby':
          return span.base;
        case 'break':
          return '\n';
        case 'strong':
        case 'em':
        case 'strike':
        case 'link':
          return spansToText(span.children);
        default:
          return '';
      }
    })
    .join('');
}

/** ブロックの並びから素の文字列を取り出す。 */
export function blocksToText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (list: Block[]) => {
    for (const block of list) {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          parts.push(spansToText(block.children));
          break;
        case 'quote':
          walk(block.blocks);
          break;
        case 'list':
          for (const item of block.items) walk(item);
          break;
        case 'table':
          for (const row of block.rows) for (const cell of row) parts.push(spansToText(cell));
          break;
        case 'code':
          parts.push(block.text);
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
  return parts.join('\n');
}
