import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWork } from '../useWork';
import { NotFound } from '../components/Chrome';
import { CloseIcon } from '../components/Icons';
import { toReadableText, paginateVertical, readableToHtml } from '../../lib/paginate';
import { parseImageLine } from '../../lib/blockContent';
import { listImages, type WorkImage } from '../images';

type ReaderPage = { type: 'text'; text: string } | { type: 'image'; id: string };

/** 本文を「文章のかたまり」と「挿絵」に切り分ける。 */
function splitByImages(content: string): ({ text: string } | { imageId: string })[] {
  const parts: ({ text: string } | { imageId: string })[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      parts.push({ text: buffer.join('\n') });
      buffer = [];
    }
  };
  for (const line of content.split(/\r?\n/)) {
    const imageId = parseImageLine(line);
    if (imageId) {
      flush();
      parts.push({ imageId });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return parts;
}

/**
 * 縦書きのページ送りで読む画面。
 * 実際の文字幅を測ってページを割るので、ルビが入っても行が崩れない。
 * 挿絵は本の挿絵と同じように、1枚で1ページを使う。
 */
export default function Read() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { work } = useWork(id);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState<ReaderPage[] | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [imageUrls, setImageUrls] = useState<Map<string, WorkImage & { url: string }>>(
    new Map()
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const chapters = useMemo(
    () => (work ? [...work.chapters].sort((a, b) => a.order - b.order) : []),
    [work]
  );

  // 挿絵を読み込み、表示用のURLを用意する（画面を離れるときに解放する）
  useEffect(() => {
    if (!id) return;
    let revoked = false;
    const urls: string[] = [];
    listImages(id).then((images) => {
      if (revoked) return;
      const map = new Map<string, WorkImage & { url: string }>();
      for (const image of images) {
        const url = URL.createObjectURL(image.blob);
        urls.push(url);
        map.set(image.id, { ...image, url });
      }
      setImageUrls(map);
    });
    return () => {
      revoked = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [id]);

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
    const built: ReaderPage[] = [];
    for (const part of splitByImages(chapter.content)) {
      if ('imageId' in part) {
        built.push({ type: 'image', id: part.imageId });
        continue;
      }
      if (part.text.trim() === '') continue;
      for (const text of paginateVertical(
        measureRef.current,
        toReadableText(part.text),
        box.w
      )) {
        built.push({ type: 'text', text });
      }
    }
    const result = built.length > 0 ? built : [{ type: 'text' as const, text: '' }];
    setPages(result);
    setPageIndex((p) => Math.min(p, result.length - 1));
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

  const current = pages?.[pageIndex];
  const currentImage =
    current && current.type === 'image' ? imageUrls.get(current.id) : undefined;

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

        {current?.type === 'image' ? (
          <figure className="vpage-image">
            {currentImage ? (
              <>
                <img src={currentImage.url} alt={currentImage.caption || '挿絵'} />
                {currentImage.caption && <figcaption>{currentImage.caption}</figcaption>}
              </>
            ) : (
              <figcaption>（画像が見つかりません）</figcaption>
            )}
          </figure>
        ) : (
          <div
            className="vtext"
            dangerouslySetInnerHTML={{ __html: readableToHtml(current?.text ?? '') }}
          />
        )}
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
