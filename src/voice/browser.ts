/**
 * いま開いている「入れもの」を見分ける。
 *
 * LINEやメールなどのアプリの中で開いた画面（アプリ内ブラウザ）では、
 * ファイル選択のしくみを**そのアプリ自身が用意している**ため、
 * 「カメラ」と「写真」しか出てこないことがある。これはページ側からは変えられない。
 * そこで、そういう画面だと分かるときは、ふつうのブラウザで開き直す道を案内する。
 */

/** アプリ内ブラウザ（の可能性が高い）か。 */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  // Androidのアプリ内ブラウザ（WebView）は UA に "; wv)" が入る
  if (/;\s*wv\)/.test(ua)) return true;
  // よく使われるアプリの内蔵ブラウザ
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
 * 端末に残っているアプリの控えを捨てて、最新の版を取り直す。
 *
 * アプリ内ブラウザなどでは、古い版がしつこく残って
 * 「直したはずのものが直っていない」ように見えることがある。
 * その場で抜け出すための手立て。本棚の中身（IndexedDB）には触れない。
 */
export async function refreshApp(): Promise<void> {
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      // 共有で受け取った途中のものだけは残す
      await Promise.all(
        names.filter((n) => n !== 'kataribe-share').map((n) => caches.delete(n))
      );
    }
  } catch {
    /* 消せなくても、このあとの取り直しは試す */
  }
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    if (registrations) await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    /* 同上 */
  }
  // 同じURLだと控えを見に行くことがあるので、目印を付けて取り直す
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now().toString(36));
  window.location.replace(url.href);
}

/**
 * この画面を開いてから、外部（別のサイト）へ行った通信の数を数える。
 *
 * ブラウザが記録している読み込みの一覧から、自分のサイト以外のものを数えるだけ。
 * 語り部は通信を行わないので、ここは 0 のままになる。
 * 「本当に外に出ていないのか」を、利用者が自分の目で確かめられるようにするためのもの。
 */
export function countExternalRequests(): number {
  try {
    const here = window.location.origin;
    return performance
      .getEntriesByType('resource')
      .filter((entry) => {
        // 端末の中で作ったもの（表紙の画像など）は通信ではない
        if (/^(blob:|data:)/.test(entry.name)) return false;
        try {
          return new URL(entry.name, here).origin !== here;
        } catch {
          return false;
        }
      }).length;
  } catch {
    return 0;
  }
}

/** いまのページのURLを写す。写せたら true。 */
export async function copyPageUrl(): Promise<boolean> {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // クリップボードが使えない環境向けの手当て
    try {
      const area = document.createElement('textarea');
      area.value = url;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
