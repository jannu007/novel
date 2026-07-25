import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { listNovels, saveNovel, deleteNovel } from '../db';
import type { Novel } from '../types';
import { createEmptyNovel } from '../types';
import { countNovelChars } from '../lib/textStats';

const COVER_COLORS = [
  '#7a4de8',
  '#3b3268',
  '#c0563f',
  '#2f9e64',
  '#b8873a',
  '#455a89',
  '#8a3b5e',
];

export default function Dashboard() {
  const [novels, setNovels] = useState<Novel[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listNovels().then(setNovels);
  }, []);

  async function refresh() {
    setNovels(await listNovels());
  }

  async function handleCreate() {
    const title = newTitle.trim() || '無題の小説';
    const id = crypto.randomUUID();
    const novel = createEmptyNovel(id, title);
    novel.coverColor =
      COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
    await saveNovel(novel);
    navigate(`/novel/${id}`);
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？この操作は取り消せません。`)) {
      return;
    }
    await deleteNovel(id);
    await refresh();
  }

  function handleExportBackup(novel: Novel) {
    const blob = new Blob([JSON.stringify(novel, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${novel.title || 'novel'}-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Novel;
      if (!data.title || !Array.isArray(data.chapters)) {
        throw new Error('invalid');
      }
      data.id = crypto.randomUUID();
      await saveNovel(data);
      await refresh();
      alert(`「${data.title}」を読み込みました。`);
    } catch {
      alert(
        'ファイルの読み込みに失敗しました。このアプリからエクスポートしたバックアップJSONを選択してください。'
      );
    }
  }

  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar
          right={
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              <button
                className="btn btn-sm"
                onClick={() => fileInputRef.current?.click()}
              >
                バックアップを読み込む
              </button>
            </>
          }
        />
        <div className="page">
          <h1>あなたの作品</h1>
          <p style={{ color: 'var(--text-soft)' }}>
            完全無料でブラウザだけで小説を執筆・整理し、Amazon
            KDP（Kindleダイレクト・パブリッシング）向けの原稿を書き出せます。データはこの端末のブラウザ内にのみ保存されます。
          </p>

          <div className="novel-grid">
            {creating ? (
              <div className="novel-card">
                <div className="body" style={{ gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    作品タイトル
                  </label>
                  <input
                    className="input"
                    autoFocus
                    placeholder="例：星降る夜のカフェ"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') setCreating(false);
                    }}
                  />
                  <div className="row">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleCreate}
                    >
                      作成する
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setCreating(false)}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                className="new-novel-card"
                onClick={() => {
                  setCreating(true);
                  setNewTitle('');
                }}
              >
                ＋ 新しい小説を書き始める
              </button>
            )}

            {novels === null && (
              <p style={{ color: 'var(--text-soft)' }}>読み込み中…</p>
            )}

            {novels?.map((n) => {
              const chars = countNovelChars(n.chapters);
              return (
                <div className="novel-card" key={n.id}>
                  <div
                    className="cover"
                    style={{ background: n.coverColor }}
                    onClick={() => navigate(`/novel/${n.id}`)}
                    role="button"
                  >
                    {n.title}
                  </div>
                  <div
                    className="body"
                    onClick={() => navigate(`/novel/${n.id}`)}
                    role="button"
                  >
                    <strong style={{ color: 'var(--text-h)' }}>
                      {n.title}
                    </strong>
                    <span className="meta">
                      {n.chapters.length}章 ・ {chars.toLocaleString()}文字
                    </span>
                    <span className="meta">
                      {n.genre || 'ジャンル未設定'}
                    </span>
                  </div>
                  <div className="actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => handleExportBackup(n)}
                    >
                      バックアップ
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(n.id, n.title)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {novels && novels.length === 0 && !creating && (
            <div className="empty-state">
              まだ作品がありません。「＋
              新しい小説を書き始める」から最初の一冊を作成しましょう。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
