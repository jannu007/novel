import { get, keys } from 'idb-keyval';
import type { Novel } from '../types';
import { listWorks, saveWorkAsIs } from './db';

/**
 * 従来アプリ「小説執筆スタジオ」で書いた作品を、文机から見つけて取り込む。
 *
 * 2つのアプリは同じ場所（同じドメイン）にありながら、別々のデータベースに
 * 保存している。そのためスタジオで書いた作品は文机の一覧に出てこない。
 * データが消えたわけではないのだが、画面上は「まだ作品がありません」としか
 * 見えないので、こちらから迎えにいけるようにしている。
 *
 * スタジオ側は idb-keyval の既定のデータベースに `novel:` で始まる鍵で
 * 保存しているので、そこを読むだけでよい。読むだけで、書き換えはしない。
 */

const NOVEL_PREFIX = 'novel:';

/** スタジオ側にある作品を、新しい順に返す。 */
export async function listStudioWorks(): Promise<Novel[]> {
  try {
    const allKeys = await keys();
    const novelKeys = allKeys.filter(
      (k): k is string => typeof k === 'string' && k.startsWith(NOVEL_PREFIX)
    );
    const novels = await Promise.all(novelKeys.map((k) => get<Novel>(k)));
    return novels
      .filter((n): n is Novel => Boolean(n) && Array.isArray(n?.chapters))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // スタジオを一度も使っていない端末では読めないことがある。
    return [];
  }
}

/** まだ文机に来ていないスタジオの作品だけを返す。 */
export async function listPendingStudioWorks(): Promise<Novel[]> {
  const [studio, mine] = await Promise.all([listStudioWorks(), listWorks()]);
  const known = new Set(mine.map((w) => w.id));
  return studio.filter((w) => !known.has(w.id));
}

/**
 * スタジオの作品を文机へ写す。
 *
 * 作品のIDはそのまま引き継ぐ。同じ作品を二度取り込んでも増えないし、
 * すでに文机にある作品は触らないので、こちらで書き直した内容が
 * 上書きされることもない。スタジオ側はそのまま残る。
 */
export async function importStudioWorks(works: Novel[]): Promise<number> {
  const mine = await listWorks();
  const known = new Set(mine.map((w) => w.id));
  const fresh = works.filter((w) => !known.has(w.id));
  for (const work of fresh) {
    await saveWorkAsIs({ ...work, terms: work.terms ?? [] });
  }
  return fresh.length;
}
