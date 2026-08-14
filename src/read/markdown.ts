/**
 * Markdown を「読む本」に変換するための解析モジュール。
 *
 * ■ この実装の方針（安全性）
 * 外部のMarkdownライブラリを一切使わず、この1ファイルだけで解析を完結させている。
 * 依存が増えるほど、その依存が乗っ取られたときに本文が盗まれたり書き換えられたりする
 * 危険（サプライチェーン攻撃）が増えるためで、ここではその経路そのものを断っている。
 *
 * さらに、解析結果は **HTMLの文字列ではなく構造（AST）** として返す。表示側は
 * この構造からReactの要素を組み立てるだけなので、本文がどんな内容であっても
 * HTMLとして解釈されることがない（`dangerouslySetInnerHTML` を使う場所が無い）。
 *
 * - `<script>` などの生HTMLは **タグとして扱わず、ただの文字** として表示する。
 * - リンクは `http` / `https` / `mailto` と本の中の見出し(`#…`)だけを許可し、
 *   `javascript:` のような危険な行き先は最初から取り除く。
 * - 画像も `data:image/...`（svgを除く）だけを通し、外部への通信は行わない。
 *
 * ■ 対応する記法
 * 見出し・段落・引用・箇条書き・番号つき・コード（```／字下げ）・水平線・表・
 * 強調・打ち消し・リンク・画像・脚注なしの参照リンク・改行、および日本語の
 * 小説で使うルビ（`｜漢字《かんじ》`）と傍点（`《《強調》》`）。
 */

import { parseInline as parseJapaneseInline } from '../lib/inlineMarkup';

export type Align = 'left' | 'center' | 'right' | null;

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em'; children: Inline[] }
  | { type: 'strong'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'link'; href: string; title?: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'ruby'; base: string; ruby: string }
  | { type: 'boten'; text: string }
  | { type: 'br' };

export type Block =
  | { type: 'heading'; level: number; id: string; children: Inline[]; plain: string }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'figure'; src: string; alt: string }
  | { type: 'code'; code: string; lang: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { type: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { type: 'hr' };

interface LinkDef {
  href: string;
  title?: string;
}

/* ------------------------------------------------------------------ */
/* URLの安全化                                                          */
/* ------------------------------------------------------------------ */

/** 制御文字を取り除く（`java\nscript:` のような細工を無効にするため）。 */
function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g, '').trim();
}

/**
 * リンク先として安全なURLだけを返す。許可しないものは `null`。
 * 許可するのは次の3種類だけで、それ以外は本文中の文字として表示する。
 *   - `http:` / `https:`  … 外部サイト（新しいタブで開く）
 *   - `mailto:`           … メール
 *   - `#見出し`           … 同じ本の中の移動
 */
export function safeHref(raw: string): string | null {
  const url = stripControl(raw);
  if (url === '') return null;
  if (url.startsWith('#')) return url;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (!scheme) return null; // 相対パスは本の外を指すので開かない
  const name = scheme[1].toLowerCase();
  if (name === 'http' || name === 'https' || name === 'mailto') return url;
  return null;
}

/**
 * 画像として安全なURLだけを返す。
 * 外部への通信を一切行わないため、通すのは埋め込み画像（`data:`）のみ。
 * SVGはそれ自体がスクリプトを持てるので除外する。
 */
export function safeImageSrc(raw: string): string | null {
  const url = stripControl(raw);
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(url)) {
    return url.replace(/\s+/g, '');
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* インライン解析                                                       */
/* ------------------------------------------------------------------ */

const PUNCT = /[!-/:-@[-`{-~　-〿！-･]/;

/** 日本語・中国語・韓国語など、行のあいだに空白を入れない文字か。 */
const CJK =
  /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/;

function isCjk(ch: string | undefined): boolean {
  return ch !== undefined && CJK.test(ch);
}

/** 日本語のルビ・傍点記法を、地の文のトークンに展開する。 */
function expandJapanese(text: string, out: Inline[]): void {
  if (!text.includes('《') && !text.includes('※')) {
    if (text) out.push({ type: 'text', text });
    return;
  }
  for (const token of parseJapaneseInline(text)) {
    if (token.type === 'ruby') out.push({ type: 'ruby', base: token.base, ruby: token.ruby });
    else if (token.type === 'emphasis') out.push({ type: 'boten', text: token.text });
    else if (token.text) out.push({ type: 'text', text: token.text });
  }
}

/**
 * 1つの区切り（`*` `_` `~`）に対応する閉じ記号を探す。
 * コード（`` ` ``）とエスケープ（`\*`）の中は数えない。
 */
function findCloser(src: string, from: number, mark: string, len: number): number {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const tick = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(tick, i + tick.length);
      i = end < 0 ? i + tick.length : end + tick.length;
      continue;
    }
    if (ch === mark) {
      let n = 0;
      while (src[i + n] === mark) n++;
      // 直前が空白の閉じ記号は閉じとみなさない（`a * b * c` を強調にしない）
      const prev = src[i - 1];
      if (n >= len && prev !== undefined && !/\s/.test(prev)) return i;
      i += n;
      continue;
    }
    i++;
  }
  return -1;
}

/** リンクの `[…]` に対応する `]` を、入れ子を数えながら探す。 */
function findBracket(src: string, from: number): number {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `(url "title")` を読み取る。戻り値は行き先と、消費した文字数。 */
function readDestination(
  src: string,
  from: number
): { href: string; title?: string; end: number } | null {
  if (src[from] !== '(') return null;
  let i = from + 1;
  let depth = 1;
  let raw = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      raw += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
    raw += ch;
    i++;
  }
  if (i >= src.length) return null;
  const body = raw.trim();
  const titled = /^(\S*)\s+["'(](.*)["')]$/s.exec(body);
  const href = titled ? titled[1] : body;
  const title = titled ? titled[2] : undefined;
  return { href: href.replace(/^<|>$/g, ''), title, end: i + 1 };
}

/** 段落1つぶんの文字列を、インライン要素の並びに変換する。 */
export function parseInlines(src: string, defs: Map<string, LinkDef>): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      expandJapanese(buf, out);
      buf = '';
    }
  };

  while (i < src.length) {
    const ch = src[i];

    // 記号のエスケープ（\* など）。Markdownの記号を「ただの文字」に戻す。
    if (ch === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // 行末の改行（末尾2つの空白、または \ ）
    if (ch === '\n') {
      const hard = /[ ]{2,}$/.test(buf) || buf.endsWith('\\');
      buf = buf.replace(/(?:[ ]+|\\)$/, '');
      const before = buf[buf.length - 1];
      const after = src[i + 1];
      flush();
      if (hard) out.push({ type: 'br' });
      else if (!(isCjk(before) && isCjk(after))) {
        // 日本語どうしの行つなぎでは空白を入れない（本文に不自然な空きが出るため）
        out.push({ type: 'text', text: ' ' });
      }
      i++;
      continue;
    }

    // コード（`code`）
    if (ch === '`') {
      const ticks = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        flush();
        const code = src.slice(i + ticks.length, end).replace(/\n/g, ' ');
        out.push({ type: 'code', text: code.replace(/^ (.*) $/, '$1') });
        i = end + ticks.length;
        continue;
      }
    }

    // 自動リンク（<https://example.com>）
    if (ch === '<') {
      const close = src.indexOf('>', i + 1);
      const inner = close > 0 ? src.slice(i + 1, close) : '';
      if (close > 0 && /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+$/.test(inner)) {
        const href = safeHref(inner);
        flush();
        if (href) out.push({ type: 'link', href, children: [{ type: 'text', text: inner }] });
        else out.push({ type: 'text', text: inner });
        i = close + 1;
        continue;
      }
      // それ以外の `<` は生HTMLの可能性がある。タグとしては解釈せず、文字として残す。
    }

    // 画像（![alt](src)）とリンク（[text](href) / [text][ref]）
    if (ch === '!' && src[i + 1] === '[') {
      const close = findBracket(src, i + 2);
      if (close > 0) {
        const alt = src.slice(i + 2, close);
        const dest = readDestination(src, close + 1);
        if (dest) {
          flush();
          const safe = safeImageSrc(dest.href);
          if (safe) out.push({ type: 'image', src: safe, alt });
          else if (alt) expandJapanese(alt, out);
          i = dest.end;
          continue;
        }
      }
    }
    if (ch === '[') {
      const close = findBracket(src, i + 1);
      if (close > 0) {
        const label = src.slice(i + 1, close);
        const dest = readDestination(src, close + 1);
        let href: string | null = null;
        let title: string | undefined;
        let end = -1;
        if (dest) {
          href = safeHref(dest.href);
          title = dest.title;
          end = dest.end;
        } else {
          // 参照リンク：[text][ref] または [ref]
          const refMatch = /^\[([^\]]*)\]/.exec(src.slice(close + 1));
          const key = (refMatch && refMatch[1].trim() ? refMatch[1] : label).toLowerCase();
          const def = defs.get(key.trim());
          if (def) {
            href = safeHref(def.href);
            title = def.title;
            end = close + 1 + (refMatch ? refMatch[0].length : 0);
          }
        }
        if (end > 0) {
          flush();
          const children = parseInlines(label, defs);
          if (href) out.push({ type: 'link', href, title, children });
          else out.push(...children); // 危険な行き先は文字として表示する
          i = end;
          continue;
        }
      }
    }

    // 強調（**強い** / *弱い* / __強い__ / _弱い_）と打ち消し（~~取り消し~~）
    if (ch === '*' || ch === '_' || ch === '~') {
      let n = 0;
      while (src[i + n] === ch) n++;
      const nextCh = src[i + n];
      const opens = nextCh !== undefined && !/\s/.test(nextCh);
      // `_` は単語の途中では強調にしない（snake_case を壊さないため）
      const intraword = ch === '_' && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1]);
      const len = ch === '~' ? 2 : Math.min(n, 3);
      if (opens && !intraword && (ch !== '~' || n >= 2)) {
        const closeAt = findCloser(src, i + n, ch, len);
        if (closeAt > 0) {
          flush();
          const children = parseInlines(src.slice(i + n, closeAt), defs);
          if (ch === '~') out.push({ type: 'del', children });
          else if (len === 3) out.push({ type: 'strong', children: [{ type: 'em', children }] });
          else if (len === 2) out.push({ type: 'strong', children });
          else out.push({ type: 'em', children });
          i = closeAt + len;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** インライン要素から見出しなどに使う素のテキストを取り出す。 */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'code':
          return n.text;
        case 'boten':
          return n.text;
        case 'ruby':
          return n.base;
        case 'image':
          return n.alt;
        case 'br':
          return ' ';
        default:
          return inlineText(n.children);
      }
    })
    .join('');
}

/* ------------------------------------------------------------------ */
/* ブロック解析                                                         */
/* ------------------------------------------------------------------ */

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const RE_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const RE_QUOTE = /^ {0,3}>[ ]?/;
const RE_BULLET = /^( {0,3})([-*+])([ \t]+|$)/;
const RE_ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/;
const RE_DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]*)>?(?:[ \t]+["'(](.*)["')])?[ \t]*$/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

const isBlank = (line: string) => /^[ \t]*$/.test(line);

function startsBlock(line: string): boolean {
  return (
    RE_FENCE.test(line) ||
    RE_ATX.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_BULLET.test(line) ||
    RE_ORDERED.test(line)
  );
}

/** 見出しから、目次のジャンプ先に使うIDを作る。 */
function slugify(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[\s　]+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]/gu, '')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'h';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/** 表の区切り行（|---|:--:|）を読み取る。 */
function parseAlignRow(line: string): Align[] | null {
  if (!line.includes('-') || !line.includes('|')) return null;
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const align: Align[] = [];
  for (const cell of cells) {
    const m = /^(:?)-{1,}(:?)$/.exec(cell.trim());
    if (!m) return null;
    align.push(m[1] && m[2] ? 'center' : m[2] ? 'right' : m[1] ? 'left' : null);
  }
  return align;
}

/** 表の1行を、`\|` のエスケープを尊重してセルに分ける。 */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

interface Ctx {
  defs: Map<string, LinkDef>;
  ids: Set<string>;
}

/** 参照リンクの定義（[ref]: URL）を先に集めておく。 */
function collectDefs(lines: string[], defs: Map<string, LinkDef>): void {
  let fence: string | null = null;
  for (const line of lines) {
    const f = RE_FENCE.exec(line);
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (f) {
      fence = f[1][0].repeat(3);
      continue;
    }
    const m = RE_DEF.exec(line);
    if (m && m[2]) defs.set(m[1].trim().toLowerCase(), { href: m[2], title: m[3] });
  }
}

function parseBlocks(lines: string[], ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // 参照リンクの定義行は本文に出さない
    if (RE_DEF.test(line)) {
      i++;
      continue;
    }

    // ``` で囲むコード
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].trim().split(/\s+/)[0] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \t]*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 閉じるフェンス
      blocks.push({ type: 'code', code: body.join('\n'), lang });
      continue;
    }

    // # 見出し
    const atx = RE_ATX.exec(line);
    if (atx) {
      const children = parseInlines((atx[2] ?? '').trim(), ctx.defs);
      const plain = inlineText(children);
      blocks.push({
        type: 'heading',
        level: atx[1].length,
        id: slugify(plain, ctx.ids),
        children,
        plain,
      });
      i++;
      continue;
    }

    // --- 水平線
    if (RE_HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // > 引用
    if (RE_QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        if (RE_QUOTE.test(lines[i])) inner.push(lines[i].replace(RE_QUOTE, ''));
        else inner.push(lines[i]); // 引用の続き（遅延継続）
        i++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner, ctx) });
      continue;
    }

    // 箇条書き・番号つき
    if (RE_BULLET.test(line) || RE_ORDERED.test(line)) {
      const list = parseList(lines, i, ctx);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    // 表
    if (line.includes('|') && i + 1 < lines.length) {
      const align = parseAlignRow(lines[i + 1]);
      if (align) {
        const head = splitRow(line).map((c) => parseInlines(c.trim(), ctx.defs));
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
          rows.push(splitRow(lines[i]).map((c) => parseInlines(c.trim(), ctx.defs)));
          i++;
        }
        blocks.push({ type: 'table', head, align, rows });
        continue;
      }
    }

    // 字下げ（4つの空白）によるコード
    if (/^ {4,}\S/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || isBlank(lines[i]))) {
        body.push(lines[i].replace(/^ {4}/, ''));
        i++;
      }
      while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
      blocks.push({ type: 'code', code: body.join('\n'), lang: '' });
      continue;
    }

    // 段落（空行か、別のブロックが始まるまで）
    const para: string[] = [];
    let setext = 0;
    while (i < lines.length && !isBlank(lines[i])) {
      // `===` `---` の下線は見出し。水平線より先に見る必要がある。
      if (para.length > 0 && RE_SETEXT.test(lines[i])) {
        setext = lines[i].trim().startsWith('=') ? 1 : 2;
        i++;
        break;
      }
      if (para.length > 0 && startsBlock(lines[i])) break;
      if (para.length > 0 && RE_DEF.test(lines[i])) break;
      // 行末の空白は「改行」の記法なので残し、行頭の字下げだけを取り除く
      para.push(lines[i].replace(/^[ \t]+/, ''));
      i++;
    }
    const text = para.join('\n');
    if (text === '') continue;
    if (setext > 0) {
      const children = parseInlines(text, ctx.defs);
      const plain = inlineText(children);
      blocks.push({ type: 'heading', level: setext, id: slugify(plain, ctx.ids), children, plain });
      continue;
    }
    const children = parseInlines(text, ctx.defs);
    // 画像だけの段落は「挿絵」として、1ページを使って大きく見せる
    if (children.length === 1 && children[0].type === 'image') {
      blocks.push({ type: 'figure', src: children[0].src, alt: children[0].alt });
    } else if (children.length > 0) {
      blocks.push({ type: 'paragraph', children });
    }
  }

  return blocks;
}

/** 箇条書き・番号つきの並びをまとめて読み取る。 */
function parseList(
  lines: string[],
  from: number,
  ctx: Ctx
): { block: Extract<Block, { type: 'list' }>; next: number } {
  const first = RE_ORDERED.exec(lines[from]);
  const ordered = Boolean(first);
  const start = first ? Number(first[2]) : 1;
  const items: Block[][] = [];
  let tight = true;
  let i = from;
  let sawBlank = false;

  while (i < lines.length) {
    const m = ordered ? RE_ORDERED.exec(lines[i]) : RE_BULLET.exec(lines[i]);
    if (!m) break;
    const marker = m[0];
    const indent = marker.length;
    const body: string[] = [lines[i].slice(indent)];
    i++;
    let blankRun = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        blankRun++;
        if (blankRun > 1) break;
        body.push('');
        i++;
        continue;
      }
      const isNewItem = ordered ? RE_ORDERED.test(l) : RE_BULLET.test(l);
      const indented = new RegExp(`^ {${Math.min(indent, 4)},}`).test(l);
      if (indented) {
        if (blankRun > 0) tight = false;
        blankRun = 0;
        body.push(l.slice(indent));
        i++;
        continue;
      }
      if (isNewItem || blankRun > 0 || startsBlock(l)) break;
      body.push(l); // 遅延継続（字下げのない続きの行）
      i++;
    }
    while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
    items.push(parseBlocks(body, ctx));
    // 項目のあいだに空行があれば「ゆるい」箇条書きとして段落で組む
    if (i < lines.length && isBlank(lines[i])) {
      sawBlank = true;
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      const cont = j < lines.length && (ordered ? RE_ORDERED.test(lines[j]) : RE_BULLET.test(lines[j]));
      if (!cont) break;
      tight = false;
      i = j;
    }
  }
  void sawBlank;

  return { block: { type: 'list', ordered, start, tight, items }, next: i };
}

/** Markdown 全体を解析してブロックの並びにする。 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const defs = new Map<string, LinkDef>();
  collectDefs(lines, defs);
  return parseBlocks(lines, { defs, ids: new Set() });
}
