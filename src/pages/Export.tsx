import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import TopBar from '../components/TopBar';
import CoverCanvas from '../components/CoverCanvas';
import { useNovel } from '../lib/useNovel';
import { countNovelChars, estimatePages } from '../lib/textStats';
import { generateTxt, generateBackupJson } from '../lib/txt';
import { generateCoverImage } from '../lib/coverGenerator';
import type { Novel, TrimSize } from '../types';
import { TRIM_SIZES } from '../lib/trimSizes';

async function handleEpub(novel: Novel) {
  const { generateEpub } = await import('../lib/epub');
  await generateEpub(novel);
}

async function handleDocx(novel: Novel) {
  const { generateDocx } = await import('../lib/docx');
  await generateDocx(novel);
}

export default function Export() {
  const { id } = useParams();
  const { novel, update, saveStatus } = useNovel(id);
  const [busy, setBusy] = useState<'epub' | 'docx' | 'cover' | null>(null);
  const [coverVariation, setCoverVariation] = useState(0);

  if (novel === undefined) return <div className="page">読み込み中…</div>;
  if (novel === null) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  const totalChars = countNovelChars(novel.chapters);
  const pages = estimatePages(totalChars);
  const emptyChapters = novel.chapters.filter((c) => c.content.trim() === '').length;

  const checklist = [
    { ok: !!novel.title.trim(), label: 'タイトルが設定されている' },
    { ok: !!(novel.author.trim() || novel.penName.trim()), label: '著者名／ペンネームが設定されている' },
    { ok: !!novel.synopsis.trim(), label: 'あらすじ（商品説明に使えます）が入力されている' },
    { ok: totalChars >= 5000, label: '本文が5,000文字以上ある（KDPの最低目安）' },
    { ok: emptyChapters === 0, label: '空の章がない' },
  ];

  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar
          novelId={novel.id}
          novelTitle={novel.title}
          activeTab="export"
          right={
            <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
              {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : ''}
            </span>
          }
        />
        <div className="page">
          <h1>出版準備</h1>
          <p style={{ color: 'var(--text-soft)' }}>
            書誌情報を整えてから、Amazon KDPへのアップロードに使えるファイル形式で書き出しましょう。
          </p>

          <div className="section">
            <h2>書誌情報</h2>
            <div className="card">
              <div className="field">
                <label>タイトル</label>
                <input
                  className="input"
                  value={novel.title}
                  onChange={(e) => update((n) => ({ ...n, title: e.target.value }))}
                />
              </div>
              <div className="row wrap" style={{ gap: 16 }}>
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label>著者名（本名）</label>
                  <input
                    className="input"
                    value={novel.author}
                    onChange={(e) => update((n) => ({ ...n, author: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label>ペンネーム</label>
                  <input
                    className="input"
                    value={novel.penName}
                    onChange={(e) => update((n) => ({ ...n, penName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="row wrap" style={{ gap: 16 }}>
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label>ジャンル</label>
                  <input
                    className="input"
                    placeholder="例：ライトファンタジー、ミステリー"
                    value={novel.genre}
                    onChange={(e) => update((n) => ({ ...n, genre: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label>ペーパーバック判型（出力サイズの目安）</label>
                  <select
                    className="input"
                    value={novel.trimSize}
                    onChange={(e) =>
                      update((n) => ({ ...n, trimSize: e.target.value as TrimSize }))
                    }
                  >
                    {Object.entries(TRIM_SIZES).map(([key, t]) => (
                      <option key={key} value={key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <div className="hint">{TRIM_SIZES[novel.trimSize].note}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <h2>表紙・挿し絵（自動生成）</h2>
            <div className="card">
              <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>
                タイトル・ジャンルから、外部AIを使わず端末内だけでCanvasにより表紙デザインを自動生成します。
                実写やイラストではなく、色とアイコンによる抽象的なデザイン表紙です。「挿し絵」は各章の冒頭に入る
                同系統の装飾バナー画像で、EPUB・DOCX・印刷用PDFに自動的に挿入されます。
              </p>
              <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div
                  style={{
                    width: 160,
                    height: 256,
                    flexShrink: 0,
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow)',
                  }}
                >
                  <CoverCanvas
                    novel={novel}
                    width={1000}
                    height={1600}
                    variation={coverVariation}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="row wrap" style={{ marginBottom: 12 }}>
                    <button
                      className="btn"
                      onClick={() => setCoverVariation((v) => v + 1)}
                    >
                      🔄 別のデザインを試す
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy === 'cover'}
                      onClick={async () => {
                        setBusy('cover');
                        try {
                          const { bytes } = await generateCoverImage(
                            novel,
                            1000,
                            1600,
                            coverVariation
                          );
                          saveAs(
                            new Blob([bytes as BlobPart], { type: 'image/png' }),
                            `${novel.title || 'novel'}-cover.png`
                          );
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === 'cover' ? '生成中…' : '表紙をPNGでダウンロード'}
                    </button>
                  </div>
                  <label className="row" style={{ fontSize: 14, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={novel.illustrationsEnabled}
                      onChange={(e) =>
                        update((n) => ({
                          ...n,
                          illustrationsEnabled: e.target.checked,
                        }))
                      }
                    />
                    EPUB・DOCX・印刷用PDFに表紙と章ごとの挿し絵を自動で入れる
                  </label>
                  <div className="hint">
                    表紙のデザインはタイトル・ジャンルから自動で決まります（同じ内容なら毎回同じデザインになります）。
                    「別のデザインを試す」でこの画面上のプレビューを変更できます。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <h2>原稿の状態</h2>
            <div className="card">
              <table className="kv-table">
                <tbody>
                  <tr>
                    <td>総文字数</td>
                    <td>{totalChars.toLocaleString()} 文字</td>
                  </tr>
                  <tr>
                    <td>章数</td>
                    <td>{novel.chapters.length} 章</td>
                  </tr>
                  <tr>
                    <td>概算ページ数（文庫換算）</td>
                    <td>約 {pages.toLocaleString()} ページ</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="section">
            <h2>出版前チェックリスト</h2>
            <div className="card">
              {checklist.map((item) => (
                <div key={item.label} className="row" style={{ marginBottom: 8 }}>
                  <span
                    style={{
                      color: item.ok ? 'var(--success)' : 'var(--danger)',
                      fontWeight: 700,
                    }}
                  >
                    {item.ok ? '✓' : '！'}
                  </span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <h2>書き出し</h2>
            <div className="export-grid">
              <div className="card export-card">
                <h3>📘 EPUB（電子書籍）</h3>
                <p>Kindle本（電子書籍）としてKDPにアップロードできる標準的な形式です。</p>
                <button
                  className="btn btn-primary btn-block"
                  disabled={busy === 'epub'}
                  onClick={async () => {
                    setBusy('epub');
                    try {
                      await handleEpub(novel);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === 'epub' ? '生成中…' : '.epub をダウンロード'}
                </button>
              </div>
              <div className="card export-card">
                <h3>📄 Word（DOCX）</h3>
                <p>KDPが電子書籍・ペーパーバック双方で受け付けるWord形式です。Kindle Createへの取り込みにも使えます。</p>
                <button
                  className="btn btn-primary btn-block"
                  disabled={busy === 'docx'}
                  onClick={async () => {
                    setBusy('docx');
                    try {
                      await handleDocx(novel);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === 'docx' ? '生成中…' : '.docx をダウンロード'}
                </button>
              </div>
              <div className="card export-card">
                <h3>🖨️ 印刷用PDFプレビュー</h3>
                <p>ペーパーバック向けに判型に合わせたレイアウトを確認し、ブラウザの印刷機能でPDF保存できます。</p>
                <Link className="btn btn-primary btn-block" to={`/novel/${novel.id}/print`}>
                  プレビューを開く
                </Link>
              </div>
              <div className="card export-card">
                <h3>📝 テキスト（TXT）</h3>
                <p>プレーンテキストで書き出します。他の編集ソフトへの移行や下書き保管に便利です。</p>
                <button className="btn btn-block" onClick={() => generateTxt(novel)}>
                  .txt をダウンロード
                </button>
              </div>
              <div className="card export-card">
                <h3>💾 バックアップ（JSON）</h3>
                <p>この作品の全データ（本文・キャラクター・プロット）を1ファイルに保存します。定期的なバックアップにご利用ください。</p>
                <button className="btn btn-block" onClick={() => generateBackupJson(novel)}>
                  バックアップを保存
                </button>
              </div>
            </div>
          </div>

          <div className="callout">
            EPUB・DOCXファイルの内容や表紙画像に問題がないか、KDPの「本のプレビューアー」で必ず確認してから出版してください。詳しい手順は
            <Link to="/guide"> KDP出版ガイド </Link>
            をご覧ください。
          </div>
        </div>
      </div>
    </div>
  );
}
