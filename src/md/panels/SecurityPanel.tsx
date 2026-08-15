import { useEffect, useState } from 'react';
import { countForeignResources } from '../browser';

interface Props {
  keeping: boolean;
  onKeeping: (on: boolean) => void;
  onSave: () => void;
  onClear: () => void;
  savedAt: number | null;
  hasDraft: boolean;
}

export default function SecurityPanel({
  keeping,
  onKeeping,
  onSave,
  onClear,
  savedAt,
  hasDraft,
}: Props) {
  const [foreign, setForeign] = useState<number | null>(null);

  useEffect(() => {
    setForeign(countForeignResources());
  }, []);

  return (
    <>
      <div className="card">
        <h2>原稿の守り方</h2>
        <p className="hint">
          未発表の原稿は、いちばん外に出したくないものです。このアプリは「送らない・置かない・実行しない」を
          仕組みとして持たせています。言葉だけの約束ではなく、下のとおり技術的に閉じています。
        </p>

        <div className="notice ok">
          <span aria-hidden="true">✓</span>
          <div>
            <b>外部から読み込んだファイル：{foreign === null ? '確認中' : `${foreign}件`}</b>
            <span>
              この数は、いまこの画面が自分のサイト以外から取ってきたファイルの数です。フォントも、解析用のスクリプトも、
              画像素材も使っていないため 0 になります。
            </span>
          </div>
        </div>

        <ul className="check-list">
          <li className="ok">
            <span className="mark">✓</span>
            <span>
              通信そのものを禁止しています
              <small>
                ページの許可設定（CSP）で <code>connect-src 'none'</code> を指定しています。仮に何かが
                原稿を送ろうとしても、ブラウザが通信を止めます。
              </small>
            </span>
          </li>
          <li className="ok">
            <span className="mark">✓</span>
            <span>
              既定では何も保存しません
              <small>
                原稿はメモリの中だけにあり、タブを閉じれば消えます。下の設定を入れたときだけ、この端末の中に保存します。
              </small>
            </span>
          </li>
          <li className="ok">
            <span className="mark">✓</span>
            <span>
              原稿の中のHTMLを実行しません
              <small>
                Markdownの解析器が、生HTMLを文字として扱い、<code>&lt;script&gt;</code> の類は中身ごと捨てます。
                画面表示にも <code>dangerouslySetInnerHTML</code> を使っていません。
              </small>
            </span>
          </li>
          <li className="ok">
            <span className="mark">✓</span>
            <span>
              危ないリンクを本に入れません
              <small>
                <code>javascript:</code> のように開くと動作するリンクは、取り込みの段階で文字だけにします。
                書き出したEPUB・Wordにも残りません。
              </small>
            </span>
          </li>
          <li className="ok">
            <span className="mark">✓</span>
            <span>
              表紙・挿絵も外に頼りません
              <small>
                画像生成AIも素材サイトも使わず、その場で描いています。原稿の一部が外部サービスへ渡ることがありません。
              </small>
            </span>
          </li>
          <li className="ok">
            <span className="mark">✓</span>
            <span>
              アカウントも料金もありません
              <small>
                登録も課金も広告もなく、行動を記録する仕組みも入れていません。オフラインでも動きます。
              </small>
            </span>
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>この端末に保存する</h2>
        <p className="hint">
          入れておくと、次に開いたときに続きから作業できます。保存先はこの端末のブラウザの中だけで、
          どこにも送られません。共有の端末では入れないでください。
        </p>
        <label className="switch">
          <input type="checkbox" checked={keeping} onChange={(e) => onKeeping(e.target.checked)} />
          <span className="label">
            <b>原稿と設定をこの端末に残す</b>
            <span>{savedAt ? `最後の保存：${new Date(savedAt).toLocaleString('ja-JP')}` : '未保存'}</span>
          </span>
        </label>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onSave} disabled={!keeping}>
            いま保存する
          </button>
          <button className="btn ghost" onClick={onClear} disabled={!hasDraft}>
            保存したものを消す
          </button>
        </div>
      </div>

      <div className="card">
        <h2>作ったものの権利</h2>
        <p className="hint">
          原稿も、自動生成された表紙・挿絵も、すべてあなたのものです。このアプリは権利を主張しませんし、
          生成物に透かしや署名も入れません。Amazonでの販売にも、そのまま使えます。
        </p>
      </div>
    </>
  );
}
