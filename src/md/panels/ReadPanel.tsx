import { useEffect, useRef, useState } from 'react';
import type { Book } from '../book';
import { renderBlocks, renderSpans } from '../render';

interface Props {
  book: Book;
}

/** できあがった本を、そのままの組み方（縦書き・右から左）で読む。 */
export default function ReadPanel({ book }: Props) {
  const [index, setIndex] = useState(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const chapter = book.chapters[Math.min(index, book.chapters.length - 1)];
  const vertical = book.options.vertical;

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // 縦書きは右端が先頭なので、章を変えたら右端へ戻す
    view.scrollLeft = vertical ? view.scrollWidth : 0;
    view.scrollTop = 0;
  }, [index, vertical]);

  return (
    <div className="card">
      <div className="reader-nav">
        <button
          className="btn ghost"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="前の章"
        >
          ‹
        </button>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {book.chapters.map((ch, i) => (
            <option key={ch.id} value={i}>
              {i + 1}. {ch.title}
            </option>
          ))}
        </select>
        <button
          className="btn ghost"
          onClick={() => setIndex((i) => Math.min(book.chapters.length - 1, i + 1))}
          disabled={index >= book.chapters.length - 1}
          aria-label="次の章"
        >
          ›
        </button>
      </div>

      <div className={`book-view${vertical ? ' vertical' : ''}`} ref={viewRef}>
        <h1 className="chapter-head">{chapter.title}</h1>
        {renderBlocks(chapter.blocks, {
          onJump: (chapterIndex) => setIndex(chapterIndex),
        })}
        {chapter.footnotes.length > 0 && (
          <div className="notes">
            {chapter.footnotes.map((note) => (
              <p key={note.id} id={`fn-${note.index}`}>
                [{note.index}]{' '}
                {note.blocks.map((block, i) =>
                  block.type === 'paragraph' ? (
                    <span key={i}>{renderSpans(block.children)}</span>
                  ) : null
                )}
              </p>
            ))}
          </div>
        )}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        {vertical
          ? '右から左へ読み進みます。横に滑らせてください。'
          : '横書きで組んでいます。'}
        この見た目が、そのままEPUBの組み方になります。
      </p>
    </div>
  );
}
