import { get, set, del, keys } from 'idb-keyval';
import type { Chapter, Novel } from './types';

const NOVEL_PREFIX = 'novel:';
const UNDO_PREFIX = 'undo:';

function novelKey(id: string) {
  return `${NOVEL_PREFIX}${id}`;
}

function undoKey(id: string) {
  return `${UNDO_PREFIX}${id}`;
}

/**
 * 推敲画面の一括修正を取り消すための、直前の本文のひかえ。
 * 作品データ本体とは別に保存しているので、バックアップJSONが
 * 二重に膨らむことはなく、画面を移動しても取り消しが残る。
 */
export interface UndoSnapshot {
  chapters: Chapter[];
  label: string;
  at: number;
}

export async function saveUndoSnapshot(
  novelId: string,
  snapshot: UndoSnapshot
): Promise<void> {
  await set(undoKey(novelId), snapshot);
}

export async function loadUndoSnapshot(
  novelId: string
): Promise<UndoSnapshot | undefined> {
  return get<UndoSnapshot>(undoKey(novelId));
}

export async function clearUndoSnapshot(novelId: string): Promise<void> {
  await del(undoKey(novelId));
}

export async function listNovels(): Promise<Novel[]> {
  const allKeys = await keys();
  const novelKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(NOVEL_PREFIX)
  );
  const novels = await Promise.all(novelKeys.map((k) => get<Novel>(k)));
  return novels
    .filter((n): n is Novel => Boolean(n))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadNovel(id: string): Promise<Novel | undefined> {
  return get<Novel>(novelKey(id));
}

export async function saveNovel(novel: Novel): Promise<void> {
  novel.updatedAt = Date.now();
  await set(novelKey(novel.id), novel);
}

export async function deleteNovel(id: string): Promise<void> {
  await del(novelKey(id));
  await del(undoKey(id));
}
