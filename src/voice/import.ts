/**
 * Markdown・テキストのファイルを書棚に取り込む。
 *
 * ファイルの読み取り方（大きさの確認・文字コードの判別・実行しない）は
 * 「栞」と同じものを使う。同じ処理を2つ持つと、片方だけ直したときに
 * 安全のしくみがずれるため、共有する。
 */

import { buildBook, countBook } from '../read/book';
import {
  ImportError,
  MAX_FILE_BYTES,
  decodeText,
  looksBinary,
  titleFromFileName,
} from '../read/import';
import { seedOf, type VoiceBook } from './db';

export { ImportError, MAX_FILE_BYTES, isSupportedName } from '../read/import';

/** 時刻＋乱数のIDにして、取り込み順が分かるようにする。 */
function newId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${hex}`;
}

/** Markdownの文字列から1冊分の記録を作る。 */
export function makeVoiceBook(source: string, fileName: string): VoiceBook {
  const fallback = titleFromFileName(fileName);
  const built = buildBook(source, fallback);
  const now = Date.now();
  return {
    id: newId(),
    title: built.title,
    author: built.author,
    source,
    fileName,
    chars: countBook(source).body,
    addedAt: now,
    openedAt: now,
    seed: seedOf(built.title + built.author),
  };
}

/** 選ばれたファイルを1冊に変換する。 */
export async function readVoiceFile(file: File): Promise<VoiceBook> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      `${file.name} は大きすぎます（上限 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB）`
    );
  }
  const buffer = await file.arrayBuffer();
  // 拡張子ではなく中身で判断する（端末によっては .md を選べないため）
  if (looksBinary(buffer)) {
    throw new ImportError(
      `${file.name} は文字として読めないファイルでした（.md や .txt などの文章のファイルを選んでください）`
    );
  }
  const source = decodeText(buffer);
  if (source.trim() === '') throw new ImportError(`${file.name} は中身が空でした`);
  return makeVoiceBook(source, file.name);
}

/** まとめて取り込む。 */
export async function readVoiceFiles(
  files: FileList | File[]
): Promise<{ books: VoiceBook[]; errors: string[] }> {
  const books: VoiceBook[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    try {
      books.push(await readVoiceFile(file));
    } catch (e) {
      errors.push(
        e instanceof ImportError ? e.message : `${file.name} を読み込めませんでした`
      );
    }
  }
  return { books, errors };
}

/**
 * 他のアプリから「共有」で送られてきたファイルを受け取る。
 * サービスワーカーが一時置き場（Cache）にしまったものを拾い、拾ったら消す。
 */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  try {
    const cache = await caches.open('kataribe-share');
    const keys = await cache.keys();
    const files: File[] = [];
    for (const key of keys) {
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) continue;
      const raw = res.headers.get('X-File-Name');
      let name = '共有された文章.md';
      try {
        if (raw) name = decodeURIComponent(raw);
      } catch {
        /* 名前が読めなければ既定の名前のままにする */
      }
      files.push(new File([await res.blob()], name));
    }
    return files;
  } catch {
    return [];
  }
}
