import { useMemo } from 'react';
import type { ParsedBook } from '../epub';
import { renderChapterBody } from '../render';

interface Props {
  book: ParsedBook;
  chapterIndex: number;
  onChapterChange: (index: number) => void;
  onClose: () => void;
}

export default function ReaderModal({ book, chapterIndex, onChapterChange, onClose }: Props) {
  const chapterIndexByPath = useMemo(() => {
    const map = new Map<string, number>();
    book.chapters.forEach((c, i) => map.set(c.path, i));
    return map;
  }, [book]);

  const chapter = book.chapters[chapterIndex];
  const body = useMemo(() => {
    if (!chapter) return null;
    return renderChapterBody(chapter, {
      basePath: chapter.path,
      images: book.images,
      chapterIndexByPath,
      onJump: onChapterChange,
    });
  }, [chapter, book.images, chapterIndexByPath, onChapterChange]);

  return (
    <div
      className="reader-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="reader-panel">
        <div className="reader-head">
          <select value={chapterIndex} onChange={(e) => onChapterChange(Number(e.target.value))}>
            {book.chapters.map((c, i) => (
              <option key={c.path} value={i}>
                {c.title}
              </option>
            ))}
          </select>
          <button className="reader-close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="reader-body">{body}</div>
      </div>
    </div>
  );
}
