/**
 * 挿絵の修正（回転・反転・切り抜き・明るさ調整）。
 *
 * 修正は「元の画像＋どう直したかの指示」として保存し、表示・書き出しに使う
 * 画像はそこから作り直す。元の画像を上書きしないので、あとから何度でも
 * 切り抜き直したり、元に戻したりできる。
 */

export interface CropRect {
  /** 回転後の画像に対する割合（0〜1） */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageEdit {
  /** 時計回りの回転（0 / 90 / 180 / 270） */
  rotate: number;
  /** 左右反転 */
  flipH: boolean;
  crop: CropRect;
  /** 1 が元のまま */
  brightness: number;
  contrast: number;
  saturate: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_EDIT: ImageEdit = {
  rotate: 0,
  flipH: false,
  crop: FULL_CROP,
  brightness: 1,
  contrast: 1,
  saturate: 1,
};

export function isDefaultEdit(edit: ImageEdit): boolean {
  return (
    edit.rotate === 0 &&
    !edit.flipH &&
    edit.crop.x === 0 &&
    edit.crop.y === 0 &&
    edit.crop.w === 1 &&
    edit.crop.h === 1 &&
    edit.brightness === 1 &&
    edit.contrast === 1 &&
    edit.saturate === 1
  );
}

/** 画面のプレビューにそのまま使えるCSSのフィルタ指定。 */
export function filterCss(edit: ImageEdit): string {
  return `brightness(${edit.brightness}) contrast(${edit.contrast}) saturate(${edit.saturate})`;
}

function toBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像を作成できませんでした'))),
      mime,
      mime === 'image/png' ? undefined : 0.9
    );
  });
}

interface Rendered {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * 指示どおりに描き直す。
 *
 * 座標は「回転したあとの見た目」を基準にしている。回転で縦横が入れ替わる
 * ことを踏まえたうえで、切り抜きの位置をそこから割り出す。
 */
export async function renderEdited(
  source: Blob,
  edit: ImageEdit,
  mime: string,
  options: { skipCrop?: boolean; skipFilters?: boolean } = {}
): Promise<Rendered> {
  const bitmap = await createImageBitmap(source);
  try {
    const swapped = edit.rotate === 90 || edit.rotate === 270;
    const rotatedW = swapped ? bitmap.height : bitmap.width;
    const rotatedH = swapped ? bitmap.width : bitmap.height;

    const crop = options.skipCrop ? FULL_CROP : edit.crop;
    const cropX = Math.round(crop.x * rotatedW);
    const cropY = Math.round(crop.y * rotatedH);
    const width = Math.max(1, Math.round(crop.w * rotatedW));
    const height = Math.max(1, Math.round(crop.h * rotatedH));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画像を処理できませんでした');

    if (!options.skipFilters) ctx.filter = filterCss(edit);

    ctx.save();
    // 切り抜きのぶんだけ、描く位置をずらす
    ctx.translate(-cropX, -cropY);
    // 左右反転は「見えているとおり」に効かせたいので、回転より先に適用する
    if (edit.flipH) {
      ctx.translate(rotatedW, 0);
      ctx.scale(-1, 1);
    }
    switch (edit.rotate) {
      case 90:
        ctx.translate(rotatedW, 0);
        ctx.rotate(Math.PI / 2);
        break;
      case 180:
        ctx.translate(rotatedW, rotatedH);
        ctx.rotate(Math.PI);
        break;
      case 270:
        ctx.translate(0, rotatedH);
        ctx.rotate(-Math.PI / 2);
        break;
      default:
        break;
    }
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();

    return { blob: await toBlob(canvas, mime), width, height };
  } finally {
    bitmap.close?.();
  }
}

/**
 * 切り抜きと明るさ調整を当てずに、向きだけ直した画像を作る。
 * 修正画面のプレビュー（この上に切り抜き枠を重ねる）に使う。
 */
export function renderOriented(
  source: Blob,
  edit: ImageEdit,
  mime: string
): Promise<Rendered> {
  return renderEdited(source, edit, mime, { skipCrop: true, skipFilters: true });
}

/** 切り抜き枠を、指定した縦横比に合わせて中央に置き直す。 */
export function cropWithRatio(
  ratio: number | null,
  imageW: number,
  imageH: number
): CropRect {
  if (ratio === null) return FULL_CROP;
  const imageRatio = imageW / imageH;
  if (imageRatio > ratio) {
    // 画像のほうが横長 → 幅を詰める
    const w = ratio / imageRatio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = imageRatio / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** 0〜1 の範囲に収める。 */
export function clampCrop(crop: CropRect): CropRect {
  const minSize = 0.05;
  const w = Math.min(1, Math.max(minSize, crop.w));
  const h = Math.min(1, Math.max(minSize, crop.h));
  const x = Math.min(1 - w, Math.max(0, crop.x));
  const y = Math.min(1 - h, Math.max(0, crop.y));
  return { x, y, w, h };
}
