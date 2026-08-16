import type { ParsedBook } from '../epub';
import { estimatePageCount } from '../epub';
import { formatBytes, formatDate, starDisplay } from '../format';

export interface PreviewSettings {
  price: number;
  rating: number;
  reviewCount: number;
  unlimited: boolean;
  description: string;
}

interface Props {
  book: ParsedBook;
  settings: PreviewSettings;
  onSettings: (patch: Partial<PreviewSettings>) => void;
  onOpenReader: (chapterIndex: number) => void;
  onReset: () => void;
}

export default function ProductPreview({ book, settings, onSettings, onOpenReader, onReset }: Props) {
  const pages = estimatePageCount(book.totalChars);

  return (
    <>
      <div className="card">
        <h2>下見の条件</h2>
        <p className="hint">
          ここで入れた値は、この画面の中だけで使い、下の商品ページ風プレビューにそのまま映ります。
          実際にAmazonへ何かを登録・送信するものではありません（このアプリはKDP・Amazonとは無関係です）。
        </p>
        <div className="grid2">
          <label className="field">
            <span>価格（Kindle版・円）</span>
            <input
              type="number"
              min={0}
              step={1}
              value={settings.price}
              onChange={(e) => onSettings({ price: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="field">
            <span>評価数（件）</span>
            <input
              type="number"
              min={0}
              step={1}
              value={settings.reviewCount}
              onChange={(e) => onSettings({ reviewCount: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>星評価の目安（{settings.rating.toFixed(1)}）</span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={settings.rating}
            onChange={(e) => onSettings({ rating: Number(e.target.value) })}
          />
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.unlimited}
            onChange={(e) => onSettings({ unlimited: e.target.checked })}
          />
          <span className="label">
            <b>Kindle Unlimited対象にする（下見）</b>
            <span>チェックすると、対象バッジが商品ページに表示されます。</span>
          </span>
        </label>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={onReset}>
            別のEPUBを読み込み直す
          </button>
        </div>
      </div>

      <div className="mock">
        <div className="mock-frame-bar">
          <span aria-hidden="true">🔒</span>
          <span className="url">amazon.co.jp／dp／（未登録・下見）</span>
        </div>
        <div className="mock-banner">
          これは検品所が作った下見用の画面です。実際のAmazon.co.jpのページではなく、公式サービスとも無関係です。
          登録後の実際の表示とは異なる場合があります。
        </div>

        <div className="mock-body">
          <div className="mock-gallery">
            <div className={`mock-cover${book.cover ? '' : ' empty'}`}>
              {book.cover ? (
                <img src={book.cover.url} alt={book.title} />
              ) : (
                <span>表紙画像が見つかりませんでした</span>
              )}
            </div>
            <button className="mock-look-inside" onClick={() => onOpenReader(0)} disabled={book.chapters.length === 0}>
              📖 中身を見る（なか見検索・下見）
            </button>
          </div>

          <div className="mock-title-block">
            <h1>{book.title}</h1>
            <p className="mock-byline">
              <span className="author">{book.author}</span>（著） <span>形式: Kindle版</span>
            </p>

            <div className="mock-stars">
              <span className="stars" aria-hidden="true">
                {starDisplay(settings.rating)}
              </span>
              <span className="count">{settings.reviewCount}個の評価</span>
            </div>

            <hr className="mock-hr" />

            {settings.unlimited && (
              <div className="mock-unlimited">Kindle Unlimited会員は追加料金なしで読み放題（下見）</div>
            )}

            <div className="mock-format-row">
              <div className="mock-format selected">
                Kindle版
                <br />
                <span className="p">¥{settings.price.toLocaleString('ja-JP')}</span>
              </div>
              <div className="mock-format">
                ペーパーバック
                <br />
                <span>（未対応）</span>
              </div>
            </div>

            <div className="mock-buybox">
              <div className="price">
                <span className="yen">¥</span>
                {settings.price.toLocaleString('ja-JP')}
              </div>
              <button className="mock-buy-btn" disabled title="下見のため押せません">
                今すぐ購入（下見・押せません）
              </button>
              <button className="mock-buy-btn secondary" disabled title="下見のため押せません">
                サンプルを送信（下見・押せません）
              </button>
              <span className="note">実際の購入・送信は行われません。このボタンはプレビュー専用です。</span>
            </div>
          </div>
        </div>

        <div className="mock-lower">
            <div className="mock-section">
              <h2>商品の説明</h2>
              <div className="mock-description">
                <textarea
                  value={settings.description}
                  placeholder="紹介文が原稿に含まれていません。ここに下書きを入れると、プレビューに反映されます（KDPの商品説明欄に貼って使えます）。"
                  onChange={(e) => onSettings({ description: e.target.value })}
                />
              </div>
            </div>

            <div className="mock-section">
              <h2>登録情報</h2>
              <table className="mock-details">
                <tbody>
                  <tr>
                    <th>出版社</th>
                    <td>{book.publisher || '（未設定）'}</td>
                  </tr>
                  <tr>
                    <th>発売日</th>
                    <td>{formatDate(book.pubDate)}</td>
                  </tr>
                  <tr>
                    <th>言語</th>
                    <td>{book.language || '未設定'}</td>
                  </tr>
                  <tr>
                    <th>ファイルサイズ</th>
                    <td>{formatBytes(book.fileSizeBytes)}</td>
                  </tr>
                  <tr>
                    <th>推定ページ数</th>
                    <td>{pages}ページ相当（目安。実際の登録値とは異なります）</td>
                  </tr>
                  <tr>
                    <th>章の数</th>
                    <td>{book.chapters.length}章</td>
                  </tr>
                  <tr>
                    <th>ジャンル</th>
                    <td>{book.subject || '（未設定）'}</td>
                  </tr>
                  <tr>
                    <th>ASIN</th>
                    <td>（KDP登録後に発行されます）</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mock-section">
              <h2>目次</h2>
              {book.chapters.length === 0 ? (
                <p className="hint">章が見つかりませんでした。</p>
              ) : (
                <ul className="mock-toc">
                  {book.chapters.map((c, i) => (
                    <li key={c.path}>
                      <button onClick={() => onOpenReader(i)}>
                        <span>{c.title}</span>
                        <span className="chars">{c.text.replace(/\s/g, '').length.toLocaleString('ja-JP')}文字</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
        </div>
      </div>
    </>
  );
}
