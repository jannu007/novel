import { useState } from 'react';
import { promptInstall, useCanInstall, useInstalled } from '../install';
import { isStandalone } from '../browser';

/**
 * アプリとして入れるための案内。仕組みは「製本所」と同じ
 * （src/md/components/InstallBar.tsx のコメントを参照）。
 */

const DISMISSED_KEY = 'kenpinjo:install-dismissed';

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export default function InstallBar() {
  const canInstall = useCanInstall();
  const justInstalled = useInstalled();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === '1');
  const [showIosSteps, setShowIosSteps] = useState(false);

  if (justInstalled || isStandalone() || dismissed) return null;

  const iosOnly = isIos() && !canInstall;
  if (!canInstall && !iosOnly) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* 覚えられなくても閉じられればよい */
    }
  };

  return (
    <div className="install-bar">
      <div className="install-text">
        <b>検品所をアプリとして入れる</b>
        <span>
          ホーム画面から一度で開けるようになり、通信のない場所でも使えます。
          {iosOnly && '（下の手順で入れられます）'}
        </span>
        {iosOnly && showIosSteps && (
          <ol className="install-steps">
            <li>画面下の「共有」ボタン（□に↑）を押す</li>
            <li>「ホーム画面に追加」を選ぶ</li>
            <li>右上の「追加」を押す</li>
          </ol>
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
        <button className="btn ghost" onClick={close}>
          あとで
        </button>
      </div>
    </div>
  );
}
