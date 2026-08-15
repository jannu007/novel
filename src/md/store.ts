/**
 * 保存まわり。
 *
 * 既定では何も保存しない。原稿はブラウザのメモリの中だけにあり、
 * タブを閉じれば消える。利用者が「この端末に保存する」を選んだときだけ、
 * その端末のIndexedDBに書き込む（外部に出ることは、どちらの場合もない）。
 */

import { createStore, get, set, type UseStore } from 'idb-keyval';
import type { BookMeta, BookOptions } from './book';
import { DEFAULT_OPTIONS } from './book';

const DB_NAME = 'seihonjo';

/**
 * データベースは「使うと決めたとき」に初めて作る。
 * 先に作ってしまうと、何も保存していなくても端末に置き場ができてしまい、
 * 「既定では何も置かない」と言えなくなるため。
 */
let store: UseStore | undefined;
function db(): UseStore {
  if (!store) store = createStore(DB_NAME, 'drafts');
  return store;
}

const DRAFT_KEY = 'draft';
const THEME_KEY = 'seihonjo:theme';
const KEEP_KEY = 'seihonjo:keep';

export interface Draft {
  source: string;
  options: BookOptions;
  meta: Partial<BookMeta>;
  coverLayout: number;
  savedAt: number;
}

/** 端末に保存する設定になっているか。 */
export function isKeeping(): boolean {
  return localStorage.getItem(KEEP_KEY) === 'yes';
}

export function setKeeping(on: boolean) {
  if (on) localStorage.setItem(KEEP_KEY, 'yes');
  else localStorage.removeItem(KEEP_KEY);
}

export async function saveDraft(draft: Omit<Draft, 'savedAt'>): Promise<void> {
  await set(DRAFT_KEY, { ...draft, savedAt: Date.now() } satisfies Draft, db());
}

export async function loadDraft(): Promise<Draft | undefined> {
  const draft = await get<Draft>(DRAFT_KEY, db());
  if (!draft) return undefined;
  return { ...draft, options: { ...DEFAULT_OPTIONS, ...draft.options } };
}

/**
 * 端末に残した控えを消す。
 * 中身を消すだけでなく、置き場そのもの（データベース）ごと取り除く。
 */
export async function clearDraft(): Promise<void> {
  // 置き場そのものを取り除く。中身だけ消しても、空の置き場が残ってしまうため。
  // （ここで開き直すと作り直しになるので、開かずに取り除く）
  store = undefined;
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// 配色
// ---------------------------------------------------------------------------

export type ThemeMode = 'auto' | 'light' | 'dark';

export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: '端末に合わせる',
  light: '紙（明るい）',
  dark: '墨（暗い）',
};

export function readTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  localStorage.setItem(THEME_KEY, mode);
}

export function initTheme() {
  applyTheme(readTheme());
}
