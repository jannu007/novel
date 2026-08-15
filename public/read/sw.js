/*
 * 「栞」のオフライン対応と、他のアプリからの受け取り口。
 *
 * ・一度開いておけば、電波がなくても本棚と読書画面をそのまま開ける
 * ・保存するのはアプリ自身のファイルだけで、本の中身はここを通らない
 *   （本はIndexedDBにあり、通信もしないため）
 * ・「共有」で送られてきた .md を受け取り、アプリ側が拾えるように一時的に置く
 *   （端末のファイル選択に「ファイル」が出てこないときの入り口になる）
 */

const CACHE_NAME = 'shiori-v3';
/** 共有で受け取ったファイルを、アプリが拾うまで一時的に置いておく場所。 */
const SHARE_CACHE = 'shiori-share';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** 共有された内容を一時置き場にしまう。 */
async function stashShared(request) {
  const cache = await caches.open(SHARE_CACHE);
  try {
    const form = await request.formData();
    const files = form.getAll('file').filter((f) => typeof f === 'object' && f && f.name);
    let index = 0;
    for (const file of files) {
      await cache.put(
        `./shared/${index++}`,
        new Response(file, {
          headers: { 'X-File-Name': encodeURIComponent(file.name || 'shared.md') },
        })
      );
    }
    if (files.length === 0) {
      // ファイルではなく文章そのものが送られてきた場合
      const text = form.get('text');
      const title = form.get('title');
      if (typeof text === 'string' && text.trim() !== '') {
        await cache.put(
          './shared/0',
          new Response(text, {
            headers: {
              'X-File-Name': encodeURIComponent(`${title || '共有された文章'}.md`),
            },
          })
        );
      }
    }
  } catch {
    /* 受け取れなかったときは、そのまま本棚を開くだけにする */
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 他のアプリから「共有」で送られてきたとき
  if (request.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith(
      stashShared(request).then(() =>
        Response.redirect(new URL('./?shared=1', self.location.href).href, 303)
      )
    );
    return;
  }

  if (request.method !== 'GET') return;

  // 自分自身のファイル以外は仲介しない（外部への通信はそもそも行わない）
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
