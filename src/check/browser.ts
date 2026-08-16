/**
 * いま開いている「入れもの」を見分ける。
 *
 * 同じ知見は「製本所」（src/md/browser.ts）などにもある。アプリごとに独立して
 * 動くようにしておきたいので、短い判定はそれぞれで持っている。
 */

/** アプリ内ブラウザ（の可能性が高い）か。 */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  if (/;\s*wv\)/.test(ua)) return true;
  if (/(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|KAKAOTALK|Twitter)/i.test(ua)) {
    return true;
  }
  if (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) {
    return true;
  }
  return false;
}

/** インストールしたアプリとして開いているか。 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * この画面を開いてから、自分のサイト以外へ行った読み込みの数を数える。
 * 検品所は通信を行わないので、ここは 0 のままになる。
 */
export function countForeignResources(): number {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return 0;
  const here = location.origin;
  return performance.getEntriesByType('resource').filter((entry) => {
    try {
      return new URL(entry.name, location.href).origin !== here;
    } catch {
      return false;
    }
  }).length;
}
