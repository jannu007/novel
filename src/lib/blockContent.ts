/**
 * 本文を「段落・シーン区切り・画像」というブロックの並びとして読み解く。
 *
 * 挿絵は本文のプレーンテキストの中に、その行だけの記法として書き込む。
 *
 *   ［画像:3f9a1c7d］
 *
 * 画像そのものは本文には埋め込まず、端末内のデータベースに別に保存して
 * IDで参照する。こうすることで本文はあくまで軽いテキストのままになり、
 * 保存・校正・文字数カウントが今までどおり動く。
 */

export type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'sceneBreak' }
  | { type: 'image'; id: string };

const IMAGE_LINE = /^\s*［画像:([0-9a-z]{4,32})］\s*$/;

/** 挿絵の記法を作る。 */
export function imageNotation(id: string): string {
  return `［画像:${id}］`;
}

/** その行が挿絵の記法なら画像IDを返す。 */
export function parseImageLine(line: string): string | null {
  const m = IMAGE_LINE.exec(line);
  return m ? m[1] : null;
}

/** 本文に含まれる挿絵のIDを、出てくる順に返す。 */
export function listImageIds(content: string): string[] {
  const ids: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const id = parseImageLine(line);
    if (id) ids.push(id);
  }
  return ids;
}

/** 挿絵の記法を取り除く（文字数カウントや校正の対象外にするため）。 */
export function stripImageLines(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => parseImageLine(line) === null)
    .join('\n');
}

/** 指定した挿絵の記法を本文から取り除く。 */
export function removeImageFromContent(content: string, id: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => parseImageLine(line) !== id)
    .join('\n');
}

/**
 * 本文をブロックの並びに変換する。
 * 空行が挟まれた箇所はシーン区切りとして扱う（従来の挙動と同じ）。
 */
export function contentToBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let blankRun = 0;
  for (const line of content.split(/\r?\n/)) {
    const imageId = parseImageLine(line);
    if (imageId) {
      blankRun = 0;
      blocks.push({ type: 'image', id: imageId });
      continue;
    }
    if (line.trim() === '') {
      blankRun++;
      continue;
    }
    if (blankRun > 0 && blocks.length > 0) {
      blocks.push({ type: 'sceneBreak' });
    }
    blankRun = 0;
    blocks.push({ type: 'paragraph', text: line });
  }
  return blocks;
}

/** 書き出し処理に渡す挿絵のデータ。 */
export interface ExportImage {
  id: string;
  /** image/png または image/jpeg */
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  caption: string;
  /** 本文に置くときの大きさ（本文幅に対する割合の名前） */
  size?: 'small' | 'medium' | 'large' | 'full';
}

/** 大きさの名前を、本文幅に対する割合に直す。 */
export function figureSizeScale(size: ExportImage['size']): number {
  switch (size) {
    case 'small':
      return 0.4;
    case 'large':
      return 0.82;
    case 'full':
      return 1;
    default:
      return 0.62;
  }
}

export function imageExtension(mime: string): 'png' | 'jpg' {
  return mime === 'image/png' ? 'png' : 'jpg';
}
