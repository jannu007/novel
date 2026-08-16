/**
 * EPUBの読み込み・解析。
 *
 * 「製本所」（src/md/epub.ts）や旧・執筆スタジオ（src/lib/epub.ts）が書き出したEPUB 3を、
 * どちらの生成物でも読めるよう、EPUBの規格そのもの（META-INF/container.xml → OPF → nav文書）
 * をたどって読む。特定のアプリの内部命名（chapter-001.xhtml など）には依存しない。
 *
 * この処理はすべてブラウザの中だけで完結する。ファイルはメモリ上のZIPとしてのみ扱い、
 * どこにも送信・保存しない（通信そのものをCSPで禁止している）。
 */

import JSZip from 'jszip';

export interface ParsedImage {
  /** zip内のパス（OEBPS/images/cover.jpg など） */
  path: string;
  /** 表示用に作った blob: URL */
  url: string;
}

export interface ParsedChapter {
  title: string;
  /** zip内のパス */
  path: string;
  /** 本文（XHTML）をそのままパースしたドキュメント */
  doc: Document;
  /** タグを取り除いた本文（文字数集計・検索用） */
  text: string;
}

export interface ParsedBook {
  title: string;
  author: string;
  language: string;
  description: string;
  publisher: string;
  subject: string;
  pubDate: string;
  cover: ParsedImage | null;
  chapters: ParsedChapter[];
  /** 本文中の画像。<img src> の解決に使う（パス→blob URL）。 */
  images: Map<string, ParsedImage>;
  totalChars: number;
  fileSizeBytes: number;
}

export class EpubParseError extends Error {}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new EpubParseError('XMLとして読み取れませんでした。');
  }
  return doc;
}

/** href（相対パスを含む）を、基準ファイルから見た zip 内の絶対パスに直す。 */
function resolvePath(baseFilePath: string, href: string): string {
  const baseDir = baseFilePath.slice(0, baseFilePath.lastIndexOf('/') + 1);
  const clean = href.split('#')[0];
  const url = new URL(clean, `file:///${baseDir}`);
  return decodeURIComponent(url.pathname.slice(1));
}

const DC_NS = 'http://purl.org/dc/elements/1.1/';
const OPF_NS = 'http://www.idpf.org/2007/opf';

function dcText(metadata: Element, tag: string): string {
  const el = metadata.getElementsByTagNameNS(DC_NS, tag)[0];
  return el?.textContent?.trim() ?? '';
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

/** container.xml を読み、OPF（パッケージ文書）のパスを見つける。 */
async function findOpfPath(zip: JSZip): Promise<string> {
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    try {
      const doc = parseXml(await containerFile.async('string'));
      const rootfile = doc.getElementsByTagName('rootfile')[0];
      const path = rootfile?.getAttribute('full-path');
      if (path) return path;
    } catch {
      /* container.xml が壊れていたら、下のフォールバックで探す */
    }
  }
  const opfEntry = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf'));
  if (!opfEntry) {
    throw new EpubParseError('EPUBの中に構成ファイル（.opf）が見つかりませんでした。');
  }
  return opfEntry;
}

/** nav文書（EPUB3）またはtoc.ncx（EPUB2）から、章の一覧（題名とパス）を読む。 */
async function readToc(
  zip: JSZip,
  opfPath: string,
  manifest: ManifestItem[],
  spineIds: string[]
): Promise<{ title: string; path: string }[]> {
  const navItem = manifest.find((m) => m.properties.split(/\s+/).includes('nav'));
  if (navItem) {
    const navPath = resolvePath(opfPath, navItem.href);
    const file = zip.file(navPath);
    if (file) {
      try {
        const doc = parseXml(await file.async('string'));
        const navs = Array.from(doc.getElementsByTagName('nav'));
        const toc =
          navs.find((n) => n.getAttribute('epub:type') === 'toc' || n.getAttribute('type') === 'toc') ??
          navs[0];
        if (toc) {
          const links = Array.from(toc.getElementsByTagName('a'));
          const items = links
            .map((a) => ({
              title: (a.textContent ?? '').trim(),
              href: a.getAttribute('href') ?? '',
            }))
            .filter((item) => item.title && item.href)
            .map((item) => ({ title: item.title, path: resolvePath(navPath, item.href) }));
          if (items.length > 0) return items;
        }
      } catch {
        /* nav文書が読めなければ toc.ncx へ */
      }
    }
  }

  const ncxItem = manifest.find((m) => m.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxPath = resolvePath(opfPath, ncxItem.href);
    const file = zip.file(ncxPath);
    if (file) {
      try {
        const doc = parseXml(await file.async('string'));
        const points = Array.from(doc.getElementsByTagName('navPoint'));
        const items = points
          .map((p) => {
            const text = p.getElementsByTagName('text')[0]?.textContent?.trim() ?? '';
            const src = p.getElementsByTagName('content')[0]?.getAttribute('src') ?? '';
            return { title: text, href: src };
          })
          .filter((item) => item.title && item.href)
          .map((item) => ({ title: item.title, path: resolvePath(ncxPath, item.href) }));
        if (items.length > 0) return items;
      } catch {
        /* toc.ncx も読めなければ spine へ */
      }
    }
  }

  // nav・ncx のどちらも無ければ、spine（読み順）をそのまま章として扱う
  const skip = /(^|\/)(cover|title|titlepage|toc)\b/i;
  return spineIds
    .map((id) => manifest.find((m) => m.id === id))
    .filter((m): m is ManifestItem => !!m && m.mediaType.includes('html') && !skip.test(m.href))
    .map((m, i) => ({ title: `${i + 1}`, path: resolvePath(opfPath, m.href) }));
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const buffer = await file.arrayBuffer();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new EpubParseError('EPUB（ZIP）として開けませんでした。壊れているか、対応していない形式です。');
  }

  const opfPath = await findOpfPath(zip);
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new EpubParseError('構成ファイル（.opf）の中身が読み取れませんでした。');
  const opfDoc = parseXml(await opfFile.async('string'));

  const metadata = opfDoc.getElementsByTagNameNS(OPF_NS, 'metadata')[0] ?? opfDoc.getElementsByTagName('metadata')[0];
  if (!metadata) throw new EpubParseError('本の情報（metadata）が見つかりませんでした。');

  const manifest: ManifestItem[] = Array.from(
    opfDoc.getElementsByTagNameNS(OPF_NS, 'item')
  ).map((el) => ({
    id: el.getAttribute('id') ?? '',
    href: el.getAttribute('href') ?? '',
    mediaType: el.getAttribute('media-type') ?? '',
    properties: el.getAttribute('properties') ?? '',
  }));
  const spineIds = Array.from(opfDoc.getElementsByTagNameNS(OPF_NS, 'itemref')).map(
    (el) => el.getAttribute('idref') ?? ''
  );

  // 表紙画像（properties="cover-image" が優先。無ければ <meta name="cover">）
  let coverItem = manifest.find((m) => m.properties.split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const coverMeta = Array.from(opfDoc.getElementsByTagNameNS(OPF_NS, 'meta')).find(
      (el) => el.getAttribute('name') === 'cover'
    );
    const coverId = coverMeta?.getAttribute('content');
    if (coverId) coverItem = manifest.find((m) => m.id === coverId);
  }

  let cover: ParsedImage | null = null;
  if (coverItem) {
    const path = resolvePath(opfPath, coverItem.href);
    const entry = zip.file(path);
    if (entry) {
      const blob = await entry.async('blob');
      cover = { path, url: URL.createObjectURL(new Blob([blob], { type: coverItem.mediaType || blob.type })) };
    }
  }

  const tocEntries = await readToc(zip, opfPath, manifest, spineIds);

  const images = new Map<string, ParsedImage>();
  const chapters: ParsedChapter[] = [];
  let totalChars = 0;

  for (const entry of tocEntries) {
    const zipFile = zip.file(entry.path);
    if (!zipFile) continue;
    const xhtml = await zipFile.async('string');
    let doc: Document;
    try {
      doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
      if (doc.getElementsByTagName('parsererror').length > 0) throw new EpubParseError('xhtml');
    } catch {
      doc = new DOMParser().parseFromString(xhtml, 'text/html');
    }

    // 本文中の画像を集める（表示は blob: URL に差し替えるため、ここで読んでおく）
    const imgEls = Array.from(doc.getElementsByTagName('img'));
    for (const img of imgEls) {
      const src = img.getAttribute('src');
      if (!src) continue;
      const imgPath = resolvePath(entry.path, src);
      if (images.has(imgPath)) continue;
      const imgFile = zip.file(imgPath);
      if (!imgFile) continue;
      const blob = await imgFile.async('blob');
      images.set(imgPath, { path: imgPath, url: URL.createObjectURL(blob) });
    }

    const text = (doc.body?.textContent ?? '').replace(/\s+/g, (s) => (s.includes('\n') ? '\n' : ' ')).trim();
    totalChars += text.replace(/\s/g, '').length;

    chapters.push({ title: entry.title, path: entry.path, doc, text });
  }

  return {
    title: dcText(metadata, 'title') || file.name.replace(/\.epub$/i, ''),
    author: dcText(metadata, 'creator') || '著者未設定',
    language: dcText(metadata, 'language'),
    description: dcText(metadata, 'description'),
    publisher: dcText(metadata, 'publisher'),
    subject: dcText(metadata, 'subject'),
    pubDate: dcText(metadata, 'date'),
    cover,
    chapters,
    images,
    totalChars,
    fileSizeBytes: buffer.byteLength,
  };
}

/** 開いた本が持っている blob: URL をすべて解放する（乗り換え・閉じるときに呼ぶ）。 */
export function revokeParsedBook(book: ParsedBook): void {
  if (book.cover) URL.revokeObjectURL(book.cover.url);
  for (const img of book.images.values()) URL.revokeObjectURL(img.url);
}

/** 文字数からKindleのページ数の目安を出す（あくまで目安。実際の登録時とは異なる）。 */
export function estimatePageCount(totalChars: number): number {
  return Math.max(1, Math.round(totalChars / 550));
}
