/**
 * Markdownの原稿を取り込む処理。
 *
 * ファイルの読み方そのものは栞と同じでよいので、そちらを使い回す
 * （文字コードの判別、文字として読めないファイルの見分け、大きさの上限）。
 * ここが受け持つのは「読んだ文字列を、直せる原稿の記録にする」ところだけ。
 */

import { buildBook } from '../read/book';
import {
  ImportError,
  MAX_FILE_BYTES,
  decodeText,
  isSupportedName,
  looksBinary,
  titleFromFileName,
} from '../read/import';
import { normalizeSource } from './draft';
import { seedOf, type DraftRecord } from './db';

export { ImportError, MAX_FILE_BYTES, isSupportedName };

/** 乱数ではなく時刻＋乱数のIDにして、取り込み順が分かるようにする。 */
function newId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${hex}`;
}

/**
 * Markdownの文字列から原稿の記録を作る。
 *
 * 改行コードはここで揃えてしまう。段と原文の行を行番号で結びつけているので、
 * あとから改行コードが混ざると行の数え方が狂うため。
 */
export function makeDraft(source: string, fileName: string): DraftRecord {
  const normalized = normalizeSource(source);
  const fallback = titleFromFileName(fileName);
  const built = buildBook(normalized, fallback);
  const now = Date.now();
  return {
    id: newId(),
    title: built.title,
    author: built.author,
    source: normalized,
    original: normalized,
    fileName,
    chars: built.chars,
    addedAt: now,
    openedAt: now,
    marks: [],
    history: [],
    seed: seedOf(built.title + built.author),
  };
}

/** 選ばれたファイルを1つの原稿に変換する。 */
export async function readDraftFile(file: File): Promise<DraftRecord> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      `${file.name} は大きすぎます（上限 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB）`
    );
  }
  const buffer = await file.arrayBuffer();
  // 拡張子ではなく中身で判断する。ファイル選択の種類をしぼらないぶん、ここで確かめる。
  if (looksBinary(buffer)) {
    throw new ImportError(
      `${file.name} は文字として読めないファイルでした（.md や .txt などの文章のファイルを選んでください）`
    );
  }
  const source = decodeText(buffer);
  if (source.trim() === '') throw new ImportError(`${file.name} は中身が空でした`);
  return makeDraft(source, file.name);
}

/** まとめて取り込む。 */
export async function readDraftFiles(
  files: FileList | File[]
): Promise<{ drafts: DraftRecord[]; errors: string[] }> {
  const drafts: DraftRecord[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    try {
      drafts.push(await readDraftFile(file));
    } catch (e) {
      errors.push(e instanceof ImportError ? e.message : `${file.name} を読み込めませんでした`);
    }
  }
  return { drafts, errors };
}

/**
 * 他のアプリから「共有」で送られてきたファイルを受け取る。
 * サービスワーカーが一時置き場（Cache）にしまったものを拾い、拾ったら消す。
 */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  try {
    const cache = await caches.open('hermes-share');
    const keys = await cache.keys();
    const files: File[] = [];
    for (const key of keys) {
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) continue;
      const raw = res.headers.get('X-File-Name');
      let name = '共有された原稿.md';
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

/** 端末にファイルとして保存させる。 */
function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(draft: DraftRecord): string {
  const name = draft.fileName || `${draft.title || 'draft'}.md`;
  return name.replace(/\.[^.]+$/, '') || 'draft';
}

/** 直したあとの原稿を書き出す。 */
export function downloadSource(draft: DraftRecord): void {
  download(`${baseName(draft)}.md`, draft.source, 'text/markdown');
}

/**
 * 印の一覧を、そのまま読めるMarkdownとして書き出す。
 * 原稿とは別の紙にして渡せるので、直す人と読む人が別でも使える。
 */
export function downloadMarks(
  draft: DraftRecord,
  rows: { kind: string; chapter: string; quote: string; note: string; lost?: boolean }[]
): void {
  const lines = [`# ${draft.title || '無題'} — 印の一覧`, ''];
  if (draft.author) lines.push(`著者: ${draft.author}`, '');
  lines.push(`印: ${rows.length}件`, '');
  let chapter = '';
  for (const row of rows) {
    if (row.chapter !== chapter) {
      chapter = row.chapter;
      lines.push('', `## ${chapter}`, '');
    }
    lines.push(`- **${row.kind}**${row.lost ? '（本文から見失いました）' : ''}`);
    lines.push(`  - 本文: ${row.quote.replace(/\s+/g, ' ')}`);
    if (row.note.trim()) lines.push(`  - 覚書: ${row.note.replace(/\s+/g, ' ')}`);
  }
  lines.push('');
  download(`${baseName(draft)}-印.md`, lines.join('\n'), 'text/markdown');
}
