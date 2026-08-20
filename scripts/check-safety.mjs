/**
 * 「栞」と「語り部」の安全のしくみが崩れていないかを、ビルド結果に対して確かめる。
 *
 * 人が気をつけるだけでは、いつか誰か（将来の自分を含む）が一行足したときに
 * 静かに破れる。だから、破れていたらビルドを失敗させる。
 *
 *   node scripts/check-safety.mjs
 *
 * 確かめるのは「書いたつもり」ではなく、実際に配信される dist/ の中身。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const failures = [];

function fail(message) {
  failures.push(message);
}

/**
 * HTMLから、実際に効くCSPの中身を取り出す。
 *
 * 以前はHTML全体を相手に「その言葉が入っているか」を見ていたので、
 * 注釈に書いただけの説明文でも通ってしまった。metaタグから取り出す。
 */
function cspOf(html) {
  const meta = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i.exec(html)?.[0];
  if (!meta) return null;
  return /content="([^"]*)"/i.exec(meta)?.[1] ?? null;
}

/**
 * 「本文を端末から出さない」ことを約束しているアプリ。深く確かめる。
 */
const APPS = [
  { name: '栞', dir: 'read', src: join('src', 'read') },
  { name: '語り部', dir: 'voice', src: join('src', 'voice') },
];

/**
 * 同じ置き場に同居しているアプリ全部。
 *
 * 同じサイトに置かれたページは、互いの保存領域を読める間柄になる。
 * どれか1つでも外へ送れる口が開いていれば、そこが栞と語り部の蔵書の
 * 抜け道になってしまう。だから執筆アプリのほうにも、
 * 「通信の口が開いていないこと」だけは同じ強さで確かめる。
 */
const NEIGHBOURS = [
  { name: '小説執筆スタジオ', dir: '', src: null, html: 'index.html' },
  { name: '文机', dir: 'desk', src: join('src', 'desk'), html: join('desk', 'index.html') },
  { name: '製本所', dir: 'md', src: join('src', 'md'), html: join('md', 'index.html') },
];

/* ---- 1. 配信されるHTMLのCSP ---- */

/** 必ず入っていなければならない指定。 */
const REQUIRED_CSP = [
  "default-src 'none'",
  "connect-src 'none'", // 外へ送る道具（fetch/XHR/WS/beacon/SSE）を全部止める要
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "script-src 'self'",
];

for (const app of APPS) {
  const html = readFileSync(join(DIST, app.dir, 'index.html'), 'utf8');
  const csp = cspOf(html);
  if (csp === null) {
    fail(`${app.name}のHTMLにCSPのmetaタグが無い`);
    continue;
  }
  for (const rule of REQUIRED_CSP) {
    if (!csp.includes(rule)) fail(`${app.name}のCSPに ${rule} が入っていない`);
  }

  // 画像は端末の中のものだけ（外部の画像は読書の事実を外へ知らせてしまう）
  const imgSrc = /img-src ([^;"]*)/.exec(csp)?.[1]?.trim();
  if (imgSrc !== "'self' data: blob:") {
    fail(`${app.name}の img-src が想定と違う: ${imgSrc}`);
  }

  // ブラウザの翻訳機能（ページの文字を翻訳サーバーへ送る）を止めてあるか
  if (!/<html[^>]*\stranslate="no"/.test(html)) {
    fail(`${app.name}の <html> に translate="no" が無い`);
  }
  if (!/name="google"\s+content="notranslate"/.test(html)) {
    fail(`${app.name}に notranslate の指定が無い`);
  }
  if (!/name="referrer"\s+content="no-referrer"/.test(html)) {
    fail(`${app.name}に referrer の指定が無い`);
  }
}

/* ---- 2. 実際に配信されるスクリプト ---- */

/** それぞれの画面で読み込まれるJSを集める。 */
const assets = readdirSync(join(DIST, 'assets'));

function bundlesOf(app) {
  const found = assets.filter((f) => new RegExp(`^${app.dir}-.*\\.js$`).test(f));
  if (found.length === 0) fail(`${app.name}（${app.dir}）のスクリプトが見つからない`);
  return found;
}

/**
 * コードだけを残し、文字列・注釈・正規表現の中身を取り除く。
 *
 * 探しているのは「呼び出し」であって「文字」ではない。画面に出す説明文や、
 * 取り上げる道具の名前を並べた一覧（`src/read/lockdown.ts`）まで拾ってしまうと、
 * 正しい実装なのに失敗してしまう。
 *
 * 正規表現までまとめて扱うのが肝心で、`/["']/` のように引用符を含む正規表現を
 * 「文字列の始まり」と読み違えると、そこから先がまるごと文字列扱いになり、
 * 本当に危ない一行を素通ししてしまう（実際にそうなることを確かめた）。
 */
function stripLiterals(code) {
  let out = '';
  let i = 0;
  /** 直前の「意味のある文字」。`/` が割り算か正規表現かの判断に使う。 */
  let prev = '';

  /** ここに `/` が来たら正規表現の始まり、という直前の文字。 */
  const BEFORE_REGEX = '(,=:[!&|?{};+-*%~^<>';

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];

    // 注釈
    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }

    // 正規表現（直前の文字から、割り算でないと分かるときだけ）
    if (ch === '/' && (prev === '' || BEFORE_REGEX.includes(prev))) {
      i += 1;
      let inClass = false;
      while (i < code.length) {
        const c = code[i];
        if (c === '\\') i += 2;
        else if (c === '[') (inClass = true), (i += 1);
        else if (c === ']') (inClass = false), (i += 1);
        else if (c === '/' && !inClass) {
          i += 1;
          break;
        } else if (c === '\n') break; // 閉じないまま行が終わったら割り算だった
        else i += 1;
      }
      while (i < code.length && /[a-z]/.test(code[i])) i += 1; // g, i, u などの旗
      out += ' RE ';
      prev = 'E';
      continue;
    }

    // 文字列（テンプレート文字列は ${…} の中身ごと落とす）
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      let depth = 0;
      while (i < code.length) {
        const c = code[i];
        if (c === '\\') i += 2;
        else if (ch === '`' && c === '$' && code[i + 1] === '{') (depth += 1), (i += 2);
        else if (ch === '`' && depth > 0 && c === '}') (depth -= 1), (i += 1);
        else if (c === ch && depth === 0) {
          i += 1;
          break;
        } else i += 1;
      }
      out += '""';
      prev = '"';
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return out;
}

/*
 * 外へ送る道具の「呼び出し」。
 * 名前を書いただけ（画面の説明文など）では引っかからないよう、
 * new を伴う形か、括弧を伴う形だけを見る。
 */
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bnew\s+XMLHttpRequest\b|\bXMLHttpRequest\s*\(/,
  /\bnew\s+WebSocket\b/,
  /\bsendBeacon\s*\(/,
  /\bnew\s+EventSource\b/,
  /\bnew\s+(webkit)?RTCPeerConnection\b/,
  /\bimportScripts\s*\(/,
];

/*
 * 栞と語り部の画面に**実際に読み込まれる**JavaScriptを、1つ残らず見る。
 *
 * 以前は入口のファイル（read-*.js / voice-*.js）だけを見ていた。ところが
 * 共通して使う部分は別のファイルに切り出されて配信される。そこに `fetch(` が
 * 1つ入り込んでいて、長いあいだ見えていなかった（Viteが足す先読みの補助
 * コードだった。今は入れない設定にしてある）。
 *
 * どのファイルがどの画面に読み込まれるかは組み立て方しだいで変わるので、
 * 名前で見当をつけるのをやめ、**入口から読み込みの筋をたどって**集める。
 *
 * なお、書き出し用の道具（FileSaverなど）は執筆アプリだけが読み込むもので、
 * 栞と語り部の画面には来ない。だからここには現れない。そちらは同居アプリとして
 * CSPと原文を別に確かめている（6章）。
 */

/** そのファイルが読み込んでいる、ほかのファイルの名前。 */
function importsOf(code) {
  const names = new Set();
  for (const m of code.matchAll(/from\s*["']\.\/([^"']+\.js)["']/g)) names.add(m[1]);
  for (const m of code.matchAll(/import\s*\(\s*["']\.\/([^"']+\.js)["']/g)) names.add(m[1]);
  return names;
}

/** HTMLの入口から、読み込みの筋をたどって集める。 */
function reachable(appDir) {
  const html = readFileSync(join(DIST, appDir, 'index.html'), 'utf8');
  const seen = new Set();
  const queue = [];
  for (const m of html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.js)"/g)) {
    queue.push(m[1]);
  }
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const path = join(DIST, 'assets', name);
    if (!existsSync(path)) {
      fail(`${appDir} が読み込む ${name} が見つからない`);
      continue;
    }
    for (const next of importsOf(readFileSync(path, 'utf8'))) queue.push(next);
  }
  return seen;
}

for (const app of APPS) {
  const files = reachable(app.dir);
  if (files.size === 0) fail(`${app.name}が読み込むスクリプトが1つも見つからない`);
  for (const file of files) {
    const body = stripLiterals(readFileSync(join(DIST, 'assets', file), 'utf8'));
    for (const pattern of FORBIDDEN) {
      if (pattern.test(body)) fail(`${app.name}が読み込む ${file} に ${pattern} が含まれている`);
    }
  }
}

// 入口のファイルが名前ごと消えていないかも確かめる（組み立ての事故よけ）
for (const app of APPS) bundlesOf(app);

/* ---- 3. 原文（src/read・src/voice）にも同じ確認をする ---- */

/*
 * ビルド結果は圧縮されていて読み取りに限界がある（テンプレート文字列の中など）。
 * 書き足しが起きるのは原文の側なので、そちらにも同じ網をかけておく。
 */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
  }
}

for (const app of APPS) {
  for (const path of walk(app.src)) {
    // lockdown.ts は「取り上げる」ための唯一の例外
    if (path.endsWith('lockdown.ts')) continue;
    const body = stripLiterals(readFileSync(path, 'utf8'));
    for (const pattern of FORBIDDEN) {
      if (pattern.test(body)) fail(`${path} に ${pattern} が含まれている`);
    }
  }
}

/* ---- 4. 本文をHTMLとして流し込んでいないか ---- */

/*
 * ここは、たどった全部ではなく**自分たちの書いたコード**（入口のファイル）だけを見る。
 * React そのものが `dangerouslySetInnerHTML` を実装している以上、
 * その中身まで見に行くと必ず引っかかってしまい、検査の意味が無くなる。
 * 確かめたいのは「語り部と栞が、本文をHTMLとして流し込んでいないか」なので、
 * 自分たちのコードが入るファイルを見れば足りる。
 */
for (const app of APPS) {
  for (const file of bundlesOf(app)) {
    const code = readFileSync(join(DIST, 'assets', file), 'utf8');
    if (/dangerouslySetInnerHTML|__html/.test(code)) {
      fail(`${file} に本文をHTMLとして流し込む処理がある`);
    }
  }
}

/* ---- 5. 語り部だけの確認：声に本文を渡す場所 ---- */

/*
 * 朗読アプリで本文が漏れるとしたら、通信ではなく「声」からである。
 * 読み上げの声には、文字をメーカーのサーバーへ送って音を作る種類があり、
 * その送信はブラウザ自身が行うのでCSPでは止まらない。
 * 防いでいるのは `src/voice/speech.ts` の1か所だけなので、
 *   ・そこに「端末の中で話す声か」の確認が残っていること
 *   ・声に文字を渡す処理が、ほかの場所に増えていないこと
 * の2つを確かめる。増えた場所は確認を通らずに本文を渡せてしまう。
 */

const SPEECH = join('src', 'voice', 'speech.ts');
const speechSource = readFileSync(SPEECH, 'utf8');

// 一覧を作るときと、実際に話させる直前と、2か所で確かめている
const guards = speechSource.match(/localService !== true/g) ?? [];
if (guards.length < 2) {
  fail(`${SPEECH} の「端末の中で話す声か」の確認が減っている（${guards.length}か所）`);
}

// 声を指定しないまま話させると、ブラウザが既定の声（外へ送る声かもしれない）を選ぶ
if (!/utterance\.voice = voice/.test(speechSource)) {
  fail(`${SPEECH} が読み上げに使う声を明示していない`);
}

for (const path of walk(join('src', 'voice'))) {
  if (path === SPEECH) continue;
  const body = stripLiterals(readFileSync(path, 'utf8'));
  if (/\.speak\s*\(|new\s+SpeechSynthesisUtterance\b/.test(body)) {
    fail(`${path} が speech.ts を通さずに声へ文字を渡している`);
  }
}

// 圧縮後も確認が残っているか（消えていたら、すり抜けるようになったということ）
for (const file of bundlesOf({ name: '語り部', dir: 'voice' })) {
  const code = readFileSync(join(DIST, 'assets', file), 'utf8');
  if (code.includes('SpeechSynthesisUtterance') && !code.includes('localService')) {
    fail(`${file} に、端末の中で話す声かどうかの確認が見当たらない`);
  }
}

/* ---- 6. 同居しているアプリにも、通信の口が無いことを確かめる ---- */

for (const app of NEIGHBOURS) {
  const html = readFileSync(join(DIST, app.html), 'utf8');
  const csp = cspOf(html) ?? '';
  for (const rule of ["connect-src 'none'", "object-src 'none'", "base-uri 'none'"]) {
    if (!csp.includes(rule)) fail(`${app.name}のCSPに ${rule} が入っていない`);
  }
  if (app.src) {
    for (const path of walk(app.src)) {
      const body = stripLiterals(readFileSync(path, 'utf8'));
      for (const pattern of FORBIDDEN) {
        if (pattern.test(body)) fail(`${path} に ${pattern} が含まれている`);
      }
    }
  }
}

/*
 * `src` の直下（小説執筆スタジオ本体）も見る。
 * 各アプリの下は上で見ているので、ここでは重ねて見ない。
 */
const APP_DIRS = new Set(['read', 'voice', 'desk', 'md']);
for (const path of walk('src')) {
  if (APP_DIRS.has(path.split(/[\\/]/)[1])) continue;
  const body = stripLiterals(readFileSync(path, 'utf8'));
  for (const pattern of FORBIDDEN) {
    if (pattern.test(body)) fail(`${path} に ${pattern} が含まれている`);
  }
}

/* ---- 7. ひとり版（1ファイル）が緩んでいないか ---- */

/*
 * 1ファイル版はJavaScriptがHTMLの中に入るので、うっかり
 * `script-src 'unsafe-inline'` にすると、差し込まれた細工まで動いてしまう。
 * ハッシュで1つだけを許す形になっていることを確かめる。
 */
const STANDALONE = join(DIST, 'voice', 'kataribe-standalone.html');
if (existsSync(STANDALONE)) {
  const solo = readFileSync(STANDALONE, 'utf8');
  const csp = cspOf(solo) ?? '';
  if (!/script-src 'sha256-[A-Za-z0-9+/=]+'/.test(csp)) {
    fail('ひとり版の script-src がハッシュになっていない');
  }
  if (/unsafe-inline|unsafe-eval/.test(csp.replace(/style-src[^;]*/, ''))) {
    fail('ひとり版のCSPに unsafe-inline / unsafe-eval が入っている');
  }
  for (const rule of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'"]) {
    if (!csp.includes(rule)) fail(`ひとり版のCSPに ${rule} が入っていない`);
  }
  if (!/<html[^>]*\stranslate="no"/.test(solo)) fail('ひとり版に translate="no" が無い');

  // 中の JavaScript にも、ほかと同じ網をかける
  const inline = /<script type="module">([\s\S]*)<\/script>/.exec(solo)?.[1] ?? '';
  const body = stripLiterals(inline);
  for (const pattern of FORBIDDEN) {
    if (pattern.test(body)) fail(`ひとり版に ${pattern} が含まれている`);
  }
  if (inline.includes('SpeechSynthesisUtterance') && !inline.includes('localService')) {
    fail('ひとり版に、端末の中で話す声かどうかの確認が見当たらない');
  }
}

/* ---- 結果 ---- */

if (failures.length > 0) {
  console.error('安全のしくみが崩れています:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  '安全のしくみ: 問題なし' +
    '（栞・語り部：CSP／通信の道具／HTML流し込み／読み上げの声、' +
    '同居アプリ：通信の口、ひとり版：ハッシュ固定）'
);
