import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import App from './App';
import { initTheme } from './store';
import { watchInstall } from './install';

initTheme();
watchInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* オフライン対応はベストエフォート */
    });
  });
}
