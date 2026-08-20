import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// このリポジトリには独立した5つのアプリが入っている。
//   /        … 小説執筆スタジオ（従来版）
//   /desk/   … 文机（新版。UIと操作体系を作り直したもの）
//   /read/   … 栞（Markdownを電子書籍のように読むリーダー）
//   /md/     … 製本所（Markdownの原稿を本の形に組んで書き出す）
//   /voice/  … 語り部（Markdownを端末の中だけで朗読する）
// それぞれ別のHTMLを入口にし、別のPWAとしてインストールできる。
// 純粋なロジック（校正・書き出し・ルビ解析など src/lib）は共有するが、
// 保存先のデータベースは別なので、作品や蔵書が混ざることはない。
// https://vite.dev/config/

/**
 * 「栞」「製本所」「語り部」は、配信されるHTMLに厳しいCSPを書き込んでいる（外部への通信を全面禁止）。
 * ただし開発サーバーはHMRのためにインラインのスクリプトとWebSocketを使うので、
 * 開発中だけ、その2つを許した内容に差し替える。本番のビルド結果は元のまま。
 */
function devCsp(): Plugin {
  const DEV_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:; object-src 'none'";
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
        `$1${DEV_CSP}$2`
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), devCsp()],
  // どの版が動いているかを画面で確かめられるようにする（栞と語り部の「保存データ」に出る）
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    ),
  },
  build: {
    /*
     * モジュールの先読み（modulepreload）の補助コードを入れない。
     *
     * これは、その機能を持たない古いブラウザのために、先読みの指示を
     * fetch で肩代わりするもの。読みに行く先は自分のJavaScriptだけで、
     * 本文が渡ることはない。それでも、配信するものの中に「外へ送れる道具」が
     * 1つも無い状態を保つほうが、確かめやすく、説明もしやすい。
     * 外しても、先読みが効かないぶんの読み込みが少し遅くなるだけで、
     * どのブラウザでも動きは変わらない。
     */
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        desk: resolve(__dirname, 'desk/index.html'),
        read: resolve(__dirname, 'read/index.html'),
        md: resolve(__dirname, 'md/index.html'),
        voice: resolve(__dirname, 'voice/index.html'),
      },
    },
  },
})
