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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const failures = [];

function fail(message) {
  failures.push(message);
}

/**
 * 同じ決まりを守らせるアプリ。
 * どちらも「本文を端末から出さない」ことを約束しているので、同じ網をかける。
 */
const APPS = [
  { name: '栞', dir: 'read', src: join('src', 'read') },
  { name: '語り部', dir: 'voice', src: join('src', 'voice') },
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
  const csp = /content="([^"]*Content-Security[^"]*)"/.exec(html)?.[1] ?? html;
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

for (const app of APPS) {
  for (const file of bundlesOf(app)) {
    const body = stripLiterals(readFileSync(join(DIST, 'assets', file), 'utf8'));
    for (const pattern of FORBIDDEN) {
      if (pattern.test(body)) fail(`${file} に ${pattern} が含まれている`);
    }
  }
}

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

/* ---- 結果 ---- */

if (failures.length > 0) {
  console.error('安全のしくみが崩れています:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('安全のしくみ: 問題なし（栞・語り部：CSP／通信の道具／HTML流し込み／読み上げの声）');
