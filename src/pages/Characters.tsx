import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from '../components/TopBar';
import { useNovel } from '../lib/useNovel';
import type { Character } from '../types';

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.18 } },
};

export default function Characters() {
  const { id } = useParams();
  const { novel, update, saveStatus } = useNovel(id);

  if (novel === undefined) return <div className="page">読み込み中…</div>;
  if (novel === null) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  function addCharacter() {
    const c: Character = {
      id: crypto.randomUUID(),
      name: '',
      kana: '',
      role: '脇役',
      summary: '',
      details: '',
      order: novel!.characters.length,
    };
    update((n) => ({ ...n, characters: [...n.characters, c] }));
  }

  function patch(cid: string, p: Partial<Character>) {
    update((n) => ({
      ...n,
      characters: n.characters.map((c) => (c.id === cid ? { ...c, ...p } : c)),
    }));
  }

  function remove(cid: string) {
    if (!confirm('このキャラクターを削除しますか？')) return;
    update((n) => ({
      ...n,
      characters: n.characters.filter((c) => c.id !== cid),
    }));
  }

  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar
          novelId={novel.id}
          novelTitle={novel.title}
          activeTab="characters"
          right={
            <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
              {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : ''}
            </span>
          }
        />
        <div className="page">
          <div className="row between">
            <h1>キャラクター</h1>
            <motion.button
              className="btn btn-primary"
              onClick={addCharacter}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              ＋ キャラクターを追加
            </motion.button>
          </div>
          <p style={{ color: 'var(--text-soft)' }}>
            登場人物の設定をまとめておくと、執筆中の設定ブレを防げます。
          </p>

          {novel.characters.length === 0 && (
            <div className="empty-state">
              まだキャラクターが登録されていません。
            </div>
          )}

          <AnimatePresence>
            {novel.characters.map((c) => (
              <motion.div
                className="item-row"
                key={c.id}
                layout
                variants={itemVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <div className="item-row-head">
                  <input
                    className="name"
                    placeholder="名前"
                    value={c.name}
                    onChange={(e) => patch(c.id, { name: e.target.value })}
                  />
                  <input
                    className="input"
                    style={{ width: 140 }}
                    placeholder="ふりがな"
                    value={c.kana}
                    onChange={(e) => patch(c.id, { kana: e.target.value })}
                  />
                  <select
                    className="status-select"
                    value={c.role}
                    onChange={(e) => patch(c.id, { role: e.target.value })}
                  >
                    <option value="主人公">主人公</option>
                    <option value="ヒロイン">ヒロイン</option>
                    <option value="敵役">敵役</option>
                    <option value="脇役">脇役</option>
                    <option value="モブ">モブ</option>
                  </select>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => remove(c.id)}
                  >
                    削除
                  </button>
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <input
                    className="input"
                    placeholder="ひとことプロフィール（年齢・職業・外見など）"
                    value={c.summary}
                    onChange={(e) => patch(c.id, { summary: e.target.value })}
                  />
                </div>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="性格・背景・目標・口調・人間関係など詳細メモ"
                  value={c.details}
                  onChange={(e) => patch(c.id, { details: e.target.value })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
