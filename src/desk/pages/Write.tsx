import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWork } from '../useWork';
import { AppBar, TabBar, Sheet, NotFound } from '../components/Chrome';
import { ListIcon, ExpandIcon, ShrinkIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { countChars, countNovelChars, todayStr } from '../../lib/textStats';
import { insertRubyNotation, insertEmphasisNotation } from '../../lib/inlineMarkup';
import type { Chapter } from '../../types';

export default function Write() {
  const { id } = useParams();
  const { work, update, saveState } = useWork(id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showChapters, setShowChapters] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [focus, setFocus] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const baselineDone = useRef(false);

  const chapters = useMemo(
    () => (work ? [...work.chapters].sort((a, b) => a.order - b.order) : []),
    [work]
  );

  useEffect(() => {
    if (!activeId && chapters.length > 0) setActiveId(chapters[0].id);
  }, [chapters, activeId]);

  // 「今日書いた分」の基準を、日付が変わったら取り直す
  useEffect(() => {
    if (!work || baselineDone.current) return;
    baselineDone.current = true;
    const today = todayStr();
    if (work.progressBaseline?.date !== today) {
      const total = countNovelChars(work.chapters);
      update((w) => ({ ...w, progressBaseline: { date: today, chars: total } }));
    }
  }, [work, update]);

  // 集中モードのあいだは背面のスクロールを止める
  useEffect(() => {
    document.body.style.overflow = focus ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [focus]);

  if (work === undefined) return <div className="body muted">読み込み中…</div>;
  if (work === null) return <NotFound />;

  const active = chapters.find((c) => c.id === activeId) ?? null;
  const total = countNovelChars(work.chapters);
  const today = Math.max(0, total - (work.progressBaseline?.chars ?? 0));
  const dailyTarget = work.goal?.dailyWordTarget || 1000;

  function patch(chapterId: string, part: Partial<Chapter>) {
    update((w) => ({
      ...w,
      chapters: w.chapters.map((c) =>
        c.id === chapterId ? { ...c, ...part, updatedAt: Date.now() } : c
      ),
    }));
  }

  function addChapter() {
    const now = Date.now();
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      title: `第${chapters.length + 1}章`,
      content: '',
      order: chapters.length,
      memo: '',
      createdAt: now,
      updatedAt: now,
    };
    update((w) => ({ ...w, chapters: [...w.chapters, chapter] }));
    setActiveId(chapter.id);
    setShowChapters(false);
  }

  function removeChapter(chapterId: string) {
    if (chapters.length <= 1) {
      alert('最後の章は削除できません。');
      return;
    }
    const target = chapters.find((c) => c.id === chapterId);
    if (!confirm(`「${target?.title || '無題'}」を削除します。`)) return;
    const rest = chapters.filter((c) => c.id !== chapterId).map((c, i) => ({ ...c, order: i }));
    update((w) => ({ ...w, chapters: rest }));
    if (activeId === chapterId) setActiveId(rest[0]?.id ?? null);
  }

  function moveChapter(chapterId: string, dir: -1 | 1) {
    const i = chapters.findIndex((c) => c.id === chapterId);
    const j = i + dir;
    if (j < 0 || j >= chapters.length) return;
    const next = [...chapters];
    [next[i], next[j]] = [next[j], next[i]];
    update((w) => ({ ...w, chapters: next.map((c, k) => ({ ...c, order: k })) }));
  }

  /**
   * 選択した文字にルビ・傍点の記法を付ける。
   * 記法は本文にそのまま残り、書き出しのときに正しい体裁へ展開される。
   */
  function mark(kind: 'ruby' | 'boten') {
    const el = areaRef.current;
    if (!el || !active) return;
    const { selectionStart: s, selectionEnd: e } = el;
    if (s === e) {
      alert(kind === 'ruby' ? 'ふりがなを振る文字を選んでください。' : '傍点を打つ文字を選んでください。');
      return;
    }
    let result;
    if (kind === 'ruby') {
      const reading = prompt('ふりがな', '');
      if (reading === null || reading.trim() === '') return;
      result = insertRubyNotation(el.value, s, e, reading.trim());
    } else {
      result = insertEmphasisNotation(el.value, s, e);
    }
    patch(active.id, { content: result.text });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  const editor = (
    <textarea
      ref={areaRef}
      className="manuscript"
      value={active?.content ?? ''}
      onChange={(e) => active && patch(active.id, { content: e.target.value })}
      placeholder="ここから書きはじめましょう。"
      spellCheck={false}
    />
  );

  const tools = (
    <div className="write-tools">
      <button className="btn btn-sm" onClick={() => mark('ruby')}>
        ルビ
      </button>
      <button className="btn btn-sm" onClick={() => mark('boten')}>
        傍点
      </button>
      <button className="btn btn-sm" onClick={() => setShowMemo(true)}>
        メモ
      </button>
      <button
        className="icon-btn"
        onClick={() => setFocus((f) => !f)}
        aria-label={focus ? '集中モードを終える' : '集中モード'}
      >
        {focus ? <ShrinkIcon /> : <ExpandIcon />}
      </button>
      <span className="count">
        {countChars(active?.content ?? '').toLocaleString()}字 ／ 今日
        {today.toLocaleString()}/{dailyTarget.toLocaleString()}
      </span>
    </div>
  );

  if (focus) {
    return (
      <div className="focus-mode">
        {editor}
        {tools}
      </div>
    );
  }

  return (
    <div className="screen">
      <AppBar
        title={active?.title || '無題の章'}
        sub={`${work.title || '無題'}・${saveState === 'saving' ? '保存中…' : '保存済み'}`}
        back="/"
        actions={
          <button
            className="icon-btn"
            onClick={() => setShowChapters(true)}
            aria-label="章の一覧"
          >
            <ListIcon />
          </button>
        }
      />

      <div className="body flush write-area">
        {active ? (
          <>
            {editor}
            {tools}
          </>
        ) : (
          <div className="empty">
            <span className="mark">章</span>
            章がありません。
          </div>
        )}
      </div>

      {showChapters && (
        <Sheet title="章の一覧" onClose={() => setShowChapters(false)}>
          <ul className="chapter-list">
            {chapters.map((c, i) => (
              <li key={c.id} className={`chapter-row ${c.id === activeId ? 'on' : ''}`}>
                <button
                  className="pick"
                  onClick={() => {
                    setActiveId(c.id);
                    setShowChapters(false);
                  }}
                >
                  <b>{c.title || '(無題)'}</b>
                  <span>{countChars(c.content).toLocaleString()}字</span>
                </button>
                <button
                  className="icon-btn"
                  disabled={i === 0}
                  onClick={() => moveChapter(c.id, -1)}
                  aria-label="上へ"
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  disabled={i === chapters.length - 1}
                  onClick={() => moveChapter(c.id, 1)}
                  aria-label="下へ"
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  onClick={() => removeChapter(c.id)}
                  aria-label="削除"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn btn-wide" style={{ marginTop: 12 }} onClick={addChapter}>
            <PlusIcon />
            章を追加
          </button>

          {active && (
            <>
              <div className="section-title">この章の題</div>
              <input
                className="input"
                value={active.title}
                onChange={(e) => patch(active.id, { title: e.target.value })}
                placeholder="章のタイトル"
              />
            </>
          )}
        </Sheet>
      )}

      {showMemo && active && (
        <Sheet title="この章のメモ" onClose={() => setShowMemo(false)}>
          <p className="muted" style={{ marginTop: 0 }}>
            伏線や次に書くことなど。本文には書き出されません。
          </p>
          <textarea
            className="area"
            rows={7}
            value={active.memo}
            onChange={(e) => patch(active.id, { memo: e.target.value })}
            placeholder="例：ここで指輪の伏線を張る"
          />
        </Sheet>
      )}

      <TabBar workId={work.id} />
    </div>
  );
}
