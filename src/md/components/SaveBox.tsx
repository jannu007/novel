import { useEffect, useState } from 'react';
import {
  asciiName,
  canShareFile,
  objectUrlFor,
  serviceWorkerUrlFor,
  shareFile,
  type Saveable,
} from '../save';
import { chromeIntentUrl, isAndroid, isStandalone } from '../browser';

interface Props {
  item: Saveable;
  title: string;
}

/**
 * できあがったファイルの受け渡し口。
 *
 * 肝は「本物のリンクを画面に置き、利用者自身に押してもらう」こと。
 * JavaScriptから始めた保存は弾く端末があるが、利用者が押したリンクなら通る。
 * それでも駄目なときのために、渡し方を何通りか並べてある。
 */
export default function SaveBox({ item, title }: Props) {
  /** 端末がいちばん素直に受け取れる渡し先（サービスワーカー経由）。 */
  const [mainUrl, setMainUrl] = useState('');
  /** 作った直後のファイルとしての渡し先（従来の方法）。 */
  const [blobUrl, setBlobUrl] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    const made = objectUrlFor(item);
    setBlobUrl(made);
    setMainUrl('');
    setMessage('');
    void serviceWorkerUrlFor(item).then((url) => {
      if (alive && url) setMainUrl(url);
    });
    return () => {
      alive = false;
      URL.revokeObjectURL(made);
    };
  }, [item]);

  const url = mainUrl || blobUrl;
  if (!url) return null;

  return (
    <div className="save-box">
      <b>{item.name} ができました</b>
      <div className="btn-row">
        {/*
          本物のリンク。利用者が押した保存として扱われる。
          サービスワーカー経由のときは download を付けない。
          download 付きの求めはサービスワーカーを通らないため、
          こちらは「ふつうのファイルの受け取り」として開き、
          添えた見出し（Content-Disposition）で保存させる。
        */}
        <a
          className="btn primary"
          href={url}
          {...(mainUrl ? {} : { download: item.name })}
        >
          保存する
        </a>

        {canShareFile(item) && (
          <button
            className="btn"
            onClick={async () => {
              const result = await shareFile(item, title);
              if (result === 'failed') {
                setMessage('共有に渡せませんでした。ほかの方法をお試しください。');
              }
            }}
          >
            共有して保存
          </button>
        )}

        {/* 日本語のファイル名で断られる端末のために */}
        <a className="btn ghost" href={blobUrl} download={asciiName(item.name)}>
          英数字の名前で保存
        </a>

        {/* 渡し方を変えて、もう一度試すためのもの */}
        <a className="btn ghost" href={blobUrl} download={item.name}>
          別の方法で保存
        </a>

        {/* 保存として受け取れない端末のために、いったん開く */}
        <a className="btn ghost" href={blobUrl} target="_blank" rel="noreferrer noopener">
          開いて保存
        </a>

        {isAndroid() && !isStandalone() && (
          <a className="btn ghost" href={chromeIntentUrl()}>
            Chromeで開く
          </a>
        )}
      </div>
      {message && <span className="save-message">{message}</span>}
    </div>
  );
}
