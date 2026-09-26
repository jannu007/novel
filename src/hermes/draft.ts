/**
 * 「読んでいるこの段」と「原文のこの行」を結びつけるところ。
 *
 * このアプリの肝は、本の形で読みながら原文そのものを直せることにある。
 * そのために必要なのは次の3つで、どれもこのファイルにまとめてある。
 *
 *   1. 画面の段 → 原文の行     … `sourceOfBlock` / `replaceBlock`
 *   2. 画面の文字 → 地の文の位置 … `plainOf`（描画と同じ順で数える）
 *   3. 直したあとも印を見失わない … `reanchor`
 *
 * 1 は解析器が付ける行範囲（`markdown.ts` の `lines`）をそのまま使う。
 * 行で持つので、直した段だけを差し替えても、ほかの場所は1文字も動かない。
 */

import type { BookContent } from '../read/book';
import type { Inline, SpannedBlock } from '../read/markdown';
import type { Mark } from './db';

/* ------------------------------------------------------------------ */
/* 地の文の取り出し                                                     */
/* ------------------------------------------------------------------ */

/**
 * かたまりの「地の文」。印の位置はこの文字列の中で数える。
 *
 * **描画（`render.tsx`）が文字を出す順・出す量とぴったり同じ**でなければ、
 * 画面で選んだところと印の位置がずれる。片方だけ直すと静かにずれるので、
 * 数えるのも描くのも、この `walkInline` の並びだけを見るようにしてある。
 */
export function plainInline(nodes: Inline[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        out += node.text;
        break;
      case 'em':
      case 'strong':
      case 'del':
      case 'link':
        out += plainInline(node.children);
        break;
      case 'ruby':
        // ルビの読みは行の脇に置かれる飾りなので、地の文には数えない
        out += node.base;
        break;
      case 'boten':
        out += node.text;
        break;
      case 'br':
        out += '\n';
        break;
      case 'image':
        break;
    }
  }
  return out;
}

/**
 * かたまりの地の文。印の位置はこの文字列の中で数える。
 *
 * **画面に出ている文字と1文字ずれてもいけない。** 印は「何文字目から
 * 何文字目まで」でしか場所を持たないので、ここで数えた文字と、画面で
 * 指でなぞった文字（`selection.ts` がDOMから数える）が食い違うと、
 * 付けたはずの場所からずれた位置に線が引かれる。
 *
 * そこで、引用や箇条書き・表の「継ぎ目」には何も入れない。入れてしまうと、
 * DOM側には無い文字を数えることになってずれる。一覧に見せる文字が
 * つながって読みにくくなるぶんは `excerptOf` が別に組み立てる。
 */
export function plainOf(block: SpannedBlock | undefined): string {
  if (!block) return '';
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return plainInline(block.children);
    case 'code':
      return block.code;
    case 'quote':
      return block.children.map((b) => plainOf(b as SpannedBlock)).join('');
    case 'list':
      return block.items
        .map((item) => item.map((b) => plainOf(b as SpannedBlock)).join(''))
        .join('');
    case 'table':
      return [block.head, ...block.rows]
        .map((row) => row.map((cell) => plainInline(cell)).join(''))
        .join('');
    case 'figure':
      // 画面に出るのは説明文（figcaption）だけ。無ければ文字も無い。
      return block.alt;
    case 'hr':
      return '';
  }
}

/**
 * 一覧に見せる書き出し。
 * こちらは読みやすさが第一なので、継ぎ目に区切りを入れてよい
 * （印の位置には使わない）。
 */
export function excerptOf(block: SpannedBlock | undefined, limit = 60): string {
  return summaryOf(block).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function summaryOf(block: SpannedBlock | undefined): string {
  if (!block) return '';
  switch (block.type) {
    case 'quote':
      return block.children.map((b) => summaryOf(b as SpannedBlock)).join(' ');
    case 'list':
      return block.items
        .map((item) => item.map((b) => summaryOf(b as SpannedBlock)).join(' '))
        .join(' / ');
    case 'table':
      return [block.head, ...block.rows]
        .map((row) => row.map((cell) => plainInline(cell)).join(' | '))
        .join(' / ');
    case 'figure':
      return block.alt || '（挿絵）';
    default:
      return plainOf(block);
  }
}

/* ------------------------------------------------------------------ */
/* 原文の行との行き来                                                   */
/* ------------------------------------------------------------------ */

/** 改行を揃える。行番号が合わなくなるので、保存する前に必ず通す。 */
export function normalizeSource(source: string): string {
  return source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** そのかたまりが、原文の何行目から何行目まででできているか（`to` は含まない）。 */
export function sourceRangeOf(
  book: BookContent,
  block: SpannedBlock | undefined
): { from: number; to: number } | null {
  if (!block?.lines) return null;
  return { from: book.bodyLine + block.lines.from, to: book.bodyLine + block.lines.to };
}

/** そのかたまりの元になっている原文（そのまま編集欄に出せる）。 */
export function sourceOfBlock(
  source: string,
  book: BookContent,
  block: SpannedBlock | undefined
): string | null {
  const range = sourceRangeOf(book, block);
  if (!range) return null;
  return source.split('\n').slice(range.from, range.to).join('\n');
}

/**
 * 段ひとつぶんを書き換えた原稿を返す。
 *
 * 行の差し替えなので、直した段より後ろの文字は1つも動かない
 * （解析し直すのは、行の数が変われば後ろの行番号がずれるため）。
 */
export function replaceBlock(
  source: string,
  book: BookContent,
  block: SpannedBlock | undefined,
  next: string
): string | null {
  const range = sourceRangeOf(book, block);
  if (!range) return null;
  const lines = source.split('\n');
  const replacement = normalizeSource(next).split('\n');
  return [...lines.slice(0, range.from), ...replacement, ...lines.slice(range.to)].join('\n');
}

/* ------------------------------------------------------------------ */
/* 印の貼り直し                                                         */
/* ------------------------------------------------------------------ */

/**
 * 直したせいで居場所が変わった印を、探し直して貼り直す。
 *
 * 探す順は「もと居た場所 → 同じかたまりの中 → 同じ章 → 本全体」。
 * 近いところから探すので、同じ言葉が何度も出てくる原稿でも、
 * だいたい元の場所に戻る。どこにも無ければ `lost` を立てて残す。
 * 見つからないからといって黙って捨てると、書き手が気づけないため。
 */
export interface AnchoredMark extends Mark {
  /** 印を付けた文字が見つからなくなった */
  lost?: boolean;
}

export function reanchor(book: BookContent, mark: Mark): AnchoredMark {
  const quote = mark.quote;
  if (quote === '') return { ...mark, lost: true };

  const at = (chapter: number, block: number): string =>
    plainOf(book.chapters[chapter]?.blocks[block]);

  // 1. もと居た場所にそのまま残っているか
  if (at(mark.chapter, mark.block).slice(mark.start, mark.end) === quote) return mark;

  // 2. 同じかたまりの中で、いちばん近いところ
  const here = at(mark.chapter, mark.block);
  const near = nearestIndex(here, quote, mark.start);
  if (near >= 0) return { ...mark, start: near, end: near + quote.length };

  // 3. 同じ章の中 → 4. 本全体。どちらも前から順に探す
  const order: number[] = [mark.chapter];
  for (let c = 0; c < book.chapters.length; c++) if (c !== mark.chapter) order.push(c);
  for (const c of order) {
    const blocks = book.chapters[c]?.blocks ?? [];
    for (let b = 0; b < blocks.length; b++) {
      if (c === mark.chapter && b === mark.block) continue;
      const found = plainOf(blocks[b]).indexOf(quote);
      if (found >= 0) {
        return { ...mark, chapter: c, block: b, start: found, end: found + quote.length };
      }
    }
  }

  return { ...mark, lost: true };
}

/** `from` にいちばん近い出現位置。見つからなければ -1。 */
function nearestIndex(haystack: string, needle: string, from: number): number {
  let best = -1;
  let bestDistance = Infinity;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    const distance = Math.abs(at - from);
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    }
    at = haystack.indexOf(needle, at + 1);
  }
  return best;
}

/** 本のいまの形に合わせて、印をまとめて貼り直す。 */
export function reanchorAll(book: BookContent, marks: Mark[]): AnchoredMark[] {
  return marks.map((mark) => reanchor(book, mark));
}

/** 印を、章とかたまりごとに引けるようにまとめる。描画に渡す。 */
export function marksByBlock(marks: AnchoredMark[], chapter: number): Map<number, AnchoredMark[]> {
  const out = new Map<number, AnchoredMark[]>();
  for (const mark of marks) {
    if (mark.lost || mark.chapter !== chapter) continue;
    const list = out.get(mark.block);
    if (list) list.push(mark);
    else out.set(mark.block, [mark]);
  }
  // 重なっていても描けるよう、始まりの早い順にしておく
  for (const list of out.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/**
 * 地の文の「何文字目」を、元の文（Markdown）の「何文字目」に置き換える。
 *
 * 二度押しで直しはじめたとき、押したところへカーソルを置くために使う。
 * 地の文は元の文から記法を抜いたものなので、**元の文の中に同じ順で並んでいる**。
 * そこで前から突き合わせ、合った字だけ数を進める。合わない字は記法なので飛ばす。
 *
 * ぴったり合わないこともあるが（リンクの行き先に同じ字が入っている場合など）、
 * その場合でも近いところには止まる。押した場所から少しずれるだけで、
 * 指で置き直せるので実害は小さい。
 */
export function sourceOffsetOf(source: string, plain: string, plainOffset: number): number {
  let at = 0;
  const limit = Math.min(plainOffset, plain.length);
  for (let i = 0; i < limit; i++) {
    const ch = plain[i];
    while (at < source.length && source[at] !== ch) at++;
    if (at < source.length) at++;
  }
  return Math.min(at, source.length);
}
