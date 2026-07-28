import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import TopBar from '../components/TopBar';
import CoverCanvas from '../components/CoverCanvas';
import { listNovels, saveNovel, deleteNovel } from '../db';
import type { Novel } from '../types';
import { createEmptyNovel } from '../types';
import { countNovelChars } from '../lib/textStats';

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.2 } },
};

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
      <div className="hero-blobs">
        <span />
        <span />
        <span />
      </div>
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
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1>あなたの作品</h1>
            <p style={{ color: 'var(--text-soft)' }}>
              完全無料でブラウザだけで小説を執筆・整理し、Amazon
              KDP（Kindleダイレクト・パブリッシング）向けの原稿を書き出せます。データはこの端末のブラウザ内にのみ保存されます。
            </p>
          </motion.div>

          <motion.div
            className="novel-grid"
            variants={gridVariants}
            initial="hidden"
            animate="show"
          >
            {creating ? (
              <motion.div className="novel-card" variants={cardVariants}>
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
              </motion.div>
            ) : (
              <motion.button
                className="new-novel-card"
                variants={cardVariants}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setCreating(true);
                  setNewTitle('');
                }}
              >
                ＋ 新しい小説を書き始める
              </motion.button>
            )}

            {novels === null && (
              <p style={{ color: 'var(--text-soft)' }}>読み込み中…</p>
            )}

            <AnimatePresence>
              {novels?.map((n) => {
                const chars = countNovelChars(n.chapters);
                return (
                  <motion.div
                    className="novel-card"
                    key={n.id}
                    variants={cardVariants}
                    exit="exit"
                    layout
                    whileHover={{ y: -6, boxShadow: 'var(--shadow-lg)' }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div
                      className="cover"
                      onClick={() => navigate(`/novel/${n.id}`)}
                      role="button"
                    >
                      <CoverCanvas novel={n} width={220} height={120} />
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
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>

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
