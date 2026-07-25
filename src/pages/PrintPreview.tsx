import { useParams, Link } from 'react-router-dom';
import { useNovel } from '../lib/useNovel';
import { contentToParagraphs } from '../lib/htmlContent';
import { TRIM_SIZES } from '../lib/trimSizes';

export default function PrintPreview() {
  const { id } = useParams();
  const { novel } = useNovel(id);

  if (novel === undefined) return <div className="page">読み込み中…</div>;
  if (novel === null) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  const trim = TRIM_SIZES[novel.trimSize];
  const chapters = [...novel.chapters].sort((a, b) => a.order - b.order);
  const isFixed = trim.widthIn > 0;

  return (
    <div className="print-preview">
      <style>{`
        .print-toolbar {
          position: sticky; top: 0; z-index: 20;
          display: flex; gap: 10px; align-items: center;
          padding: 12px 20px; background: var(--bg-panel);
          border-bottom: 1px solid var(--border);
        }
        .print-page {
          background: white;
          color: #111;
          margin: 24px auto;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          padding: ${isFixed ? '0.85in 0.75in' : '1in 1.2in'};
          font-family: 'Hiragino Mincho ProN', 'Yu Mincho', serif;
          line-height: 2;
          font-size: 13pt;
          ${isFixed ? `width: ${trim.widthIn}in; min-height: ${trim.heightIn}in;` : 'max-width: 760px;'}
        }
        .print-page p { margin: 0; text-indent: 1em; }
        .print-page p.scene-break { text-align: center; text-indent: 0; margin: 1.5em 0; }
        .print-page h1.book-title { text-align: center; margin-top: 30%; font-size: 22pt; }
        .print-page p.author { text-align: center; margin-top: 2em; }
        .print-page h1.chapter-title { text-align: center; margin: 2em 0 2.5em; font-size: 16pt; break-before: page; }
        @media print {
          .print-toolbar { display: none; }
          .print-page { box-shadow: none; margin: 0; }
          @page { size: ${isFixed ? `${trim.widthIn}in ${trim.heightIn}in` : 'auto'}; margin: 0.75in; }
        }
      `}</style>
      <div className="print-toolbar">
        <Link to={`/novel/${novel.id}/export`} className="btn btn-sm">
          ← 出版準備に戻る
        </Link>
        <strong>印刷プレビュー（{trim.label}）</strong>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          印刷 / PDFとして保存
        </button>
      </div>

      <div className="print-page">
        <h1 className="book-title">{novel.title || '無題の小説'}</h1>
        {(novel.author || novel.penName) && (
          <p className="author">{novel.author || novel.penName}</p>
        )}
      </div>

      {chapters.map((ch, i) => (
        <div className="print-page" key={ch.id}>
          <h1 className="chapter-title">{ch.title || `第${i + 1}章`}</h1>
          {contentToParagraphs(ch.content).map((html, j) => (
            <p
              key={j}
              className={html.includes('scene-break') ? 'scene-break' : undefined}
              dangerouslySetInnerHTML={{
                __html: html.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, ''),
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
