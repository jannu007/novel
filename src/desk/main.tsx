import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './theme.css';
import App from './App';
import { initTheme } from './useTheme';

// 最初の描画前に配色を決めておき、明→暗の一瞬のちらつきを避ける
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* オフライン対応はベストエフォート */
    });
  });
}
