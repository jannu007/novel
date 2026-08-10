import { get, set, del, keys, createStore } from 'idb-keyval';
import type { ExportImage } from '../lib/blockContent';
import type { ImageEdit } from './imageEdit';

/** 作品データと同じデータベースに、キーの接頭辞を分けて保存する。 */
const store = createStore('fuzukue', 'works');

const IMAGE_PREFIX = 'img:';

const imageKey = (workId: string, id: string) => `${IMAGE_PREFIX}${workId}:${id}`;

export interface WorkImage {
  id: string;
  workId: string;
  mime: string;
  width: number;
  height: number;
  caption: string;
  /** 表示・書き出しに使う画像。修正済みのもの。 */
  blob: Blob;
  /**
   * 取り込んだままの画像。修正はここから作り直すので、
   * 何度でもやり直せる。古いデータには入っていないことがある。
   */
  original?: Blob;
  /** どう修正したか。未設定なら修正なし。 */
  edit?: ImageEdit;
  createdAt: number;
}

/** 電子書籍に入れるには十分で、保存が重くならない大きさに収める。 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * 選んだ画像ファイルを、長辺 1600px までに縮めて保存できる形にする。
 * 透過を保ちたいPNGはPNGのまま、それ以外は容量の小さいJPEGに変換する。
 */
export async function prepareImage(file: File): Promise<{
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できませんでした');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const keepPng = file.type === 'image/png';
  const mime = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, keepPng ? undefined : JPEG_QUALITY)
  );
  if (!blob) throw new Error('画像を変換できませんでした');
  return { blob, mime, width, height };
}

export async function saveImage(image: WorkImage): Promise<void> {
  await set(imageKey(image.workId, image.id), image, store);
}

export async function loadImage(
  workId: string,
  id: string
): Promise<WorkImage | undefined> {
  return get<WorkImage>(imageKey(workId, id), store);
}

export async function listImages(workId: string): Promise<WorkImage[]> {
  const prefix = `${IMAGE_PREFIX}${workId}:`;
  const allKeys = await keys(store);
  const mine = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(prefix)
  );
  const images = await Promise.all(mine.map((k) => get<WorkImage>(k, store)));
  return images
    .filter((i): i is WorkImage => Boolean(i))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteImage(workId: string, id: string): Promise<void> {
  await del(imageKey(workId, id), store);
}

export async function deleteImagesForWork(workId: string): Promise<void> {
  const prefix = `${IMAGE_PREFIX}${workId}:`;
  const allKeys = await keys(store);
  await Promise.all(
    allKeys
      .filter((k): k is string => typeof k === 'string' && k.startsWith(prefix))
      .map((k) => del(k, store))
  );
}

/** 書き出し処理に渡せる形（バイト列）に変換する。 */
export async function toExportImages(
  images: WorkImage[]
): Promise<Map<string, ExportImage>> {
  const map = new Map<string, ExportImage>();
  for (const image of images) {
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    map.set(image.id, {
      id: image.id,
      mime: image.mime,
      bytes,
      width: image.width,
      height: image.height,
      caption: image.caption,
    });
  }
  return map;
}

/** 画面表示用の一時URL。使い終わったら revokeObjectURL すること。 */
export function imageUrl(image: WorkImage): string {
  return URL.createObjectURL(image.blob);
}
