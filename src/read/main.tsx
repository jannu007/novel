import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './theme.css';
import App from './App';
import { initSettings } from './settings';

// 最初の描画の前に配色を決めておき、明→暗のちらつきを避ける
initSettings();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);

/*
 * オフラインでも本棚を開けるようにする（読み込み済みのものだけを使う）。
 *
 * あわせて「新しい版が出ていたら、次に開いたときには必ずそれになっている」
 * ようにしている。オフライン用の保存が古い版を抱えたままになると、
 * 直したはずの不具合がいつまでも直らないように見えてしまうため。
 */
if ('serviceWorker' in navigator) {
  // 登録前から動いていたかを覚えておく（初回の登録では読み込み直さないため）
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        // 画面に戻ってきたとき・1時間ごとに、新しい版が出ていないか確かめる
        const check = () => registration.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) check();
        });
        setInterval(check, 60 * 60 * 1000);
      })
      .catch(() => {
        /* オフライン対応はベストエフォート */
      });
  });
}
