import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// このリポジトリには独立した2つのアプリが入っている。
//   /        … 小説執筆スタジオ（従来版）
//   /desk/   … 文机（新版。UIと操作体系を作り直したもの）
// それぞれ別のHTMLを入口にし、別のPWAとしてインストールできる。
// 純粋なロジック（校正・書き出しなど src/lib）は両者で共有するが、
// 保存先のデータベースは別なので、作品データが混ざることはない。
// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        desk: resolve(__dirname, 'desk/index.html'),
      },
    },
  },
})
