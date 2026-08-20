/**
 * 「語り部」を、1つのHTMLファイルにまとめる（ひとり版）。
 *
 *   node scripts/make-standalone.mjs
 *   → dist/voice/kataribe-standalone.html
 *
 * ■ なぜ作るか
 *
 * ふつうの版（/voice/）はインストールすればオフラインで動くが、
 * それでも次の2つが残る。
 *
 *   1. **配信元の記録。** アプリを読み込むときだけ GitHub Pages に接続が残る
 *      （渡るのは「開いた」という事実だけで、本の中身は渡らない）。
 *   2. **同じサイトの隣人。** 同じ置き場に別のアプリが同居していると、
 *      それらは互いの保存領域を読める間柄になる。今はどれも通信しないが、
 *      「通信しないアプリが隣にいる」ことに依存している状態ではある。
 *
 * 1ファイルにして手元に置き、`file://` で開けば、この2つとも消える。
 * 置き場が無いので配信元が無く、隣人もいない（`file://` は1つ1つが
 * 別の生成元として扱われる）。
 *
 * ■ 代わりに失うもの
 *
 * `file://` ではブラウザが IndexedDB を使わせてくれないので、**書棚が残らない**。
 * 開くたびにファイルを選び直すことになる。
 * これは裏を返せば「端末に何も残らない」ということでもあり、
 * 端末を後から調べられても本の中身は出てこない。
 *
 * ■ CSPを緩めない
 *
 * 1ファイルにするとJavaScriptがHTMLの中に入るので、素直にやると
 * `script-src 'unsafe-inline'` が要る。それでは元も子もないので、
 * 中身のハッシュ（sha256）を測ってCSPに書く。こうすると
 * **そのコードちょうど1つだけ**が許され、1文字でも書き換われば動かなくなる。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** ひとり版だけを組み立てた結果（vite.standalone.config.ts）。 */
const DIST = 'dist-standalone';
const SRC = join(DIST, 'voice', 'index.html');
/** 出来上がりは、配信版と一緒に置いて手元に落とせるようにする。 */
const OUT = join('dist', 'voice', 'kataribe-standalone.html');

const html = readFileSync(SRC, 'utf8');

/** 配信版のHTMLから、読み込んでいるファイルの名前を拾う。 */
function assetsFrom(pattern) {
  return [...html.matchAll(pattern)].map((m) => m[1]);
}

const scripts = assetsFrom(/<script[^>]+src="([^"]+)"/g);
const styles = assetsFrom(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g);

if (scripts.length === 0) {
  console.error('読み込んでいるスクリプトが見つかりませんでした');
  process.exit(1);
}

/** `./assets/…` や `../assets/…` を dist の中の場所に直す。 */
function resolveAsset(href) {
  const name = href.replace(/^.*\/assets\//, '');
  return join(DIST, 'assets', name);
}

/**
 * ES モジュールは `file://` では読み込めない（生成元の決まりで拒まれる）ため、
 * 中身をそのまま埋め込む。組み立ての設定で1つにまとめてあるので、
 * **ほかのファイルを名指しで読む行が残っていないこと**を確かめてから埋める。
 *
 * なお、行き先が変数になっている `import(なにか)` は残ることがある
 * （react-router の、使っていない機能のための道具が1つ入る）。
 * これは名指しでないので取り込めず、また CSP の `script-src` に
 * このコードのハッシュしか書いていないため、仮に動いても読み込みは拒まれる。
 * したがって取り残しとは見なさない。
 */
const NAMED_IMPORT = /\bfrom\s*["'][./]|\bimport\s*\(\s*["'][./]/;

let code = '';
for (const src of scripts) {
  const body = readFileSync(resolveAsset(src), 'utf8');
  if (NAMED_IMPORT.test(body)) {
    console.error(`${src} がほかのファイルを名指しで読み込んでいます`);
    process.exit(1);
  }
  code += body + '\n';
}

let css = '';
for (const href of styles) css += readFileSync(resolveAsset(href), 'utf8') + '\n';

/*
 * サービスワーカーの登録と、アプリの説明書き（manifest）は外す。
 * どちらも置き場のあるサイト向けのもので、`file://` では働かない。
 */
code = code.replace(/navigator\.serviceWorker\.register\((["'])[^"']*\1\)/g, 'Promise.reject()');

const hash = createHash('sha256').update(code, 'utf8').digest('base64');

/** 1ファイル版のCSP。配信版と同じ厳しさのまま、コードだけをハッシュで許す。 */
const CSP = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

const NOTE = `
  ひとり版（1ファイル）。

  このファイルだけで動きます。置き場も、隣に同居するアプリもありません。
  ネットにつながっていなくても、つながっていても、外へは何も送りません。

  ・書棚は残りません（file:// ではブラウザが保存を許さないため）。
    開くたびに本のファイルを選んでください。裏を返せば、端末には何も残りません。
  ・読み上げの声は、端末の中だけで話すものしか使いません。
    見つからないときは読み上げません（本文を外へ送らないためです）。
  ・このファイルの中身を1文字でも書き換えると、動かなくなります。
    CSPにコードのハッシュを書いてあるためで、差し替えの細工を防ぎます。
`;

const out = `<!doctype html>
<!--${NOTE}-->
<html lang="ja" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="google" content="notranslate" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <meta name="referrer" content="no-referrer" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
    />
    <meta name="theme-color" content="#f6f3ec" />
    <title>語り部（ひとり版）</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${code}</script>
  </body>
</html>
`;

writeFileSync(OUT, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`ひとり版: ${OUT}（${kb} KB, script-src sha256-${hash.slice(0, 12)}…）`);

// 取り残しが無いか（出力の名前が変わったときに気づけるように）
const assets = readdirSync(join(DIST, 'assets'));
if (!assets.some((f) => /\.js$/.test(f))) {
  console.error(`語り部のスクリプトが ${DIST}/assets に見当たりません`);
  process.exit(1);
}
