/**
 * できあがった本を、端末に取り出すところ。
 *
 * スマートフォンでは「ダウンロードに失敗しました」と出ることがある。
 * 書き出し自体は端末の中で終わっていて、失敗しているのは
 * ブラウザから端末へ渡すところ（保存の入口）である。原因は端末やブラウザ側にあり、
 * とくにアプリ内ブラウザや一部のブラウザでは、作った直後のファイル（blob）を
 * 保存できないことがある。
 *
 * そこで渡し方を2通り用意している。
 *   1. ふつうの保存（ダウンロード）
 *   2. 「共有」に渡す（保存先アプリを利用者が選ぶ）
 * 2 はAndroid・iPhoneでよく効くが、押した直後にしか呼べない決まりがあるため、
 * 本を組み立て終えたあと、改めて押してもらう形にしている。
 */

export interface Saveable {
  blob: Blob;
  name: string;
}

/** ふつうの保存。失敗したら false を返す（例外は投げない）。 */
export function downloadBlob({ blob, name }: Saveable): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // すぐ捨てると、保存が始まる前に消えてしまう端末があるので少し待つ
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}

function toFile({ blob, name }: Saveable): File {
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

/** この端末で「共有」に渡せるか。 */
export function canShareFile(item: Saveable): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
  try {
    return navigator.canShare({ files: [toFile(item)] });
  } catch {
    return false;
  }
}

export type ShareResult = 'shared' | 'cancelled' | 'failed';

/** 「共有」に渡す（保存先は利用者が選ぶ）。押した直後に呼ぶこと。 */
export async function shareFile(item: Saveable, title: string): Promise<ShareResult> {
  try {
    await navigator.share({ files: [toFile(item)], title });
    return 'shared';
  } catch (error) {
    // 利用者が閉じただけのときは、失敗として扱わない
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}
