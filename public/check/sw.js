/*
 * 「検品所」のオフライン対応。
 *
 * ・一度開いておけば、電波がなくてもプレビュー画面をそのまま開ける
 * ・保存するのはアプリ自身のファイルだけ。読み込んだEPUBはここを通らない
 *   （EPUBはメモリの中だけで扱い、通信もしないため）
 */

const CACHE_NAME = 'kenpinjo-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 自分自身のファイル以外は仲介しない（外部への通信はそもそも行わない）
  if (url.origin !== self.location.origin) return;

  /*
   * アプリの説明書き（manifest）は仲介しない。
   * ここを控えから返すと、ブラウザが古い内容を見てアプリを組み立てようとし、
   * インストールに失敗することがあるため、必ず取り立てのものを使わせる。
   */
  if (url.pathname.endsWith('.webmanifest')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw new Error('offline and not cached');
      })
  );
});
