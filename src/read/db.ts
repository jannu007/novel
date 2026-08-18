/**
 * 「栞」の本棚を保存する場所。
 *
 * 取り込んだ本は、この端末のブラウザの中（IndexedDB）だけに保存される。
 * サーバーへ送る処理はアプリのどこにも無く、通信そのものを行わない。
 * 同じリポジトリの執筆アプリとは別のデータベースなので、データが混ざることもない。
 */

import { get, set, del, keys, createStore } from 'idb-keyval';

const store = createStore('shiori', 'books');

const BOOK_PREFIX = 'book:';
const bookKey = (id: string) => `${BOOK_PREFIX}${id}`;

/** 読書位置。ページ番号ではなく本文の位置で覚えるので、字の大きさを変えても続きから読める。 */
export interface ReadingPosition {
  chapter: number;
  /** 章の中の何番目のかたまりを読んでいたか */
  block: number;
  /** そのかたまりの先頭から何ページ目だったか（長い段落のため） */
  offset?: number;
  /** 本全体のどのあたりか（0〜1）。本棚に進み具合を出すために使う。 */
  ratio: number;
  at: number;
}

export interface Bookmark {
  id: string;
  chapter: number;
  block: number;
  /** しおりを挟んだ場所の書き出し（一覧に見せる） */
  excerpt: string;
  at: number;
}

export interface BookRecord {
  id: string;
  title: string;
  author: string;
  /** 取り込んだ Markdown そのもの。書き出しでそのまま返せるように原文を残す。 */
  source: string;
  fileName: string;
  /** 本文の文字数（数え方は `src/read/count.ts`）。 */
  chars: number;
  /**
   * その `chars` がどの数え方で出されたか。
   * 数え方を直したときに、古い数のまま残っている本を見分けて数え直すために使う。
   * 付いていない本は、数え方を分ける前に取り込んだ本。
   */
  countRule?: number;
  addedAt: number;
  openedAt: number;
  position?: ReadingPosition;
  bookmarks: Bookmark[];
  /** 表紙の見た目を決める種（題名から作る。同じ本はいつも同じ表紙になる） */
  seed: number;
}

/**
 * 数え方を直したあと、古い数のまま残っている本を数え直す。
 *
 * 文字数は取り込んだときに数えて保存してある。数え方を直しても、
 * すでに本棚にある本はそのままなので、ここで原文から数え直して保存する。
 * 原文（`source`）は必ず残してあるので、取り込み直さなくてよい。
 */
export async function recountBooks(
  books: BookRecord[],
  rule: number,
  recount: (source: string) => number
): Promise<BookRecord[]> {
  const fixed: BookRecord[] = [];
  for (const book of books) {
    if (book.countRule === rule) {
      fixed.push(book);
      continue;
    }
    const next = { ...book, chars: recount(book.source), countRule: rule };
    fixed.push(next);
    try {
      await saveBook(next);
    } catch {
      // 保存できなくても、画面には正しい数を出す（次回また数え直す）
    }
  }
  return fixed;
}

export async function listBooks(): Promise<BookRecord[]> {
  const allKeys = await keys(store);
  const bookKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(BOOK_PREFIX)
  );
  const books = await Promise.all(bookKeys.map((k) => get<BookRecord>(k, store)));
  return books
    .filter((b): b is BookRecord => Boolean(b))
    .map((b) => ({ ...b, bookmarks: b.bookmarks ?? [] }))
    .sort((a, b) => b.openedAt - a.openedAt);
}

export async function loadBook(id: string): Promise<BookRecord | undefined> {
  const book = await get<BookRecord>(bookKey(id), store);
  return book ? { ...book, bookmarks: book.bookmarks ?? [] } : undefined;
}

export async function saveBook(book: BookRecord): Promise<void> {
  await set(bookKey(book.id), book, store);
}

export async function deleteBook(id: string): Promise<void> {
  await del(bookKey(id), store);
}

/** 本棚をまるごと空にする（設定の「すべて削除」用）。 */
export async function clearLibrary(): Promise<void> {
  const allKeys = await keys(store);
  await Promise.all(
    allKeys
      .filter((k): k is string => typeof k === 'string' && k.startsWith(BOOK_PREFIX))
      .map((k) => del(k, store))
  );
}

/** 題名から表紙の種を作る（同じ題名なら必ず同じ表紙になる）。 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
