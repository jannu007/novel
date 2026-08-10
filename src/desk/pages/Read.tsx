import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWork } from '../useWork';
import { NotFound } from '../components/Chrome';
import { CloseIcon } from '../components/Icons';
import { toReadableText, paginateVertical, readableToHtml } from '../../lib/paginate';

/**
 * 縦書きのページ送りで読む画面。
 * 実際の文字幅を測ってページを割るので、ルビが入っても行が崩れない。
 */
export default function Read() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { work } = useWork(id);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState<string[] | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const chapters = useMemo(
    () => (work ? [...work.chapters].sort((a, b) => a.order - b.order) : []),
    [work]
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setBox((prev) => {
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        return prev && prev.w === w && prev.h === h ? prev : { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [work]);

  const chapter = chapters[chapterIndex];

  useEffect(() => {
    if (!box || !measureRef.current || !chapter) return;
    const computed = paginateVertical(
      measureRef.current,
      toReadableText(chapter.content),
      box.w
    );
    setPages(computed);
    setPageIndex((p) => Math.min(p, computed.length - 1));
  }, [box, chapter]);

  if (work === undefined) return <div className="body muted">読み込み中…</div>;
  if (work === null) return <NotFound />;

  const hasPrev = pageIndex > 0 || chapterIndex > 0;
  const hasNext =
    (pages !== null && pageIndex < pages.length - 1) || chapterIndex < chapters.length - 1;

  // 縦書きは右から左へ進むので、左向きのスワイプで次のページに送る
  function next() {
    if (pages && pageIndex < pages.length - 1) setPageIndex((i) => i + 1);
    else if (chapterIndex < chapters.length - 1) {
      setChapterIndex((i) => i + 1);
      setPageIndex(0);
    }
  }

  function prev() {
    if (pageIndex > 0) setPageIndex((i) => i - 1);
    else if (chapterIndex > 0) {
      setChapterIndex((i) => i - 1);
      setPageIndex(0);
    }
  }

  return (
    <div className="reader">
      <div className="reader-bar">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="閉じる">
          <CloseIcon />
        </button>
        <select
          className="input"
          style={{ width: 'auto', flex: 1, minWidth: 0 }}
          value={chapterIndex}
          onChange={(e) => {
            setChapterIndex(Number(e.target.value));
            setPageIndex(0);
          }}
        >
          {chapters.map((c, i) => (
            <option key={c.id} value={i}>
              {c.title || `第${i + 1}章`}
            </option>
          ))}
        </select>
        <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {pages ? `${pageIndex + 1}/${pages.length}` : '—'}
        </span>
      </div>

      <div
        className="reader-stage"
        ref={stageRef}
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (start === null) return;
          const dx = e.changedTouches[0].clientX - start;
          if (dx < -50) next();
          else if (dx > 50) prev();
        }}
        onClick={(e) => {
          // 画面の左寄りをタップで次ページ、右寄りで前ページ
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX - rect.left < rect.width * 0.4) next();
          else if (e.clientX - rect.left > rect.width * 0.6) prev();
        }}
      >
        <div className="vmeasure" aria-hidden>
          <div className="vtext" ref={measureRef} style={box ? { height: box.h } : undefined} />
        </div>
        <div
          className="vtext"
          dangerouslySetInnerHTML={{ __html: readableToHtml(pages?.[pageIndex] ?? '') }}
        />
      </div>

      <div className="reader-foot">
        <button className="btn btn-sm" onClick={prev} disabled={!hasPrev}>
          前へ
        </button>
        <span>左半分をタップ／左スワイプで次へ</span>
        <button className="btn btn-sm" onClick={next} disabled={!hasNext}>
          次へ
        </button>
      </div>
    </div>
  );
}
