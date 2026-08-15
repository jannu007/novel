/**
 * できあがった本を、端末に取り出すところ。
 *
 * ここは端末とブラウザの差がいちばん大きい。書き出し自体は端末の中で
 * 終わっているのに、「ダウンロードに失敗しました」と出ることがある。
 * 失敗しているのは、ブラウザから端末へ渡す入口である。
 *
 * 分かっている落とし穴と、その避け方：
 *
 *  1. **JavaScriptから押した形の保存は弾かれることがある。**
 *     → 画面に本物のリンク（`<a download>`）を置き、利用者自身に押してもらう。
 *  2. **見慣れない種類（application/epub+zip など）を、端末の保存係が断ることがある。**
 *     → 保存に渡すときだけ「ただのファイル」（application/octet-stream）にする。
 *       中身も拡張子も変わらないので、KDPへの登録には影響しない。
 *  3. **日本語のファイル名で失敗する端末がある。**
 *     → 英数字だけの名前でも保存できるようにしておく。
 *  4. **そもそも保存できないブラウザがある**（アプリ内ブラウザなど）。
 *     → 「共有」に渡す道と、別の窓で開く道を用意する。
 */

export interface Saveable {
  blob: Blob;
  name: string;
}

/**
 * 保存に渡すためのURL。種類を「ただのファイル」にしてから渡す。
 * 使い終わったら revoke すること。
 */
export function objectUrlFor(item: Saveable): string {
  const plain = new Blob([item.blob], { type: 'application/octet-stream' });
  return URL.createObjectURL(plain);
}

/** ファイル名を、見出し（Content-Disposition）に載せられる形にする。 */
function encodeFileName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * サービスワーカー経由の、ふつうのファイルとしての受け取り口を用意する。
 *
 * アプリとして入れて使っているときなど、その場で作ったファイル（blob）を
 * 端末の保存係が受け取らないことがある（「ダウンロードに失敗しました」）。
 * いったんサービスワーカーの置き場に入れ、`./out/…` から
 * ふつうのファイルとして返してもらうと、素直に保存できる。
 *
 * 用意できないとき（サービスワーカーがまだ動いていないなど）は null を返す。
 */
export async function serviceWorkerUrlFor(item: Saveable): Promise<string | null> {
  try {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return null;
    if (!navigator.serviceWorker.controller) {
      // まだ受け持たれていないときは、動き出すのを少しだけ待つ
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      if (!navigator.serviceWorker.controller) return null;
    }
    // URLに題名を載せない（履歴や記録に作品名が残らないようにする）。
    // ファイル名は、添える見出し（Content-Disposition）だけで伝える。
    const url = new URL('./out/file', location.href).href;
    const cache = await caches.open('seihonjo-out');
    // 前に置いたものは残さない
    for (const key of await cache.keys()) await cache.delete(key);
    await cache.put(
      url,
      new Response(item.blob, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': encodeFileName(item.name),
          'Content-Length': String(item.blob.size),
        },
      })
    );
    return url;
  } catch {
    return null;
  }
}

/**
 * 端末に残っている書き出し済みの本を消す。
 *
 * 受け渡しのために置いたものが残っていると、それは端末の中に
 * 作品がまるごと残っているのと同じことになる。渡し終わったら消す。
 */
export async function clearSavedFiles(): Promise<void> {
  try {
    if (!('caches' in window)) return;
    await caches.delete('seihonjo-out');
  } catch {
    /* 消せなくても、次に書き出したときに入れ替わる */
  }
}

/** 日本語などで失敗する端末のための、英数字だけの名前。 */
export function asciiName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `book-${stamp}${ext}`;
}

/** JavaScriptから保存を始める（パソコン向け。失敗しても例外は投げない）。 */
export function downloadBlob(item: Saveable): boolean {
  try {
    const url = objectUrlFor(item);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // すぐ捨てると、保存が始まる前に消えてしまう端末があるので少し待つ
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
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
