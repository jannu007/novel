import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Novel } from '../types';
import { imageExtension } from '../lib/blockContent';
import type { ImageEdit, FigureSize } from './imageEdit';
import {
  COVER_ID,
  listImages,
  loadCover,
  saveCover,
  saveImage,
  type WorkImage,
} from './images';
import { saveWork } from './db';

/**
 * 作品まるごとのバックアップ。
 *
 * 本文だけでなく挿絵と表紙も一緒に1つのファイルに包む。中身はZIPで、
 *
 *   work.json            … 作品（本文・人物・筋書きなど）
 *   backup.json          … 画像の目録
 *   images/<ID>.png|jpg  … 表示に使う画像
 *   originals/<ID>....   … 取り込んだままの画像（修正をやり直すため）
 *   cover.png|jpg        … 表紙
 *
 * という構成にしている。挿絵のIDは本文の ［画像:ID］ が指しているので、
 * 読み込むときもIDはそのまま引き継ぐ。
 */

const FORMAT = 'fuzukue-backup';
const VERSION = 1;

interface ImageMeta {
  id: string;
  mime: string;
  width: number;
  height: number;
  caption: string;
  size?: FigureSize;
  edit?: ImageEdit;
  createdAt: number;
  /** 取り込んだままの画像を同梱しているか */
  hasOriginal: boolean;
}

interface BackupIndex {
  format: string;
  version: number;
  images: ImageMeta[];
  cover?: ImageMeta;
}

function toMeta(image: WorkImage, hasOriginal: boolean): ImageMeta {
  return {
    id: image.id,
    mime: image.mime,
    width: image.width,
    height: image.height,
    caption: image.caption,
    size: image.size,
    edit: image.edit,
    createdAt: image.createdAt,
    hasOriginal,
  };
}

/** 作品・挿絵・表紙をまとめて1つのファイルに書き出す。 */
export async function exportBackup(work: Novel): Promise<void> {
  const zip = new JSZip();
  zip.file('work.json', JSON.stringify(work, null, 2));

  const images = await listImages(work.id);
  const cover = await loadCover(work.id);

  const index: BackupIndex = { format: FORMAT, version: VERSION, images: [] };

  for (const image of images) {
    const ext = imageExtension(image.mime);
    zip.file(`images/${image.id}.${ext}`, image.blob);
    if (image.original) zip.file(`originals/${image.id}.${ext}`, image.original);
    index.images.push(toMeta(image, Boolean(image.original)));
  }

  if (cover) {
    const ext = imageExtension(cover.mime);
    zip.file(`cover.${ext}`, cover.blob);
    if (cover.original) zip.file(`originals/cover.${ext}`, cover.original);
    index.cover = toMeta(cover, Boolean(cover.original));
  }

  zip.file('backup.json', JSON.stringify(index, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  saveAs(blob, `${work.title || 'novel'}-backup.zip`);
}

/** ZIPかどうかを先頭の4バイトで見分ける。 */
async function looksLikeZip(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

function isNovel(value: unknown): value is Novel {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Novel).chapters)
  );
}

/**
 * バックアップを取り込む。
 * 新しいZIP形式と、以前のJSON（本文だけ）のどちらも読める。
 * 元の作品と衝突しないよう、作品のIDは振り直す。
 */
export async function importBackup(file: File): Promise<Novel> {
  if (!(await looksLikeZip(file))) {
    const parsed: unknown = JSON.parse(await file.text());
    if (!isNovel(parsed)) throw new Error('形式が違います');
    const work: Novel = { ...parsed, id: crypto.randomUUID(), updatedAt: Date.now() };
    await saveWork(work);
    return work;
  }

  const zip = await JSZip.loadAsync(file);
  const workEntry = zip.file('work.json');
  if (!workEntry) throw new Error('作品データが見つかりません');
  const parsed: unknown = JSON.parse(await workEntry.async('string'));
  if (!isNovel(parsed)) throw new Error('形式が違います');

  const workId = crypto.randomUUID();
  const work: Novel = { ...parsed, id: workId, updatedAt: Date.now() };
  await saveWork(work);

  const indexEntry = zip.file('backup.json');
  if (!indexEntry) return work; // 画像なしのバックアップ
  const index = JSON.parse(await indexEntry.async('string')) as BackupIndex;

  /** 目録の1件ぶんを、保存できる形に組み立てる。 */
  async function restore(meta: ImageMeta, path: string, originalPath: string) {
    const entry = zip.file(path);
    if (!entry) return null;
    const blob = await entry.async('blob');
    const originalEntry = meta.hasOriginal ? zip.file(originalPath) : null;
    const image: WorkImage = {
      id: meta.id,
      workId,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      caption: meta.caption ?? '',
      size: meta.size,
      edit: meta.edit,
      blob: blob.slice(0, blob.size, meta.mime),
      createdAt: meta.createdAt ?? Date.now(),
    };
    if (originalEntry) {
      const original = await originalEntry.async('blob');
      image.original = original.slice(0, original.size, meta.mime);
    }
    return image;
  }

  for (const meta of index.images ?? []) {
    const ext = imageExtension(meta.mime);
    const image = await restore(meta, `images/${meta.id}.${ext}`, `originals/${meta.id}.${ext}`);
    if (image) await saveImage(image);
  }

  if (index.cover) {
    const ext = imageExtension(index.cover.mime);
    const cover = await restore(index.cover, `cover.${ext}`, `originals/cover.${ext}`);
    if (cover) await saveCover({ ...cover, id: COVER_ID });
  }

  return work;
}
