const CACHE_NAME = 'fuzukue-v1';

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

// ネットワーク優先、失敗時はキャッシュにフォールバック。
// 一度読み込んでおけばオフラインでも起動・執筆できる（インストール可能PWAの標準パターン）。
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // 同じサイトのファイル以外には一切関与しない。
  // ここで外の宛先も扱えるようにしておくと、外へ出る通り道が
  // 一つ増えてしまう。取りにいかないし、控えも取らない。
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw new Error('offline and not cached');
      })
  );
});
