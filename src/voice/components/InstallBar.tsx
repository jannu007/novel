/**
 * アプリとして入れるための案内を、書棚を開いたときに自分から出す。
 *
 * ブラウザは「ページを開いただけで勝手にインストールする」ことを認めていない。
 * 確認は必ず利用者が押した操作から始めなければならない決まりで、これは安全の
 * ための仕組みなのでページ側からは越えられない。そこでこのアプリでは、
 *   ・開いてすぐに案内を出し、
 *   ・押すのは一度だけで済むようにし、
 *   ・iPhoneのように確認を出せない端末では、その端末での入れ方を示す
 * という形にしている。
 *
 * 朗読アプリでは、入れておくことに実利もある。ホーム画面から開くと
 * アプリ内ブラウザを経由しなくなり、通信の無い場所でも起動でき、
 * 画面を消したままの読み上げが途切れにくい。
 */

import { useState } from 'react';
import {
  isIos,
  isStandalone,
  promptInstall,
  useCanInstall,
  useInstalled,
} from '../install';
import { chromeIntentUrl, copyPageUrl, isAndroid, isInAppBrowser } from '../browser';

const DISMISSED_KEY = 'kataribe:install-dismissed';

export default function InstallBar() {
  const canInstall = useCanInstall();
  const justInstalled = useInstalled();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inApp] = useState(isInAppBrowser);

  // 入れ終わったあと・すでにアプリとして開いているときは出さない
  if (justInstalled || isStandalone() || dismissed) return null;

  // iPhone・iPadはブラウザが確認を出せないので、その端末での入れ方を示す
  const iosOnly = isIos() && !canInstall;
  if (!canInstall && !iosOnly) return null;

  /*
   * Androidは、アプリの実体（WebAPK）を取り込んでから端末側でインストールする。
   * LINEやメールなどのアプリ内ブラウザから始めた場合、取り込み（ダウンロード）は
   * 始まるのに、そこで端末に止められて入らないことがある。「ダウンロードは始まる
   * のに入らない」という報告の直接の原因はこれで、ページ側からは治せない。
   * ふつうのChromeで開き直すしかないので、その案内をここに出す。
   */
  const showAndroidWarning = isAndroid();

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* 覚えられなくても閉じられればよい */
    }
  };

  return (
    <div className="card install-bar">
      <div className="install-text">
        <b>語り部をアプリとして入れる</b>
        <span className="sub">
          ホーム画面から一度で開けるようになり、通信の無い場所でも使えます。
          {iosOnly && '（下の手順で入れられます）'}
        </span>
        {iosOnly && showIosSteps && (
          <ol className="install-steps">
            <li>画面下の「共有」ボタン（□に↑）を押す</li>
            <li>「ホーム画面に追加」を選ぶ</li>
            <li>右上の「追加」を押す</li>
          </ol>
        )}
        {showAndroidWarning && (
          <div className="install-warning">
            <b>ダウンロードは始まるのに入らないときは。</b>
            {inApp
              ? 'いまLINEやメールなどのアプリの中で開いています。'
              : ''}
            アプリの中で開いた画面からは<b>入れられない</b>ことがあります
            （端末がインストールを止めるため。ページ側では直せません）。
            先にChromeで開き直してから、あらためてお試しください。
            <div className="install-actions" style={{ marginTop: 8 }}>
              <a className="btn" href={chromeIntentUrl()}>
                Chromeで開く
              </a>
              <button
                className="btn"
                onClick={async () => setCopied(await copyPageUrl())}
              >
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="install-actions">
        {iosOnly ? (
          <button className="btn primary" onClick={() => setShowIosSteps((v) => !v)}>
            {showIosSteps ? '手順を閉じる' : '入れ方を見る'}
          </button>
        ) : (
          <button className="btn primary" onClick={() => void promptInstall()}>
            入れる
          </button>
        )}
        <button className="btn" onClick={close}>
          あとで
        </button>
      </div>
    </div>
  );
}
