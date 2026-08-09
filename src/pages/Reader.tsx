import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { useNovel } from '../lib/useNovel';
import { toReadableText, paginateVertical, readableToHtml } from '../lib/paginate';

const pageVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 260 : -260,
    rotateY: dir > 0 ? 20 : -20,
    opacity: 0,
  }),
  center: { x: 0, rotateY: 0, opacity: 1 },
  exit: (dir: number) => ({
    x: dir > 0 ? -260 : 260,
    rotateY: dir > 0 ? -20 : 20,
    opacity: 0,
  }),
};

export default function Reader() {
  const { id } = useParams();
  const { novel } = useNovel(id);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [pages, setPages] = useState<string[] | null>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const chapters = useMemo(
    () => (novel ? [...novel.chapters].sort((a, b) => a.order - b.order) : []),
    [novel]
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setBoxSize((prev) => {
        const w = Math.round(box.width);
        const h = Math.round(box.height);
        if (prev && prev.w === w && prev.h === h) return prev;
        return { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // novel が読み込まれるまでboxRefの実DOMが存在しないため、
    // 読み込み完了後に再度effectを実行してobserverを取り付け直す
  }, [novel]);

  useEffect(() => {
    if (!boxSize || !measureRef.current || chapters.length === 0) return;
    const chapter = chapters[chapterIndex];
    if (!chapter) return;
    const text = toReadableText(chapter.content);
    const computed = paginateVertical(measureRef.current, text, boxSize.w);
    setPages(computed);
    setPageIndex((prev) => Math.min(prev, computed.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxSize, chapterIndex, chapters.length, chapters[chapterIndex]?.content]);

  if (novel === undefined) return <div className="page">読み込み中…</div>;
  if (novel === null || chapters.length === 0) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  const chapter = chapters[chapterIndex];
  const hasPrevPage = pageIndex > 0 || chapterIndex > 0;
  const hasNextPage =
    (pages && pageIndex < pages.length - 1) || chapterIndex < chapters.length - 1;

  function goNext() {
    if (pages && pageIndex < pages.length - 1) {
      setDirection(1);
      setPageIndex((i) => i + 1);
    } else if (chapterIndex < chapters.length - 1) {
      setDirection(1);
      setChapterIndex((i) => i + 1);
    }
  }

  function goPrev() {
    if (pages && pageIndex > 0) {
      setDirection(-1);
      setPageIndex((i) => i - 1);
    } else if (chapterIndex > 0) {
      setDirection(-1);
      setChapterIndex((i) => i - 1);
    }
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > 70) {
      goNext();
    } else if (info.offset.x < -70) {
      goPrev();
    }
  }

  return (
    <div className="reader-shell">
      <div className="reader-toolbar">
        <Link to={`/novel/${novel.id}/export`} className="btn btn-sm">
          ← 戻る
        </Link>
        <div className="reader-chapter-nav">
          <button
            className="btn btn-sm"
            disabled={chapterIndex === 0}
            onClick={() => {
              setDirection(-1);
              setChapterIndex((i) => i - 1);
            }}
          >
            前の章
          </button>
          <strong>{chapter.title || '(無題)'}</strong>
          <button
            className="btn btn-sm"
            disabled={chapterIndex === chapters.length - 1}
            onClick={() => {
              setDirection(1);
              setChapterIndex((i) => i + 1);
            }}
          >
            次の章
          </button>
        </div>
        <div className="spacer" />
        <span className="hint" style={{ margin: 0 }}>
          {pages ? `${pageIndex + 1} / ${pages.length}ページ` : ''}
        </span>
      </div>

      <div className="reader-stage">
        <button
          className="reader-tap-zone reader-tap-left"
          aria-label="前のページ"
          onClick={goPrev}
          disabled={!hasPrevPage}
        />
        <div className="reader-page-box" ref={boxRef}>
          <div aria-hidden className="reader-measure">
            <div
              className="reader-text"
              ref={measureRef}
              style={boxSize ? { height: boxSize.h } : undefined}
            />
          </div>
          <AnimatePresence custom={direction} initial={false}>
            {pages && (
              <motion.div
                key={`${chapterIndex}-${pageIndex}`}
                className="reader-text reader-text-visible"
                custom={direction}
                variants={pageVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.7}
                onDragEnd={handleDragEnd}
                dangerouslySetInnerHTML={{ __html: readableToHtml(pages[pageIndex] ?? '') }}
              />
            )}
          </AnimatePresence>
        </div>
        <button
          className="reader-tap-zone reader-tap-right"
          aria-label="次のページ"
          onClick={goNext}
          disabled={!hasNextPage}
        />
      </div>

      <div className="reader-footer">
        <button className="btn btn-sm" onClick={goPrev} disabled={!hasPrevPage}>
          ← 前のページ
        </button>
        <span className="hint" style={{ margin: 0 }}>
          左右にスワイプ、または左右の余白をタップしてページをめくれます
        </span>
        <button className="btn btn-sm" onClick={goNext} disabled={!hasNextPage}>
          次のページ →
        </button>
      </div>
    </div>
  );
}
