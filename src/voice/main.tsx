import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './theme.css';
import App from './App';
import { initSettings } from './settings';
import { lockdown } from './lockdown';
import { registerServiceWorker } from './sw-client';
import { watchInstall } from './install';

/*
 * ■ 並び順が大事なところ
 *
 * サービスワーカーの登録を、いちばん先に行う。
 * ここから下の処理のどれか1つでも例外を投げると、モジュールはそこで止まる。
 * 登録まで届かないとブラウザはこれをアプリと見なさなくなり、
 * インストールできなくなる（オフライン起動もできなくなる）。
 */
registerServiceWorker();

/*
 * 「アプリとして入れられます」の知らせは、画面を組み立てるより前に届くことがある。
 * 一度きりなので、ここで受け止めておく（受け止めないと案内を出せない）。
 */
try {
  watchInstall();
} catch {
  /* 受け止められなくても、ブラウザ側の入れ方は使える */
}

/*
 * 外へ送る道具を取り上げる（CSPが効かない場所への備え）。
 * ここが失敗しても画面は開けるようにする。通信の禁止はCSP側にもあり、
 * この二重の備えのために本が聴けなくなるのは本末転倒なため。
 */
try {
  lockdown();
} catch {
  /* CSPの禁止に任せる */
}

// 最初の描画の前に配色を決めておき、明→暗のちらつきを避ける
try {
  initSettings();
} catch {
  /* 端末の保存が使えないときは既定の配色で開く */
}

/*
 * 他所のページの中に埋め込まれた状態では動かさない。
 *
 * 枠の中に入れられると、外側のページが操作を横取りしたり、
 * 透明な枠を重ねて誤操作をさせたりできてしまう。
 * 朗読アプリでは「勝手に読み上げを始めさせる」ことにも使えるため、
 * そもそも埋め込ませない。本来はサーバー側の frame-ancestors で
 * 止める指定だが、配信元（GitHub Pages）では応答ヘッダを足せないため、
 * ここで止める。
 */
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // 見に行けない＝別の生成元の枠の中にいる
    return true;
  }
}

const root = document.getElementById('root');
if (root && framed()) {
  root.className = 'framed-stop';
  root.textContent =
    '語り部は、ほかのページに埋め込まれた状態では開けません。語り部のアプリとして開いてください。';
} else if (root) {
  createRoot(root).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>
  );
}
