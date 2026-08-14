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

// オフラインでも本棚を開けるようにする（読み込み済みのものだけを使う）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* オフライン対応はベストエフォート */
    });
  });
}
