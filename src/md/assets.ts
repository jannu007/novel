/**
 * 取り込んだファイルの扱い。
 *
 * 読み込んだものは一切どこへも送らない。ブラウザのメモリ（と、利用者が
 * 望んだときだけ端末内のデータベース）だけで完結する。
 */

/** 電子書籍に十分で、動作が重くならない大きさ。 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.86;

export interface LoadedFiles {
  /** Markdown（またはテキスト）の中身。読み込んだ順に連結する。 */
  text: string;
  /** 画像ファイル。ファイル名・相対パスの両方から引ける。 */
  assets: Map<string, string>;
  /** 読み込んだ画像の枚数（assets は同じ画像を名前とパスの二通りで持つ）。 */
  imageCount: number;
  names: string[];
  skipped: string[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** 1ファイルあたりの上限（読み込み事故で固まらないように）。 */
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * 文字として読めないファイル（PDF・ZIPなど）かどうかを、先頭を見て判断する。
 * 拡張子ではなく中身で見るのは、端末によっては `.md` に種類（MIME）が付かず、
 * 逆に見慣れない拡張子の原稿もあるため。
 */
function looksBinary(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4096));
  if (view.length === 0) return false;
  let odd = 0;
  for (const byte of view) {
    if (byte === 0) return true;
    // 改行・タブ・復帰以外の制御文字
    if (byte < 9 || (byte > 13 && byte < 32)) odd++;
  }
  return odd / view.length > 0.05;
}

/**
 * 文字コードを見分けて文字列にする。
 * 日本語の原稿は UTF-8 が多いが、古いものは Shift_JIS や EUC-JP のこともある。
 */
function decodeText(bytes: ArrayBuffer): string {
  for (const encoding of ['utf-8', 'shift_jis', 'euc-jp']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      /* 次の文字コードを試す */
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export async function readDroppedFiles(files: File[]): Promise<LoadedFiles> {
  const texts: { name: string; body: string }[] = [];
  const assets = new Map<string, string>();
  const skipped: string[] = [];
  let imageCount = 0;

  for (const file of files) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

    if (IMAGE_EXT.test(file.name) || file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_BYTES) {
        skipped.push(`${file.name}（大きすぎます）`);
        continue;
      }
      try {
        const { dataUrl } = await imageToDataUrl(file);
        assets.set(path, dataUrl);
        assets.set(file.name, dataUrl);
        imageCount++;
      } catch {
        skipped.push(file.name);
      }
      continue;
    }

    // 画像でなければ、中身が文字として読めるかどうかで判断する
    if (file.size > MAX_TEXT_BYTES) {
      skipped.push(`${file.name}（大きすぎます）`);
      continue;
    }
    const bytes = await file.arrayBuffer();
    if (looksBinary(bytes)) {
      skipped.push(`${file.name}（文書として読めません）`);
      continue;
    }
    texts.push({ name: path, body: decodeText(bytes) });
  }

  // 複数ファイルはファイル名順に並べる（01-.md, 02-.md のような原稿のため）
  texts.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));

  return {
    text: texts.map((t) => t.body.trim()).join('\n\n'),
    assets,
    imageCount,
    names: texts.map((t) => t.name),
    skipped,
  };
}

export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** 画像を長辺1600pxまで縮めて、データURLにする。 */
export async function imageToDataUrl(file: File): Promise<PreparedImage> {
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
  return {
    dataUrl: canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', keepPng ? undefined : JPEG_QUALITY),
    width,
    height,
  };
}

export interface DecodedImage {
  mime: string;
  bytes: Uint8Array;
}

/** データURLをバイト列に戻す（EPUB・DOCXに埋め込むため）。 */
export function decodeDataUrl(url: string): DecodedImage | null {
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(url.replace(/\s/g, ''));
  if (!m) return null;
  try {
    const binary = atob(m[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: m[1].toLowerCase(), bytes };
  } catch {
    return null;
  }
}

export function imageExtension(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/** 保存するときのファイル名に使えない文字を落とす。 */
export function safeFileName(name: string, fallback = 'book'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex -- ファイル名に混ぜられた制御文字を落とす
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * 他のアプリから「共有」で送られてきたファイルを受け取る。
 *
 * スマートフォンでは、ファイル選択の画面にファイルアプリが出てこない端末がある
 * （候補がカメラと写真だけになる）。これはページ側からは変えられないので、
 * 逆向きの道――ファイルアプリ側から「共有 → 製本所」――を用意している。
 * サービスワーカーが受け取って一時置き場に入れたものを、ここで取り出して消す。
 */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  try {
    const cache = await caches.open('seihonjo-share');
    const keys = await cache.keys();
    const files: File[] = [];
    for (const key of keys) {
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) continue;
      const raw = res.headers.get('X-File-Name');
      let name = '共有された文章.md';
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
