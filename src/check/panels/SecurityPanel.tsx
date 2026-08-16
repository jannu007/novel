import { useEffect, useState } from 'react';
import { countForeignResources } from '../browser';

export default function SecurityPanel() {
  const [foreign, setForeign] = useState<number | null>(null);

  useEffect(() => {
    setForeign(countForeignResources());
  }, []);

  return (
    <>
      <div className="card">
        <h2>検品所の守り方</h2>
        <p className="hint">
          まだ出版していない原稿は、いちばん外に出したくないものです。このアプリは「送らない・置かない・実行しない」を
          仕組みとして持たせています。言葉だけの約束ではなく、下のとおり技術的に閉じています。
        </p>

        <div className="notice ok">
          <span aria-hidden="true">✓</span>
          <div>
            <b>外部から読み込んだファイル：{foreign === null ? '確認中' : `${foreign}件`}</b>
            <span>
              この数は、いまこの画面が自分のサイト以外から取ってきたファイルの数です。フォントも、解析用のスクリプトも
              使っていないため 0 になります。
            </span>
          </div>
        </div>

        <ul className="check-list">
          <li>
            <span className="mark">✓</span>
            <span>
              通信そのものを禁止しています
              <small>
                ページの許可設定（CSP）で <code>connect-src &apos;none&apos;</code> を指定しています。読み込んだEPUBの
                中身を何かが送ろうとしても、ブラウザが通信を止めます。
              </small>
            </span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>
              何も保存しません
              <small>
                読み込んだEPUB・表紙・設定した価格や評価は、すべてこの画面のメモリの中だけにあります。
                タブを閉じる、または「別のEPUBを読み込み直す」を押すと消えます。この端末にも、他のどこにも残しません。
              </small>
            </span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>
              EPUBの中のHTMLをそのまま実行しません
              <small>
                本文（XHTML）は決められたタグだけを許可リストで一つずつ画面の部品に組み立てて表示します。
                <code>&lt;script&gt;</code> の類は中身ごと読み飛ばし、画面表示にも{' '}
                <code>dangerouslySetInnerHTML</code> を使っていません。
              </small>
            </span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>
              画像はEPUBの中に同梱されたものだけを表示します
              <small>
                本文中の画像タグが指す外部URLをそのまま読み込むことはせず、EPUBファイルの中から実際に見つかった
                ファイルだけを、この端末の中だけで使えるアドレス（blob）に変えて表示します。
              </small>
            </span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>
              Amazon・KDPの本物のページとは無関係です
              <small>
                このアプリは非公式の下見ツールです。実際の登録も購入も送信も行わず、Amazon.co.jpへ何かを
                送ることもありません。
              </small>
            </span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>
              アカウントも料金もありません
              <small>登録も課金も広告もなく、行動を記録する仕組みも入れていません。オフラインでも動きます。</small>
            </span>
          </li>
        </ul>
      </div>
    </>
  );
}
