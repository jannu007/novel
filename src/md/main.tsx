import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import App from './App';
import { initTheme } from './store';

// 最初の描画前に配色を決めておき、明→暗の一瞬のちらつきを避ける
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// オフラインでも起動できるようにする。キャッシュするのはこのアプリ自身のファイルだけ。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* オフライン対応はベストエフォート */
    });
  });
}
