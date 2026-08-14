/**
 * Markdownファイルを本棚に取り込む処理。
 *
 * ■ 安全のための確認
 * - 拡張子と大きさを確かめてから読む（巨大なファイルでブラウザが固まるのを防ぐ）
 * - 中身は必ず「文字」として読み、実行も評価も一切しない
 * - 文字コードは UTF-8 を基本に、日本語で使われる Shift_JIS / EUC-JP も自動判別する
 */

import { buildBook } from './book';
import { seedOf, type BookRecord } from './db';

/** 取り込めるファイルの上限（1冊あたり）。 */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

const ALLOWED_EXT = ['.md', '.markdown', '.mdown', '.mkd', '.mdtext', '.txt', '.text'];

export class ImportError extends Error {}

export function isSupportedName(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

/**
 * バイト列を文字列にする。UTF-8として読めなければ、日本語の古い文字コードを順に試す。
 * どれでも読めないときは、化けた文字を含むUTF-8として読み込む（読めないよりはよい）。
 */
export function decodeText(bytes: ArrayBuffer): string {
  for (const encoding of ['utf-8', 'shift_jis', 'euc-jp']) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      return text;
    } catch {
      /* 次の文字コードを試す */
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** ファイル名から題名の候補を作る。 */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || '無題';
}

/** 乱数ではなく時刻＋乱数のIDにして、取り込み順が分かるようにする。 */
function newId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${hex}`;
}

/** Markdownの文字列から本の記録を作る。 */
export function makeBook(source: string, fileName: string): BookRecord {
  const fallback = titleFromFileName(fileName);
  const built = buildBook(source, fallback);
  const now = Date.now();
  return {
    id: newId(),
    title: built.title,
    author: built.author,
    source,
    fileName,
    chars: built.chars,
    addedAt: now,
    openedAt: now,
    bookmarks: [],
    seed: seedOf(built.title + built.author),
  };
}

/** 選ばれたファイルを1冊の本に変換する。 */
export async function readBookFile(file: File): Promise<BookRecord> {
  if (!isSupportedName(file.name)) {
    throw new ImportError(`${file.name} は取り込めません（.md か .txt を選んでください）`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      `${file.name} は大きすぎます（上限 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB）`
    );
  }
  const buffer = await file.arrayBuffer();
  const source = decodeText(buffer);
  if (source.trim() === '') throw new ImportError(`${file.name} は中身が空でした`);
  return makeBook(source, file.name);
}

/** ドラッグ＆ドロップやファイル選択で受け取った複数のファイルをまとめて取り込む。 */
export async function readBookFiles(
  files: FileList | File[]
): Promise<{ books: BookRecord[]; errors: string[] }> {
  const books: BookRecord[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    try {
      books.push(await readBookFile(file));
    } catch (e) {
      errors.push(e instanceof ImportError ? e.message : `${file.name} を読み込めませんでした`);
    }
  }
  return { books, errors };
}

/** 本を元のMarkdownとして書き出す（取り込んだ原文をそのまま返す）。 */
export function downloadSource(book: BookRecord): void {
  const name = book.fileName || `${book.title || 'book'}.md`;
  const blob = new Blob([book.source], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.md') || name.endsWith('.txt') ? name : `${name}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
