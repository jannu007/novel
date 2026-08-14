/**
 * Markdown の原稿を「本」の形に組み立てるモジュール。
 *
 * 市販の電子書籍と同じように読めるよう、次の3つを用意する。
 *   1. 書誌（題名・著者名）… フロントマター（先頭の `---` 囲み）か最初の見出しから取る
 *   2. 章               … 見出しで区切る。1章＝ページ送りのひとまとまり
 *   3. 目次             … 見出しの階層をそのまま並べる
 */

import { parseMarkdown, inlineText, type Block } from './markdown';

export interface Chapter {
  /** 章の題（本文中では見出しとしても表示する） */
  title: string;
  /** 目次から飛ぶときの目印 */
  id: string;
  blocks: Block[];
  /** 本文の文字数（読了時間の目安に使う） */
  chars: number;
}

export interface TocEntry {
  level: number;
  title: string;
  id: string;
  chapter: number;
}

export interface BookContent {
  title: string;
  author: string;
  chapters: Chapter[];
  toc: TocEntry[];
  chars: number;
  /** 見出しIDから、その見出しがある章の番号を引く */
  chapterOfId: Map<string, number>;
}

export interface FrontMatter {
  title?: string;
  author?: string;
  [key: string]: string | undefined;
}

/**
 * 先頭の `---` で囲まれた部分（フロントマター）を読み取る。
 * YAMLの全機能は解釈せず、`キー: 値` の1行だけを見る。
 * 複雑な構文を解釈しないことは、そのまま安全側にも働く。
 */
export function splitFrontMatter(source: string): { meta: FrontMatter; body: string } {
  const normalized = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (!m) return { meta: {}, body: normalized };
  const meta: FrontMatter = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line.trim());
    if (!kv) continue;
    meta[kv[1].toLowerCase()] = kv[2].replace(/^["'](.*)["']$/, '$1').trim();
  }
  return { meta, body: normalized.slice(m[0].length) };
}

/** 章が長くなりすぎたときに分ける目安（この文字数を超えたら段落の切れ目で割る）。 */
const MAX_CHAPTER_CHARS = 40000;

function blockChars(block: Block): number {
  switch (block.type) {
    case 'paragraph':
      return inlineText(block.children).length;
    case 'heading':
      return block.plain.length;
    case 'code':
      return block.code.length;
    case 'quote':
      return block.children.reduce((n, b) => n + blockChars(b), 0);
    case 'list':
      return block.items.reduce(
        (n, item) => n + item.reduce((m, b) => m + blockChars(b), 0),
        0
      );
    case 'table':
      return block.rows.reduce(
        (n, row) => n + row.reduce((m, cell) => m + inlineText(cell).length, 0),
        0
      );
    default:
      return 0;
  }
}

/**
 * 見出しの深さを見て、どの階層で章を分けるかを決める。
 * `#` が2つ以上あれば `#` で、無ければ `##` で分ける（1つしか無い `#` は
 * 本の題名として使われていることが多いため）。
 */
function chapterLevel(blocks: Block[]): number {
  const count = new Map<number, number>();
  for (const b of blocks) {
    if (b.type === 'heading' && b.level <= 3) {
      count.set(b.level, (count.get(b.level) ?? 0) + 1);
    }
  }
  for (const level of [1, 2, 3]) {
    if ((count.get(level) ?? 0) >= 2) return level;
  }
  return (count.get(1) ?? 0) === 1 && (count.get(2) ?? 0) >= 1 ? 2 : 1;
}

/** 長すぎる章を、段落の切れ目で読みやすい大きさに分ける。 */
function splitLongChapter(chapter: Chapter): Chapter[] {
  if (chapter.chars <= MAX_CHAPTER_CHARS) return [chapter];
  const parts: Chapter[] = [];
  let buf: Block[] = [];
  let chars = 0;
  let n = 1;
  const flush = () => {
    if (buf.length === 0) return;
    parts.push({
      title: n === 1 ? chapter.title : `${chapter.title}（${n}）`,
      id: n === 1 ? chapter.id : `${chapter.id}-${n}`,
      blocks: buf,
      chars,
    });
    n++;
    buf = [];
    chars = 0;
  };
  for (const block of chapter.blocks) {
    buf.push(block);
    chars += blockChars(block);
    if (chars >= MAX_CHAPTER_CHARS) flush();
  }
  flush();
  return parts;
}

/** Markdown の原稿を本に組み立てる。 */
export function buildBook(source: string, fallbackTitle: string): BookContent {
  const { meta, body } = splitFrontMatter(source);
  const blocks = parseMarkdown(body);

  const level = chapterLevel(blocks);
  const toc: TocEntry[] = [];
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;

  const open = (title: string, id: string) => {
    current = { title, id, blocks: [], chars: 0 };
    chapters.push(current);
  };

  for (const block of blocks) {
    if (block.type === 'heading' && block.level <= level) {
      open(block.plain || `第${chapters.length + 1}章`, block.id);
    } else if (!current) {
      open('', `chapter-${chapters.length + 1}`);
    }
    if (block.type === 'heading') {
      toc.push({
        level: block.level,
        title: block.plain,
        id: block.id,
        chapter: chapters.length - 1,
      });
    }
    current!.blocks.push(block);
    current!.chars += blockChars(block);
  }

  // 見出しがまったく無い原稿でも読めるようにする
  if (chapters.length === 0) {
    chapters.push({ title: '', id: 'chapter-1', blocks, chars: 0 });
  }

  const split: Chapter[] = [];
  const remap = new Map<string, number>();
  for (const chapter of chapters) {
    for (const part of splitLongChapter(chapter)) {
      for (const block of part.blocks) {
        if (block.type === 'heading') remap.set(block.id, split.length);
      }
      split.push(part);
    }
  }
  for (const entry of toc) entry.chapter = remap.get(entry.id) ?? entry.chapter;

  // 書誌：フロントマター → 最初の見出し → ファイル名 の順に採用する
  const firstHeading = blocks.find((b): b is Extract<Block, { type: 'heading' }> =>
    b.type === 'heading'
  );
  const title = meta.title || (level > 1 && firstHeading ? firstHeading.plain : '') || fallbackTitle;

  return {
    title: title.trim() || fallbackTitle,
    author: (meta.author || meta.authors || '').trim(),
    chapters: split,
    toc,
    chars: split.reduce((n, c) => n + c.chars, 0),
    chapterOfId: remap,
  };
}

/** 読み終わるまでのおおよその時間（日本語で毎分500字として計算）。 */
export function readingMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 500));
}
