import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * 「語り部 ひとり版」（1つのHTMLファイル）を作るための組み立て方。
 *
 * ふだんのビルド（vite.config.ts）は5つのアプリを一度に作るので、
 * 共通して使う部分（Reactなど）を別ファイルに切り出して共有する。
 * それは配信では得だが、1ファイルにまとめたいときは邪魔になる。
 *
 * ここでは語り部だけを入口にして、切り出しを禁じ、
 * **JavaScriptもCSSもそれぞれ1つ**になるようにする。
 * まとめ上げは `scripts/make-standalone.mjs` が引き取る。
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    ),
  },
  build: {
    outDir: 'dist-standalone',
    /*
     * モジュールの先読み（modulepreload）の補助コードを入れない。
     * これは `<link rel="modulepreload">` を fetch で先読みするためのもので、
     * 1ファイル版には先読みする相手がいないので使われない。
     * 使われないとはいえ「通信の道具」を持ち歩く形になるため、外しておく
     * （検査 scripts/check-safety.mjs も、これを見つけると止まる）。
     */
    modulePreload: { polyfill: false },
    emptyOutDir: true,
    // 1ファイルに入れるので、名前に版を付けても意味がない
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'voice/index.html'),
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/voice-standalone.js',
        assetFileNames: 'assets/voice-standalone[extname]',
      },
    },
  },
})
