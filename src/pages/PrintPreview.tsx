import { useParams, Link } from 'react-router-dom';
import { useNovel } from '../lib/useNovel';
import { contentToParagraphs } from '../lib/htmlContent';
import { TRIM_SIZES } from '../lib/trimSizes';
import CoverCanvas from '../components/CoverCanvas';
import IllustrationCanvas from '../components/IllustrationCanvas';

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
  const showIllustrations = novel.illustrationsEnabled;

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
        .print-page.cover-page { padding: 0; overflow: hidden; }
        .print-page p { margin: 0; text-indent: 1em; }
        .print-page p.scene-break { text-align: center; text-indent: 0; margin: 1.5em 0; }
        .print-page h1.book-title { text-align: center; margin-top: 30%; font-size: 22pt; }
        .print-page p.author { text-align: center; margin-top: 2em; }
        .print-page h1.toc-title { text-align: center; margin: 0 0 1.5em; font-size: 18pt; }
        .print-page ol.toc-list { list-style: none; padding: 0; margin: 0; font-size: 13pt; }
        .print-page ol.toc-list li { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 0.9em; text-indent: 0; }
        .print-page .illust-banner { margin: -0.1in -0.05in 1.5em; border-radius: 4px; overflow: hidden; }
        .print-page h1.chapter-title { text-align: center; margin: 1.2em 0 2em; font-size: 16pt; break-before: page; }
        .print-page .illust-banner + h1.chapter-title { break-before: avoid; margin-top: 0; }
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

      {showIllustrations ? (
        <div className="print-page cover-page">
          <div style={{ width: '100%', aspectRatio: '5 / 8' }}>
            <CoverCanvas novel={novel} width={1000} height={1600} />
          </div>
        </div>
      ) : (
        <div className="print-page">
          <h1 className="book-title">{novel.title || '無題の小説'}</h1>
          {(novel.author || novel.penName) && (
            <p className="author">{novel.author || novel.penName}</p>
          )}
        </div>
      )}

      <div className="print-page">
        <h1 className="toc-title">目次</h1>
        <ol className="toc-list">
          {chapters.map((ch, i) => (
            <li key={ch.id}>
              <span>{ch.title || `第${i + 1}章`}</span>
            </li>
          ))}
        </ol>
      </div>

      {chapters.map((ch, i) => {
        const chapterTitle = ch.title || `第${i + 1}章`;
        return (
          <div className="print-page" key={ch.id}>
            {showIllustrations && (
              <div className="illust-banner" style={{ width: '100%', aspectRatio: '12 / 5' }}>
                <IllustrationCanvas
                  novel={novel}
                  chapterTitle={chapterTitle}
                  index={i}
                  width={1200}
                  height={500}
                />
              </div>
            )}
            <h1 className="chapter-title">{chapterTitle}</h1>
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
        );
      })}
    </div>
  );
}
