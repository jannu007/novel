import { get, set, del, keys } from 'idb-keyval';
import type { Novel } from './types';

const NOVEL_PREFIX = 'novel:';

function novelKey(id: string) {
  return `${NOVEL_PREFIX}${id}`;
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
}
