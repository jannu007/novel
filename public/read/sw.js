/*
 * 「栞」のオフライン対応。
 * 一度開いておけば、電波がなくても本棚と読書画面をそのまま開ける。
 * 保存するのはアプリ自身のファイルだけで、本の中身はここを通らない
 * （本はIndexedDBにあり、通信もしないため）。
 */

const CACHE_NAME = 'shiori-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // 自分自身のファイル以外は仲介しない（外部への通信はそもそも行わない）
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

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
