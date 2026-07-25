import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useNovel } from '../lib/useNovel';
import type { Chapter } from '../types';
import { countChars, countNovelChars, todayStr } from '../lib/textStats';

export default function Editor() {
  const { id } = useParams();
  const { novel, update, saveStatus } = useNovel(id);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [showMemo, setShowMemo] = useState(false);

  const chapters = useMemo(
    () => (novel ? [...novel.chapters].sort((a, b) => a.order - b.order) : []),
    [novel]
  );

  useEffect(() => {
    if (chapters.length > 0 && !activeChapterId) {
      setActiveChapterId(chapters[0].id);
    }
  }, [chapters, activeChapterId]);

  // 今日の執筆進捗の基準値を日付が変わるたびリセット
  useEffect(() => {
    if (!novel) return;
    const today = todayStr();
    if (novel.progressBaseline?.date !== today) {
      const total = countNovelChars(novel.chapters);
      update((n) => ({
        ...n,
        progressBaseline: { date: today, chars: total },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel?.id]);

  if (novel === undefined) {
    return <div className="page">読み込み中…</div>;
  }
  if (novel === null) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? null;
  const totalChars = countNovelChars(novel.chapters);
  const todayChars = Math.max(
    0,
    totalChars - (novel.progressBaseline?.chars ?? 0)
  );
  const target = novel.goal?.totalWordTarget || 1;
  const totalPct = Math.min(100, Math.round((totalChars / target) * 100));
  const dailyTarget = novel.goal?.dailyWordTarget || 1;
  const dailyPct = Math.min(100, Math.round((todayChars / dailyTarget) * 100));

  function patchChapter(chapterId: string, patch: Partial<Chapter>) {
    update((n) => ({
      ...n,
      chapters: n.chapters.map((c) =>
        c.id === chapterId ? { ...c, ...patch, updatedAt: Date.now() } : c
      ),
    }));
  }

  function addChapter() {
    const now = Date.now();
    const newChapter: Chapter = {
      id: crypto.randomUUID(),
      title: `第${chapters.length + 1}章`,
      content: '',
      order: chapters.length,
      memo: '',
      createdAt: now,
      updatedAt: now,
    };
    update((n) => ({ ...n, chapters: [...n.chapters, newChapter] }));
    setActiveChapterId(newChapter.id);
  }

  function deleteChapter(chapterId: string) {
    if (chapters.length <= 1) {
      alert('最後の1章は削除できません。');
      return;
    }
    const chap = chapters.find((c) => c.id === chapterId);
    if (!confirm(`「${chap?.title}」を削除しますか？`)) return;
    update((n) => ({
      ...n,
      chapters: n.chapters
        .filter((c) => c.id !== chapterId)
        .map((c, i) => ({ ...c, order: i })),
    }));
    if (activeChapterId === chapterId) {
      setActiveChapterId(null);
    }
  }

  function moveChapter(chapterId: string, dir: -1 | 1) {
    const idx = chapters.findIndex((c) => c.id === chapterId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= chapters.length) return;
    const reordered = [...chapters];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const withOrder = reordered.map((c, i) => ({ ...c, order: i }));
    update((n) => ({
      ...n,
      chapters: n.chapters.map(
        (c) => withOrder.find((w) => w.id === c.id) ?? c
      ),
    }));
  }

  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar novelId={novel.id} novelTitle={novel.title} activeTab="write" />
        <div className="editor-shell">
          <aside className="chapter-sidebar">
            <ul className="chapter-list">
              {chapters.map((c, i) => (
                <li key={c.id}>
                  <button
                    className={`chapter-item ${
                      c.id === activeChapterId ? 'active' : ''
                    }`}
                    onClick={() => setActiveChapterId(c.id)}
                  >
                    <span className="title">{c.title || '(無題)'}</span>
                    <span className="count">
                      {countChars(c.content).toLocaleString()}字
                    </span>
                  </button>
                  {c.id === activeChapterId && (
                    <div className="row gap-sm" style={{ padding: '2px 10px 6px' }}>
                      <button
                        className="btn btn-sm"
                        disabled={i === 0}
                        onClick={() => moveChapter(c.id, -1)}
                        title="上に移動"
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={i === chapters.length - 1}
                        onClick={() => moveChapter(c.id, 1)}
                        title="下に移動"
                      >
                        ↓
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => deleteChapter(c.id)}
                      >
                        削除
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ padding: 10 }}>
              <button className="btn btn-block btn-sm" onClick={addChapter}>
                ＋ 章を追加
              </button>
            </div>
          </aside>

          <div className="editor-main">
            {activeChapter ? (
              <>
                <div className="editor-toolbar">
                  <input
                    className="chapter-title"
                    value={activeChapter.title}
                    onChange={(e) =>
                      patchChapter(activeChapter.id, { title: e.target.value })
                    }
                    placeholder="章のタイトル"
                  />
                  <button
                    className="btn btn-sm"
                    onClick={() => setShowMemo((s) => !s)}
                  >
                    {showMemo ? 'メモを閉じる' : 'メモ'}
                  </button>
                </div>
                {showMemo && (
                  <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder="この章のメモ・伏線・アイデアなど"
                      value={activeChapter.memo}
                      onChange={(e) =>
                        patchChapter(activeChapter.id, { memo: e.target.value })
                      }
                    />
                  </div>
                )}
                <textarea
                  className="manuscript"
                  value={activeChapter.content}
                  onChange={(e) =>
                    patchChapter(activeChapter.id, { content: e.target.value })
                  }
                  placeholder="ここから物語を書き始めましょう…"
                  spellCheck={false}
                />
                <div className="editor-statusbar">
                  <span>
                    この章: <strong>{countChars(activeChapter.content).toLocaleString()}</strong> 文字
                  </span>
                  <span>
                    作品全体: <strong>{totalChars.toLocaleString()}</strong> 文字
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    目標達成率
                    <span className="progress-bar">
                      <div style={{ width: `${totalPct}%` }} />
                    </span>
                    {totalPct}%
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    今日:
                    <span className="progress-bar">
                      <div style={{ width: `${dailyPct}%` }} />
                    </span>
                    {todayChars.toLocaleString()} / {dailyTarget.toLocaleString()}字
                  </span>
                  <span>
                    {saveStatus === 'saving' && '保存中…'}
                    {saveStatus === 'saved' && '✓ 保存済み'}
                  </span>
                </div>
              </>
            ) : (
              <div className="empty-state">章を選択してください</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
