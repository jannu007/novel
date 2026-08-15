// 製本所のサービスワーカー。
// キャッシュするのは、このアプリ自身（同じサイト）のファイルだけ。
// 外部のファイルは取りにいかないし、保存もしない。
//
// もうひとつの役目が「共有で受け取る」こと。スマートフォンでは、
// ファイル選択の画面にファイルアプリが出てこない端末がある。
// そこで、ファイルアプリ側から「共有 → 製本所」で渡せるようにしている。
// 受け取ったものは一時置き場（下の SHARE_CACHE）に置くだけで、外へは出さない。
const CACHE_NAME = 'seihonjo-v3';
const SHARE_CACHE = 'seihonjo-share';
/**
 * 書き出した本の一時置き場。
 *
 * アプリとして入れて使っているとき、その場で作ったファイル（blob）を
 * そのまま保存しようとすると、Androidの保存係が受け取らずに
 * 「ダウンロードに失敗しました」となることがある。
 * そこで、書き出した本をここに置き、`./out/…` への求めとして
 * ふつうのファイルの形（Content-Disposition 付き）で返す。
 * こうすると端末は、ふつうのダウンロードとして受け取れる。
 * 置き場はこの端末の中だけで、外へは出さない。
 */
const OUT_CACHE = 'seihonjo-out';

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
            .filter((key) => key !== CACHE_NAME && key !== SHARE_CACHE && key !== OUT_CACHE)
            .map((key) => caches.delete(key))
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
    const files = form.getAll('file').filter((entry) => entry instanceof File);
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
    /* 受け取れなかったときは、そのままアプリを開くだけにする */
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

  // 同じサイトのファイル以外には一切関与しない
  if (url.origin !== self.location.origin) return;

  // 書き出した本の受け取り（ふつうのダウンロードとして返す）。
  // 渡し終わったら置き場から消す。端末の中に作品を残さないため。
  if (url.pathname.includes('/out/')) {
    event.respondWith(
      caches.open(OUT_CACHE).then(async (cache) => {
        const found = await cache.match(request.url);
        if (!found) return new Response('not found', { status: 404 });
        // 保存が終わるころに消す（受け取りの途中で消さないよう、少し待つ）
        event.waitUntil(
          new Promise((resolve) => setTimeout(resolve, 30000)).then(() =>
            caches.delete(OUT_CACHE)
          )
        );
        return found;
      })
    );
    return;
  }

  // アプリの説明書き（manifest）は控えから返さない。
  // 古い内容でアプリを組み立てようとして、インストールに失敗することがあるため。
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
