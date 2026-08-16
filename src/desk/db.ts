import { get, set, del, keys, createStore } from 'idb-keyval';
import type { Chapter, Novel } from '../types';
import { deleteImagesForWork } from './images';

/**
 * 「文机」専用のデータベース。
 * 従来アプリ（小説執筆スタジオ）とは別のデータベースを使うので、
 * 同じブラウザで両方を開いても作品データが混ざらない。
 */
const store = createStore('fuzukue', 'works');

const WORK_PREFIX = 'work:';
const UNDO_PREFIX = 'undo:';

const workKey = (id: string) => `${WORK_PREFIX}${id}`;
const undoKey = (id: string) => `${UNDO_PREFIX}${id}`;

export async function listWorks(): Promise<Novel[]> {
  const allKeys = await keys(store);
  const workKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(WORK_PREFIX)
  );
  const works = await Promise.all(workKeys.map((k) => get<Novel>(k, store)));
  return works
    .filter((w): w is Novel => Boolean(w))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadWork(id: string): Promise<Novel | undefined> {
  return get<Novel>(workKey(id), store);
}

export async function saveWork(work: Novel): Promise<void> {
  work.updatedAt = Date.now();
  await set(workKey(work.id), work, store);
}

/**
 * 書いた日時をそのままに保存する。
 * よそから作品を取り込むときに使う。取り込んだ時刻で上書きしてしまうと、
 * 一覧の並び（新しい順）が取り込み順になってしまうため。
 */
export async function saveWorkAsIs(work: Novel): Promise<void> {
  await set(workKey(work.id), work, store);
}

export async function deleteWork(id: string): Promise<void> {
  await del(workKey(id), store);
  await del(undoKey(id), store);
  await deleteImagesForWork(id);
}

/** 一括修正を取り消すための、直前の本文のひかえ。 */
export interface UndoSnapshot {
  chapters: Chapter[];
  label: string;
  at: number;
}

export async function saveUndo(id: string, snapshot: UndoSnapshot): Promise<void> {
  await set(undoKey(id), snapshot, store);
}

export async function loadUndo(id: string): Promise<UndoSnapshot | undefined> {
  return get<UndoSnapshot>(undoKey(id), store);
}

export async function clearUndo(id: string): Promise<void> {
  await del(undoKey(id), store);
}
