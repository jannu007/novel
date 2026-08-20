/**
 * サービスワーカーの登録と、新しい版への入れ替え。
 *
 * ここが担うのは2つ。
 *   1. オフラインでも書棚を開けるようにする
 *   2. **新しい版が出ていたら、必ずそれに入れ替わる**ようにする
 *
 * 2 がとくに大事で、ここが効かないと「直したはずの不具合が、
 * いつまでも直らないように見える」ことになる。実際にそうなったので、
 * 待たせずに入れ替える手順（skipWaiting の指示）まで持たせている。
 *
 * 本文はここを通らない（本は端末のIndexedDBにあり、通信もしない）。
 */

/** 何分おきに新しい版を見に行くか。 */
const CHECK_INTERVAL = 30 * 60 * 1000;

/** いま動いている版（ビルドのときに埋め込まれる）。 */
export const BUILD_ID = __BUILD_ID__;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // 登録前から動いていたか（初回の登録では読み込み直さないため）
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const start = () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        /*
         * 新しい版が見つかったら、順番待ちをさせずに交代させる。
         * 既定では新しいサービスワーカーは「待機」のまま残り、
         * すべての画面を閉じるまで交代しない。スマートフォンでは
         * アプリを完全に終了することが少ないので、待たせると
         * 何日も古い版のままになってしまう。
         */
        const takeOver = () => {
          const waiting = registration.waiting;
          if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
        };
        takeOver();
        registration.addEventListener('updatefound', () => {
          const next = registration.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed') takeOver();
          });
        });

        // 画面に戻ってきたとき・ときどき、新しい版が出ていないか確かめる
        const check = () => registration.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) check();
        });
        window.addEventListener('focus', check);
        setInterval(check, CHECK_INTERVAL);
      })
      .catch(() => {
        /* オフライン対応はベストエフォート */
      });
  };

  // 読み込みが終わっていれば今すぐ、まだなら終わってから
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
}

/** サービスワーカーの状態を、画面に出せる言葉にする。 */
export async function serviceWorkerState(): Promise<string> {
  if (!('serviceWorker' in navigator)) return 'この端末では使えません';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return '未登録（インストールできません）';
    if (registration.active) {
      return navigator.serviceWorker.controller ? '動作中' : '動作中（次回から有効）';
    }
    if (registration.installing) return '準備中';
    if (registration.waiting) return '入れ替え待ち';
    return '不明';
  } catch {
    return '確かめられませんでした';
  }
}
