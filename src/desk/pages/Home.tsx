import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listWorks, saveWork, deleteWork } from '../db';
import { createEmptyNovel, type Novel } from '../../types';
import { countNovelChars } from '../../lib/textStats';
import { useTheme, THEME_LABEL } from '../useTheme';
import { Sheet } from '../components/Chrome';
import { PlusIcon, ThemeIcon, TrashIcon } from '../components/Icons';

export default function Home() {
  const navigate = useNavigate();
  const [works, setWorks] = useState<Novel[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const { mode, setMode } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setWorks(await listWorks());
  }

  async function create() {
    const work = createEmptyNovel(crypto.randomUUID(), title.trim() || '無題');
    await saveWork(work);
    navigate(`/w/${work.id}`);
  }

  async function remove(work: Novel) {
    if (!confirm(`「${work.title || '無題'}」を削除します。取り消せません。`)) return;
    await deleteWork(work.id);
    await refresh();
  }

  /** 従来アプリや他端末で書き出したバックアップJSONを取り込む。 */
  async function importBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Novel;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chapters)) {
        throw new Error('形式が違います');
      }
      // 取り込み元と衝突しないよう、新しいIDを振り直す
      const work: Novel = { ...parsed, id: crypto.randomUUID(), updatedAt: Date.now() };
      await saveWork(work);
      await refresh();
      alert(`「${work.title || '無題'}」を読み込みました。`);
    } catch {
      alert('バックアップファイルを読み込めませんでした。');
    }
  }

  return (
    <div className="screen no-tabs">
      <div className="hero">
        <div className="row">
          <div className="brand">
            <b>文机</b>
            <i>ふづくえ</i>
          </div>
          <div className="spacer" />
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            aria-label="設定"
          >
            <ThemeIcon />
          </button>
        </div>
        <p>
          書いて、整えて、本の形にするまで。すべて無料で、この端末の中だけで完結します。
        </p>
      </div>

      <div className="body">
        {creating ? (
          <div className="card stack">
            <label className="field" style={{ margin: 0 }}>
              <span>作品のタイトル</span>
              <input
                className="input"
                autoFocus
                value={title}
                placeholder="例：月の裏側で待つ"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
            </label>
            <div className="row">
              <button className="btn btn-seal" onClick={() => void create()}>
                はじめる
              </button>
              <button className="btn btn-quiet" onClick={() => setCreating(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-seal btn-wide"
            onClick={() => {
              setTitle('');
              setCreating(true);
            }}
          >
            <PlusIcon />
            新しい作品を書きはじめる
          </button>
        )}

        {works === null && <p className="muted" style={{ marginTop: 20 }}>読み込み中…</p>}

        {works && works.length === 0 && (
          <div className="empty">
            <span className="mark">白</span>
            まだ作品がありません。
            <br />
            最初の一冊をはじめましょう。
          </div>
        )}

        {works && works.length > 0 && (
          <>
            <div className="section-title">作品</div>
            <ul className="work-list">
              {works.map((w) => {
                const chars = countNovelChars(w.chapters);
                const target = w.goal?.totalWordTarget || 1;
                const pct = Math.min(100, Math.round((chars / target) * 100));
                return (
                  <li className="work" key={w.id}>
                    <div className="spine">{(w.title || '無題').slice(0, 8)}</div>
                    <button className="main" onClick={() => navigate(`/w/${w.id}`)}>
                      <b>{w.title || '無題'}</b>
                      <div className="meta">
                        <span>{w.chapters.length}章</span>
                        <span>{chars.toLocaleString()}字</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="gauge">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                    </button>
                    <div className="actions">
                      <button
                        className="icon-btn"
                        onClick={() => void remove(w)}
                        aria-label={`${w.title || '無題'}を削除`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {showSettings && (
        <Sheet title="設定" onClose={() => setShowSettings(false)}>
          <div className="section-title" style={{ marginTop: 0 }}>
            配色
          </div>
          <div className="stack">
            {(['auto', 'paper', 'ink'] as const).map((m) => (
              <button
                key={m}
                className={`btn btn-wide ${mode === m ? 'btn-seal' : ''}`}
                onClick={() => setMode(m)}
              >
                {THEME_LABEL[m]}
              </button>
            ))}
          </div>

          <div className="section-title">データ</div>
          <p className="muted">
            作品はこの端末のブラウザ内にだけ保存されます。サーバーには一切送信されません。
            ブラウザのデータを消すと原稿も消えるため、「仕上げ」画面から
            ときどきバックアップを保存してください。
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importBackup(file);
              e.target.value = '';
            }}
          />
          <button className="btn btn-wide" onClick={() => fileRef.current?.click()}>
            バックアップから読み込む
          </button>
          <p className="muted" style={{ marginTop: 16 }}>
            「文机」は完全無料・広告なしのアプリです。作品の著作権はすべて書いた本人にあります。
          </p>
          <p className="muted">
            以前の「小説執筆スタジオ」で書いた作品は、あちらの画面で保存した
            バックアップJSONを上の「バックアップから読み込む」で取り込めます。
            <br />
            <a href="../" style={{ color: 'var(--seal)' }}>
              小説執筆スタジオを開く
            </a>
          </p>
        </Sheet>
      )}
    </div>
  );
}
