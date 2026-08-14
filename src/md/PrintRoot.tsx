import type { Book } from './book';
import { renderBlocks, renderSpans } from './render';

interface Props {
  book: Book;
  coverDataUrl: string | null;
}

/**
 * 印刷（PDF保存）用の紙面。画面には出さず、印刷のときだけ現れる。
 * ブラウザの「PDFとして保存」で、そのまま配布できるPDFになる。
 */
export default function PrintRoot({ book, coverDataUrl }: Props) {
  return (
    <div className={`print-root${book.options.vertical ? ' vertical' : ''}`}>
      {coverDataUrl && (
        <div className="print-chapter cover-page">
          <img src={coverDataUrl} alt="" />
        </div>
      )}
      <div className="print-chapter">
        <h1>{book.meta.title}</h1>
        {book.meta.subtitle && <p>{book.meta.subtitle}</p>}
        {book.meta.author && <p>{book.meta.author}</p>}
      </div>
      <div className="print-chapter">
        <h1>目次</h1>
        <ol>
          {book.chapters.map((chapter) => (
            <li key={chapter.id}>{chapter.title}</li>
          ))}
        </ol>
      </div>
      {book.chapters.map((chapter) => (
        <div className="print-chapter" key={chapter.id}>
          <h1>{chapter.title}</h1>
          {renderBlocks(chapter.blocks)}
          {chapter.footnotes.length > 0 && (
            <div className="notes">
              {chapter.footnotes.map((note) => (
                <p key={note.id}>
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
      ))}
    </div>
  );
}
