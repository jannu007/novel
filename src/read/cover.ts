/**
 * 本の表紙を、その本の中身から描く。
 *
 * 同じリポジトリの「製本所」が持っている、原稿から情景を見立てて
 * Canvas で描き起こすしくみ（`src/md/analyze.ts` と `src/md/artwork.ts`）を
 * そのまま使う。したがってここでも
 *   ・画像生成AIも素材サイトも使わず、
 *   ・通信は一切発生せず、
 *   ・同じ原稿からは毎回まったく同じ絵になる。
 *
 * 描くのは重い処理なので、一度描いたら端末に保存し、次からはそれを使う。
 */

import { createStore, del, get, keys, set } from 'idb-keyval';
import { analyzeScene } from '../md/analyze';
import { renderCover } from '../md/artwork';
import type { BookRecord } from './db';

/**
 * 表紙だけは別のデータベースに置く。
 * 本棚（`shiori`）と同じデータベースに後から棚を足すことはできないため。
 */
const store = createStore('shiori-covers', 'covers');

/** 表紙の大きさ（KDPと同じ 1 : 1.6 の比。端末で扱いやすい大きさに抑える）。 */
const WIDTH = 720;
const HEIGHT = 1152;

/** 画面に出すためのURL。同じ本を何度も読み込まないよう覚えておく。 */
const urls = new Map<string, string>();
/** 同じ本の表紙を同時に二重に描かないための控え。 */
const working = new Map<string, Promise<string | null>>();

async function draw(book: BookRecord): Promise<Blob> {
  // 題名は本文より強く効かせる（`analyzeScene` の第2引数がその役目）
  const profile = analyzeScene(book.source, book.title, book.seed);
  const image = await renderCover(
    {
      title: book.title,
      subtitle: '',
      author: book.author,
      profile,
      layout: book.seed % 3,
      variation: book.seed % 5,
    },
    WIDTH,
    HEIGHT
  );
  return new Blob([image.bytes as BlobPart], { type: image.mime });
}

/**
 * 表紙のURLを返す。保存してあればそれを使い、無ければその場で描いて保存する。
 * 描けなかったときは `null`（表示側は文字だけの表紙に戻る）。
 */
export function bookCoverUrl(book: BookRecord): Promise<string | null> {
  const ready = urls.get(book.id);
  if (ready) return Promise.resolve(ready);
  const already = working.get(book.id);
  if (already) return already;

  const task = (async () => {
    try {
      let blob = await get<Blob>(book.id, store);
      if (!blob) {
        blob = await draw(book);
        await set(book.id, blob, store);
      }
      const url = URL.createObjectURL(blob);
      urls.set(book.id, url);
      return url;
    } catch {
      return null;
    } finally {
      working.delete(book.id);
    }
  })();
  working.set(book.id, task);
  return task;
}

/** 本を消したときに、その表紙も片づける。 */
export async function deleteCover(id: string): Promise<void> {
  const url = urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(id);
  }
  try {
    await del(id, store);
  } catch {
    /* 消せなくても実害はない */
  }
}

/** 本棚をまるごと空にしたときに、表紙も片づける。 */
export async function clearCovers(): Promise<void> {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  try {
    const all = await keys(store);
    await Promise.all(all.map((k) => del(k, store)));
  } catch {
    /* 同上 */
  }
}
