import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from '../components/TopBar';
import EmptyIllustration from '../components/EmptyIllustration';
import { useNovel } from '../lib/useNovel';
import type { Chapter } from '../types';
import { countChars, countNovelChars, todayStr } from '../lib/textStats';
import { REWRITE_INSTRUCTIONS, applyRewriteInstruction } from '../lib/rewriteEngine';
import { insertRubyNotation, insertEmphasisNotation } from '../lib/inlineMarkup';
import { loadPhraseHistory, recordPhraseUsage } from '../lib/phraseHistory';

const VERTICAL_KEY = 'novel-studio:vertical';

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 縦書き（右から左）で書くかどうか。選んだ状態は次回も引き継ぐ。
  const [vertical, setVertical] = useState(
    () => localStorage.getItem(VERTICAL_KEY) === 'yes'
  );
  const appliedInitialChapter = useRef(false);
  const manuscriptRef = useRef<HTMLTextAreaElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    loadPhraseHistory().then(setRewriteAvoid);
  }, []);

  useEffect(() => {
    localStorage.setItem(VERTICAL_KEY, vertical ? 'yes' : 'no');
  }, [vertical]);

  useEffect(() => {
    setRewritePreview(null);
    setPendingUsedTemplates([]);
    setRewriteSeed(0);
    setIsFullscreen(false);
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

  // 文章欄の表示範囲が狭い問題への対策：本文が最後（または最初）まで
  // スクロールされた状態からさらに上/下へスワイプしたときだけ全画面表示を
  // 切り替える。この境界チェックにより、本文を読むための通常のスクロールと
  // ジェスチャーが競合しないようにしている。
  function handleManuscriptTouchStart(e: React.TouchEvent<HTMLTextAreaElement>) {
    if (vertical) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function handleManuscriptTouchEnd(e: React.TouchEvent<HTMLTextAreaElement>) {
    if (vertical) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const el = manuscriptRef.current;
    if (!start || !el) return;
    const touch = e.changedTouches[0];
    const deltaY = touch.clientY - start.y;
    const deltaX = touch.clientX - start.x;
    const deltaT = Date.now() - start.t;
    if (deltaT > 700) return;
    if (Math.abs(deltaY) < 60) return;
    if (Math.abs(deltaY) < Math.abs(deltaX) * 1.5) return;

    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    const atTop = el.scrollTop <= 4;
    if (deltaY < 0 && !isFullscreen && atBottom) {
      setIsFullscreen(true);
    } else if (deltaY > 0 && isFullscreen && atTop) {
      setIsFullscreen(false);
    }
  }

  /**
   * 本文欄で選択している文字にルビ・傍点の記法を付ける。
   * 記法はプレーンテキストとして本文に埋め込まれ、EPUB・DOCX・
   * 印刷プレビュー・縦書きリーダーでそれぞれの体裁に展開される。
   */
  function insertMarkup(kind: 'ruby' | 'emphasis') {
    const el = manuscriptRef.current;
    if (!el || !activeChapter) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) {
      alert(
        kind === 'ruby'
          ? 'ルビを振りたい文字を選択してから押してください。'
          : '傍点を打ちたい文字を選択してから押してください。'
      );
      return;
    }
    let result;
    if (kind === 'ruby') {
      const reading = prompt('ふりがなを入力してください', '');
      if (reading === null || reading.trim() === '') return;
      result = insertRubyNotation(el.value, start, end, reading.trim());
    } else {
      result = insertEmphasisNotation(el.value, start, end);
    }
    patchChapter(activeChapter.id, { content: result.text });
    // 本文の更新後にカーソル位置を復元する
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
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
        {!isFullscreen && (
          <TopBar novelId={novel.id} novelTitle={novel.title} activeTab="write" />
        )}
        <div className="editor-shell">
          {!isFullscreen && (
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
          )}

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
                  {!isFullscreen && (
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
                      onClick={() => setVertical((v) => !v)}
                      title={vertical ? '横書きに切り替える' : '縦書き（右から左）に切り替える'}
                    >
                      {vertical ? '横書き' : '縦書き'}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setIsFullscreen(true)}
                      title="本文だけの全画面にする"
                    >
                      全画面
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => insertMarkup('ruby')}
                      title="選択した文字にふりがな（ルビ）を振る"
                    >
                      ルビ
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => insertMarkup('emphasis')}
                      title="選択した文字に傍点を打つ"
                    >
                      傍点
                    </button>
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
                  )}
                  {!isFullscreen && (
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
                  )}
                  {!isFullscreen && (
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
                  )}
                  {!isFullscreen && (
                    <div className="manuscript-wrap">
                      <textarea
                        ref={manuscriptRef}
                        className={`manuscript ${vertical ? 'tategaki' : ''}`}
                        value={activeChapter.content}
                        onChange={(e) =>
                          patchChapter(activeChapter.id, { content: e.target.value })
                        }
                        onTouchStart={handleManuscriptTouchStart}
                        onTouchEnd={handleManuscriptTouchEnd}
                        placeholder="ここから物語を書き始めましょう…"
                        spellCheck={false}
                      />
                    </div>
                  )}
                  {isFullscreen &&
                    createPortal(
                      <div className="manuscript-wrap manuscript-fullscreen">
                        <div className="fullscreen-hint">
                          {vertical ? (
                            <button
                              className="btn btn-sm"
                              onClick={() => setIsFullscreen(false)}
                            >
                              全画面をやめる
                            </button>
                          ) : (
                            '上から下にスワイプで戻る'
                          )}
                        </div>
                        <textarea
                          ref={manuscriptRef}
                          className={`manuscript ${vertical ? 'tategaki' : ''}`}
                          value={activeChapter.content}
                          onChange={(e) =>
                            patchChapter(activeChapter.id, { content: e.target.value })
                          }
                          onTouchStart={handleManuscriptTouchStart}
                          onTouchEnd={handleManuscriptTouchEnd}
                          placeholder="ここから物語を書き始めましょう…"
                          spellCheck={false}
                          autoFocus
                        />
                      </div>,
                      document.body
                    )}
                  {!isFullscreen && (
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
                  )}
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
