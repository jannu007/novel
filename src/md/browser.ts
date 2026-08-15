/**
 * いま開いている「入れもの」を見分ける。
 *
 * スマートフォンでは、ファイル選択の見え方が端末とブラウザで大きく変わる。
 * とくにアプリ内ブラウザ（LINEやメールの中で開いた画面）では、選択のしくみを
 * その親アプリが用意しているため、候補が「カメラ」と「写真」だけになることがある。
 * これはページ側からは変えられないので、そうと分かるときは別の道を案内する。
 *
 * 同じ知見は「栞」（`src/read/browser.ts`）にもある。アプリごとに独立して
 * 動くようにしておきたいので、短い判定はそれぞれで持っている。
 */

/** アプリ内ブラウザ（の可能性が高い）か。 */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  // Androidのアプリ内ブラウザ（WebView）は UA に "; wv)" が入る
  if (/;\s*wv\)/.test(ua)) return true;
  if (/(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|KAKAOTALK|Twitter)/i.test(ua)) {
    return true;
  }
  // iOSでSafari以外のWebKit（＝アプリ内ブラウザ）
  if (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) {
    return true;
  }
  return false;
}

export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/** インストールしたアプリとして開いているか。 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Android で、いまのページを Chrome 本体で開き直すためのリンク。
 * アプリ内ブラウザから抜け出すのに使う（対応していない端末では元のページに戻る）。
 */
export function chromeIntentUrl(): string {
  const url = new URL(window.location.href);
  const fallback = encodeURIComponent(url.href);
  return (
    `intent://${url.host}${url.pathname}${url.search}${url.hash}` +
    `#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${fallback};end`
  );
}

/**
 * この画面を開いてから、自分のサイト以外へ行った読み込みの数を数える。
 * 製本所は通信を行わないので、ここは 0 のままになる。
 * 「本当に外に出ていないのか」を利用者が自分の目で確かめられるようにするためのもの。
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
