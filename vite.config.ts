import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// このリポジトリには独立した3つのアプリが入っている。
//   /        … 小説執筆スタジオ（従来版）
//   /desk/   … 文机（新版。UIと操作体系を作り直したもの）
//   /md/     … 製本所（Markdownの原稿を本の形に組んで書き出す）
// それぞれ別のHTMLを入口にし、別のPWAとしてインストールできる。
// 純粋なロジック（校正・書き出しなど src/lib）は共有するが、
// 保存先のデータベースは別なので、作品データが混ざることはない。

/**
 * 「製本所」だけに、通信を禁じる厳しい許可設定（CSP）を埋め込む。
 * `connect-src 'none'` により、取り込んだ原稿が外に送られる余地をなくす。
 * 開発サーバーではHMRの通信が必要なため、本番の書き出しにだけ入れる。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // frame-ancestors は <meta> では効かないため入れない（配信側のヘッダで指定する）
].join('; ')

function strictCspForBindery(): Plugin {
  return {
    name: 'strict-csp-for-bindery',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      if (!ctx.path.includes('md/index.html')) return html
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), strictCspForBindery()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        desk: resolve(__dirname, 'desk/index.html'),
        md: resolve(__dirname, 'md/index.html'),
      },
    },
  },
})
