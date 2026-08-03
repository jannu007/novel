import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from '../components/TopBar';
import EmptyIllustration from '../components/EmptyIllustration';
import { useNovel } from '../lib/useNovel';
import type { Chapter } from '../types';
import { countChars, countNovelChars, todayStr } from '../lib/textStats';
import { REWRITE_INSTRUCTIONS, applyRewriteInstruction } from '../lib/rewriteEngine';
import { loadPhraseHistory, recordPhraseUsage } from '../lib/phraseHistory';

export default function Editor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { novel, update, saveStatus } = useNovel(id);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [showMemo, setShowMemo] = useState(false);
  const [showRewrite, setShowRewrite] = useState(false);
  const [rewriteKey, setRewriteKey] = useState(REWRITE_INSTRUCTIONS[0].key);
  const [rewriteSeed, setRewriteSeed] = useState(0);
  const [rewritePreview, setRewritePreview] = useState<string | null>(null);
  const [rewriteAvoid, setRewriteAvoid] = useState<Set<string>>(new Set());
  const [pendingUsedTemplates, setPendingUsedTemplates] = useState<string[]>([]);
  const [lastApplied, setLastApplied] = useState<{
    chapterId: string;
    previousContent: string;
  } | null>(null);
  const appliedInitialChapter = useRef(false);

  useEffect(() => {
    loadPhraseHistory().then(setRewriteAvoid);
  }, []);

  useEffect(() => {
    setRewritePreview(null);
    setPendingUsedTemplates([]);
    setRewriteSeed(0);
  }, [activeChapterId]);

  const chapters = useMemo(
    () => (novel ? [...novel.chapters].sort((a, b) => a.order - b.order) : []),
    [novel]
  );

  useEffect(() => {
    if (chapters.length === 0 || appliedInitialChapter.current) return;
    const requested = searchParams.get('chapter');
    if (requested && chapters.some((c) => c.id === requested)) {
      setActiveChapterId(requested);
      appliedInitialChapter.current = true;
      return;
    }
    if (!activeChapterId) {
      setActiveChapterId(chapters[0].id);
      appliedInitialChapter.current = true;
    }
  }, [chapters, searchParams, activeChapterId]);

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

  function generateRewritePreview() {
    if (!activeChapter) return;
    const result = applyRewriteInstruction(
      activeChapter.content,
      rewriteKey,
      novel!,
      rewriteSeed,
      rewriteAvoid
    );
    setRewritePreview(result.text);
    setPendingUsedTemplates(result.usedTemplates);
  }

  function retryRewritePreview() {
    if (!activeChapter) return;
    const nextSeed = rewriteSeed + 1;
    setRewriteSeed(nextSeed);
    const result = applyRewriteInstruction(
      activeChapter.content,
      rewriteKey,
      novel!,
      nextSeed,
      rewriteAvoid
    );
    setRewritePreview(result.text);
    setPendingUsedTemplates(result.usedTemplates);
  }

  function applyRewritePreview() {
    if (!activeChapter || rewritePreview === null) return;
    setLastApplied({ chapterId: activeChapter.id, previousContent: activeChapter.content });
    patchChapter(activeChapter.id, { content: rewritePreview });
    if (pendingUsedTemplates.length > 0) {
      void recordPhraseUsage(pendingUsedTemplates);
      setRewriteAvoid((prev) => new Set([...prev, ...pendingUsedTemplates]));
    }
    setRewritePreview(null);
    setPendingUsedTemplates([]);
  }

  function discardRewritePreview() {
    setRewritePreview(null);
    setPendingUsedTemplates([]);
  }

  function undoRewrite() {
    if (!activeChapter || !lastApplied || lastApplied.chapterId !== activeChapter.id) return;
    patchChapter(activeChapter.id, { content: lastApplied.previousContent });
    setLastApplied(null);
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
                <motion.li
                  key={c.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.02 }}
                >
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
                </motion.li>
              ))}
            </ul>
            <div style={{ padding: 10 }}>
              <button className="btn btn-block btn-sm" onClick={addChapter}>
                ＋ 章を追加
              </button>
            </div>
          </aside>

          <div className="editor-main">
            <AnimatePresence mode="wait">
              {activeChapter ? (
                <motion.div
                  key={activeChapter.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                  }}
                >
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
                    <button
                      className="btn btn-sm"
                      onClick={() => setShowRewrite((s) => !s)}
                    >
                      {showRewrite ? '指示リライトを閉じる' : '章をAIで修正'}
                    </button>
                    {lastApplied?.chapterId === activeChapter.id && (
                      <button className="btn btn-sm" onClick={undoRewrite}>
                        リライトを元に戻す
                      </button>
                    )}
                  </div>
                  <AnimatePresence>
                    {showRewrite && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          overflow: 'hidden',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div
                          style={{
                            padding: '14px 20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                          }}
                        >
                          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
                            <select
                              className="input"
                              style={{ width: 'auto' }}
                              value={rewriteKey}
                              onChange={(e) => {
                                setRewriteKey(e.target.value);
                                setRewritePreview(null);
                              }}
                            >
                              {REWRITE_INSTRUCTIONS.map((r) => (
                                <option key={r.key} value={r.key}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn-sm" onClick={generateRewritePreview}>
                              プレビューを生成
                            </button>
                            {rewritePreview !== null && (
                              <button className="btn btn-sm" onClick={retryRewritePreview}>
                                別の候補を試す
                              </button>
                            )}
                          </div>
                          <p className="hint" style={{ margin: 0 }}>
                            {
                              REWRITE_INSTRUCTIONS.find((r) => r.key === rewriteKey)
                                ?.description
                            }
                            　外部AIは使わず、端末内のルールだけで本文を調整します（通信は発生しません）。反映前に必ず内容を確認してください。
                          </p>
                          {rewritePreview !== null && (
                            <>
                              <div className="rewrite-preview">
                                {rewritePreview || '（本文がありません）'}
                              </div>
                              <div className="row" style={{ gap: 10 }}>
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={applyRewritePreview}
                                >
                                  この内容を反映する
                                </button>
                                <button className="btn btn-sm" onClick={discardRewritePreview}>
                                  破棄
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {showMemo && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          overflow: 'hidden',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ padding: '10px 20px' }}>
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
                      </motion.div>
                    )}
                  </AnimatePresence>
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
                        <motion.div
                          animate={{ width: `${totalPct}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </span>
                      {totalPct}%
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      今日:
                      <span className="progress-bar">
                        <motion.div
                          animate={{ width: `${dailyPct}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </span>
                      {todayChars.toLocaleString()} / {dailyTarget.toLocaleString()}字
                    </span>
                    <span style={{ minWidth: 70 }}>
                      <AnimatePresence mode="wait">
                        {saveStatus === 'saving' && (
                          <motion.span
                            key="saving"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                          >
                            保存中…
                          </motion.span>
                        )}
                        {saveStatus === 'saved' && (
                          <motion.span
                            key="saved"
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                            style={{ color: 'var(--success)' }}
                          >
                            ✓ 保存済み
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  className="empty-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <EmptyIllustration variant="chapter" />
                  章を選択してください
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
