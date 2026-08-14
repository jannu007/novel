/**
 * 読書画面。
 *
 * 市販の電子書籍に近づけるため、次のようにしている。
 * - 本文は実際に組んでからページに割る（行が境目で切れない）
 * - **左から右へのスワイプで次のページ**（縦書きの本と同じ向き）。指の動きに
 *   紙が付いてきて、離した瞬間にページが決まる。
 * - 章の題・ページ番号・残りページ・全体の進み具合をいつでも確認できる
 * - 読んでいた場所は自動で覚え、字の大きさを変えても同じ場所に戻る
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildBook } from '../book';
import { inlineText } from '../markdown';
import { RenderBlocks } from '../render';
import { layoutFlow, pageMetrics, type PageLayout } from '../paginate';
import { loadBook, saveBook, type BookRecord, type Bookmark } from '../db';
import {
  FONT_LABEL,
  LEADING_RANGE,
  MARGIN_PX,
  PALETTE_LABEL,
  SIZE_RANGE,
  useSettings,
  type Palette,
} from '../settings';
import Sheet from '../components/Sheet';
import { BackIcon, BookmarkIcon, SearchIcon, TocIcon } from '../components/Icons';

/** これだけ指を動かせばページが変わる（画面幅に対する割合と、最低限の距離）。 */
const SWIPE_RATIO = 0.16;
const SWIPE_MIN = 44;
/** すばやく払ったときは、距離が短くてもページを送る。 */
const FLICK_SPEED = 0.45;

type SheetKind = null | 'toc' | 'settings' | 'search' | 'marks';

/** 「組み直したら、その章の最後のページを開く」という目印。 */
const LAST_PAGE = -1;

export default function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, update } = useSettings();

  const [record, setRecord] = useState<BookRecord | null | undefined>(undefined);
  const [chapter, setChapter] = useState(0);
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState<{ chapter: number; block: number } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const moved = useRef(false);
  /** 設定変更などで組み直すとき、いま読んでいた場所（ブロック番号）を保つ */
  const keepBlock = useRef<number | null>(null);
  /** その場所が、かたまりの先頭から何ページ目だったか */
  const keepOffset = useRef(0);

  const book = useMemo(
    () => (record ? buildBook(record.source, record.title) : null),
    [record]
  );
  const chapters = book?.chapters ?? [];
  const current = chapters[chapter];

  /* ---------------- 読み込み ---------------- */

  useEffect(() => {
    let alive = true;
    if (!id) return;
    loadBook(id).then((found) => {
      if (!alive) return;
      setRecord(found ?? null);
      if (found?.position) {
        setChapter(found.position.chapter);
        keepBlock.current = found.position.block;
        keepOffset.current = found.position.offset ?? 0;
      }
    });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (record?.title) document.title = `${record.title} | 栞`;
  }, [record?.title]);

  /* ---------------- 版面の大きさ ---------------- */

  const lineHeight = Math.round(settings.size * settings.leading);
  const pad = MARGIN_PX[settings.margin];
  const gap = 48;

  const metrics = useMemo(() => {
    if (!stage) return null;
    return pageMetrics(stage.w, stage.h, lineHeight, settings.vertical, gap);
  }, [stage, lineHeight, settings.vertical]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStage((prev) => {
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        return prev && prev.w === w && prev.h === h ? prev : { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [record]);

  /* ---------------- ページ割り ---------------- */

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || !metrics || !current) return;
    // フォントが切り替わってから測るため、描画の直後に一度だけ計算する
    const handle = requestAnimationFrame(() => {
      const result = layoutFlow(flow, {
        vertical: settings.vertical,
        pageWidth: metrics.pageWidth,
        step: metrics.step,
      });
      setLayout(result);
      const keep = keepBlock.current;
      const offset = keepOffset.current;
      keepBlock.current = null;
      keepOffset.current = 0;
      if (keep === null) setPage((prev) => Math.min(prev, result.pages - 1));
      else if (keep === LAST_PAGE) setPage(result.pages - 1);
      else {
        // 長い段落は何ページにもまたがるので、かたまりの先頭からの
        // ページ数も足して、読んでいた場所そのものに戻す
        const start = result.blockPages[keep] ?? 0;
        setPage(Math.max(0, Math.min(result.pages - 1, start + offset)));
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [metrics, current, settings.vertical, settings.size, settings.leading, settings.font]);

  /** 組み直しの前に、いま読んでいる場所（かたまりと、その中の何ページ目か）を覚えておく。 */
  const rememberBlock = useCallback(() => {
    if (!layout) return;
    const block = blockAtPage(layout, page);
    keepBlock.current = block;
    keepOffset.current = page - (layout.blockPages[block] ?? 0);
  }, [layout, page]);

  const pages = layout?.pages ?? 1;

  /* ---------------- ページ移動 ---------------- */

  const go = useCallback(
    (delta: number) => {
      const next = page + delta;
      if (next >= 0 && next < pages) {
        setAnimating(true);
        setPage(next);
        return;
      }
      if (next < 0 && chapter > 0) {
        // 前の章へ。組み直したあと、その章の最後のページを開く。
        keepBlock.current = LAST_PAGE;
        setChapter(chapter - 1);
        return;
      }
      if (next >= pages && chapter < chapters.length - 1) {
        keepBlock.current = 0;
        setChapter(chapter + 1);
        setPage(0);
      }
    },
    [page, pages, chapter, chapters.length]
  );

  const jumpTo = useCallback(
    (target: { chapter: number; block?: number; anchor?: string }) => {
      setSheet(null);
      if (target.chapter !== chapter) {
        setChapter(target.chapter);
        keepBlock.current = target.block ?? 0;
        if (target.anchor) pendingAnchor.current = target.anchor;
        setPage(0);
        return;
      }
      if (target.anchor && layout) {
        const p = layout.anchors.get(target.anchor);
        if (p !== undefined) setPage(p);
        return;
      }
      if (target.block !== undefined && layout) {
        setPage(Math.min(layout.pages - 1, layout.blockPages[target.block] ?? 0));
      }
    },
    [chapter, layout]
  );

  const pendingAnchor = useRef<string | null>(null);
  useEffect(() => {
    if (!layout || !pendingAnchor.current) return;
    const p = layout.anchors.get(pendingAnchor.current);
    pendingAnchor.current = null;
    if (p !== undefined) setPage(p);
  }, [layout]);

  /** 本の中のリンク（#見出し）を押したとき。 */
  const onJump = useCallback(
    (anchor: string) => {
      if (!book) return;
      const target = book.chapterOfId.get(anchor);
      if (target === undefined) return;
      jumpTo({ chapter: target, anchor });
    },
    [book, jumpTo]
  );

  /* ---------------- 読書位置の記録 ---------------- */

  useEffect(() => {
    if (!record || !layout) return;
    const block = blockAtPage(layout, page);
    const offset = page - (layout.blockPages[block] ?? 0);
    const ratio =
      (chapter + (layout.pages > 1 ? page / (layout.pages - 1) : 1)) /
      Math.max(1, chapters.length);
    const timer = setTimeout(() => {
      const next: BookRecord = {
        ...record,
        openedAt: Date.now(),
        position: { chapter, block, offset, ratio: Math.min(1, ratio), at: Date.now() },
      };
      saveBook(next).catch(() => {
        /* 保存できなくても読書は続けられる */
      });
    }, 600);
    return () => clearTimeout(timer);
    // record自体を依存に入れると保存のたびに再実行されるので、位置だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, page, layout]);

  /* ---------------- 指・キーの操作 ---------------- */

  // 縦書きは左から右へなぞると次のページ、横書きはその逆
  const forwardSign = settings.vertical ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // ブラウザ既定の「文字をつかんで動かす」動作を止め、ページめくりを優先する
    if (e.pointerType === 'mouse') e.preventDefault();
    pointer.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    moved.current = false;
    setAnimating(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = pointer.current;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!moved.current && Math.abs(dx) < 8) {
      if (Math.abs(dy) > 16) pointer.current = null; // 縦の動きは無視する
      return;
    }
    moved.current = true;
    // 端では引っぱりを重くして、これ以上進めないことを手ざわりで伝える
    const atEdge =
      (dx * forwardSign > 0 && page >= pages - 1 && chapter >= chapters.length - 1) ||
      (dx * forwardSign < 0 && page <= 0 && chapter <= 0);
    setDrag(atEdge ? dx * 0.28 : dx);
  };

  const finishDrag = (e: React.PointerEvent) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || !moved.current) {
      setDrag(0);
      return;
    }
    const dx = e.clientX - start.x;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - start.t);
    const threshold = Math.max(SWIPE_MIN, (stage?.w ?? 320) * SWIPE_RATIO);
    setDrag(0);
    setAnimating(true);
    if (Math.abs(dx) > threshold || speed > FLICK_SPEED) {
      go(dx * forwardSign > 0 ? 1 : -1);
    }
  };

  const onTap = (e: React.MouseEvent) => {
    if (moved.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.34) go(forwardSign > 0 ? 1 : -1);
    else if (x > 0.66) go(forwardSign > 0 ? -1 : 1);
    else setChrome((v) => !v);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowLeft':
          go(settings.vertical ? -1 : 1);
          break;
        case 'ArrowRight':
          go(settings.vertical ? 1 : -1);
          break;
        case ' ':
        case 'PageDown':
          e.preventDefault();
          go(1);
          break;
        case 'PageUp':
          e.preventDefault();
          go(-1);
          break;
        case 'Home':
          setPage(0);
          break;
        case 'End':
          setPage(pages - 1);
          break;
        case 'Escape':
          navigate('/');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, pages, sheet, settings.vertical, navigate]);

  /* ---------------- しおり ---------------- */

  const currentBlock = useMemo(
    () => (layout ? blockAtPage(layout, page) : 0),
    [layout, page]
  );

  const marked = record?.bookmarks.some(
    (b) => b.chapter === chapter && b.block === currentBlock
  );

  const toggleBookmark = () => {
    if (!record || !current) return;
    const exists = record.bookmarks.find(
      (b) => b.chapter === chapter && b.block === currentBlock
    );
    const bookmarks = exists
      ? record.bookmarks.filter((b) => b.id !== exists.id)
      : [
          ...record.bookmarks,
          {
            id: `${Date.now().toString(36)}-${chapter}-${currentBlock}`,
            chapter,
            block: currentBlock,
            excerpt: excerptOf(current.blocks[currentBlock]),
            at: Date.now(),
          } satisfies Bookmark,
        ];
    const next = { ...record, bookmarks };
    setRecord(next);
    saveBook(next).catch(() => {});
  };

  /* ---------------- 検索 ---------------- */

  const results = useMemo(() => {
    const q = query.trim();
    if (!book || q.length === 0) return [];
    const out: { chapter: number; block: number; text: string; title: string }[] = [];
    const needle = q.toLowerCase();
    for (let c = 0; c < book.chapters.length && out.length < 80; c++) {
      const ch = book.chapters[c];
      for (let b = 0; b < ch.blocks.length && out.length < 80; b++) {
        const text = excerptOf(ch.blocks[b], 400);
        const at = text.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        out.push({
          chapter: c,
          block: b,
          text: text.slice(Math.max(0, at - 24), at + q.length + 40),
          title: ch.title || `第${c + 1}章`,
        });
      }
    }
    return out;
  }, [book, query]);

  /* ---------------- 表示 ---------------- */

  if (record === undefined) return <div className="loading">読み込み中…</div>;
  if (record === null || !book || !current) {
    return (
      <div className="loading">
        <p>本が見つかりませんでした。</p>
        <button className="btn" onClick={() => navigate('/')}>
          本棚へ戻る
        </button>
      </div>
    );
  }

  const totalPages = chapters.length;
  const progress =
    (chapter + (pages > 1 ? page / (pages - 1 || 1) : 1)) / Math.max(1, totalPages);
  const offset = (settings.vertical ? page * (metrics?.step ?? 0) : -page * (metrics?.step ?? 0)) + drag;

  return (
    <div className={`reader font-${settings.font} ${settings.vertical ? 'v' : 'h'}`}>
      <header className={`reader-bar${chrome ? '' : ' hidden'}`}>
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="本棚へ戻る">
          <BackIcon />
        </button>
        <div className="reader-title">
          <strong>{record.title}</strong>
          <span>{current.title || `第${chapter + 1}章`}</span>
        </div>
        <button
          className={`icon-btn${marked ? ' on' : ''}`}
          onClick={toggleBookmark}
          aria-label={marked ? 'しおりを外す' : 'しおりを挟む'}
        >
          <BookmarkIcon filled={marked} />
        </button>
        <button className="icon-btn" onClick={() => setSheet('toc')} aria-label="目次">
          <TocIcon />
        </button>
        <button className="icon-btn" onClick={() => setSheet('search')} aria-label="本文を検索">
          <SearchIcon />
        </button>
        <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="読み方の設定">
          <span className="aa">あ</span>
        </button>
      </header>

      <div
        className="stage"
        ref={stageRef}
        // 上下は操作パネルのぶんを空けておく。パネルが隠れても本文が動かない。
        style={{ padding: `${pad + 46}px ${pad}px ${pad + 42}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={() => {
          pointer.current = null;
          setDrag(0);
        }}
        onClick={onTap}
      >
        <div className="stage-inner">
          {metrics && (
            <div
              className={`flow-clip${animating && settings.animate && drag === 0 ? ' anim' : ''}`}
              style={{ transform: `translateX(${offset}px)` }}
              onTransitionEnd={() => setAnimating(false)}
            >
              <div
                className="flow"
                ref={flowRef}
                style={
                  settings.vertical
                    ? {
                        height: metrics.pageHeight,
                        right: metrics.offset,
                        fontSize: settings.size,
                        lineHeight: `${lineHeight}px`,
                        ['--u' as string]: `${lineHeight}px`,
                      }
                    : {
                        height: metrics.pageHeight,
                        width: metrics.pageWidth,
                        columnWidth: metrics.pageWidth,
                        columnGap: gap,
                        fontSize: settings.size,
                        lineHeight: `${lineHeight}px`,
                        ['--u' as string]: `${lineHeight}px`,
                      }
                }
              >
                <RenderBlocks
                  blocks={current.blocks}
                  onJump={onJump}
                  highlight={hit && hit.chapter === chapter ? hit.block : undefined}
                />
                <div className="md-end" aria-hidden />
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className={`reader-foot${chrome ? '' : ' hidden'}`}>
        <div className="bar">
          <span
            className="bar-fill"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
        <div className="foot-row">
          <span>
            {page + 1} / {pages}ページ
          </span>
          <span className="foot-hint">
            {settings.vertical ? '左から右へなぞると次のページ' : '右から左へなぞると次のページ'}
          </span>
          <span>
            {pages - page - 1 > 0
              ? `この章はあと${pages - page - 1}ページ`
              : chapter < chapters.length - 1
                ? '次の章へ'
                : '読了'}
          </span>
        </div>
      </footer>

      {/* ---- 目次 ---- */}
      <Sheet open={sheet === 'toc'} title="目次" onClose={() => setSheet(null)}>
        <ol className="toc">
          {book.toc.length === 0 && <li className="muted">見出しのない本です</li>}
          {book.toc.map((entry, i) => (
            <li key={i} className={`toc-l${Math.min(entry.level, 4)}`}>
              <button
                className={`toc-item${entry.chapter === chapter ? ' on' : ''}`}
                onClick={() => jumpTo({ chapter: entry.chapter, anchor: entry.id })}
              >
                {entry.title || '（無題）'}
              </button>
            </li>
          ))}
        </ol>
        <div className="sheet-sub">
          <button className="btn btn-ghost" onClick={() => setSheet('marks')}>
            しおりの一覧（{record.bookmarks.length}）
          </button>
        </div>
      </Sheet>

      {/* ---- しおり ---- */}
      <Sheet open={sheet === 'marks'} title="しおり" onClose={() => setSheet(null)}>
        {record.bookmarks.length === 0 && <p className="muted">まだしおりはありません。</p>}
        <ul className="marks">
          {[...record.bookmarks]
            .sort((a, b) => a.chapter - b.chapter || a.block - b.block)
            .map((mark) => (
              <li key={mark.id}>
                <button
                  className="mark-item"
                  onClick={() => jumpTo({ chapter: mark.chapter, block: mark.block })}
                >
                  <strong>
                    {book.chapters[mark.chapter]?.title || `第${mark.chapter + 1}章`}
                  </strong>
                  <span>{mark.excerpt}</span>
                </button>
              </li>
            ))}
        </ul>
      </Sheet>

      {/* ---- 検索 ---- */}
      <Sheet open={sheet === 'search'} title="本文を検索" onClose={() => setSheet(null)}>
        <input
          className="input"
          autoFocus
          value={query}
          placeholder="探したい言葉"
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="muted">
          {query.trim() ? `${results.length}件${results.length >= 80 ? '以上' : ''}` : ''}
        </p>
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}>
              <button
                className="result-item"
                onClick={() => {
                  setHit({ chapter: r.chapter, block: r.block });
                  jumpTo({ chapter: r.chapter, block: r.block });
                }}
              >
                <strong>{r.title}</strong>
                <span>…{r.text}…</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {/* ---- 設定 ---- */}
      <Sheet open={sheet === 'settings'} title="読み方" onClose={() => setSheet(null)}>
        <div className="set-row">
          <span>組み方</span>
          <div className="seg">
            <button
              className={settings.vertical ? 'on' : ''}
              onClick={() => {
                rememberBlock();
                update({ vertical: true });
              }}
            >
              縦書き
            </button>
            <button
              className={!settings.vertical ? 'on' : ''}
              onClick={() => {
                rememberBlock();
                update({ vertical: false });
              }}
            >
              横書き
            </button>
          </div>
        </div>

        <div className="set-row">
          <span>書体</span>
          <div className="seg">
            {(['mincho', 'gothic'] as const).map((f) => (
              <button
                key={f}
                className={settings.font === f ? 'on' : ''}
                onClick={() => {
                  rememberBlock();
                  update({ font: f });
                }}
              >
                {FONT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span>字の大きさ</span>
          <div className="stepper">
            <button
              onClick={() => {
                rememberBlock();
                update({ size: settings.size - 1 });
              }}
              disabled={settings.size <= SIZE_RANGE.min}
              aria-label="小さく"
            >
              小
            </button>
            <em>{settings.size}</em>
            <button
              onClick={() => {
                rememberBlock();
                update({ size: settings.size + 1 });
              }}
              disabled={settings.size >= SIZE_RANGE.max}
              aria-label="大きく"
            >
              大
            </button>
          </div>
        </div>

        <div className="set-row">
          <span>行の間</span>
          <div className="stepper">
            <button
              onClick={() => {
                rememberBlock();
                update({ leading: Math.round((settings.leading - 0.1) * 10) / 10 });
              }}
              disabled={settings.leading <= LEADING_RANGE.min}
            >
              狭
            </button>
            <em>{settings.leading.toFixed(1)}</em>
            <button
              onClick={() => {
                rememberBlock();
                update({ leading: Math.round((settings.leading + 0.1) * 10) / 10 });
              }}
              disabled={settings.leading >= LEADING_RANGE.max}
            >
              広
            </button>
          </div>
        </div>

        <div className="set-row">
          <span>余白</span>
          <div className="seg">
            {(['narrow', 'normal', 'wide'] as const).map((m) => (
              <button
                key={m}
                className={settings.margin === m ? 'on' : ''}
                onClick={() => {
                  rememberBlock();
                  update({ margin: m });
                }}
              >
                {m === 'narrow' ? '狭い' : m === 'normal' ? '標準' : '広い'}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span>配色</span>
          <div className="seg">
            {(['auto', 'paper', 'sepia', 'night'] as Palette[]).map((p) => (
              <button
                key={p}
                className={settings.palette === p ? 'on' : ''}
                onClick={() => update({ palette: p })}
              >
                {PALETTE_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span>ページの動き</span>
          <div className="seg">
            <button className={settings.animate ? 'on' : ''} onClick={() => update({ animate: true })}>
              あり
            </button>
            <button className={!settings.animate ? 'on' : ''} onClick={() => update({ animate: false })}>
              なし
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/**
 * いま開いているページの先頭にある「かたまり」を返す。
 * 長い段落は何ページにもまたがるので、`>=` ではなく
 * 「そのページまでに始まっている最後のかたまり」を選ぶ。
 */
function blockAtPage(layout: PageLayout, page: number): number {
  let found = 0;
  for (let i = 0; i < layout.blockPages.length; i++) {
    if (layout.blockPages[i] <= page) found = i;
    else break;
  }
  return found;
}

/** ブロックから、しおり・検索の一覧に見せる文字を取り出す。 */
function excerptOf(block: import('../markdown').Block | undefined, limit = 60): string {
  if (!block) return '';
  let text = '';
  switch (block.type) {
    case 'paragraph':
      text = inlineText(block.children);
      break;
    case 'heading':
      text = block.plain;
      break;
    case 'code':
      text = block.code;
      break;
    case 'quote':
      text = block.children.map((b) => excerptOf(b, limit)).join(' ');
      break;
    case 'list':
      text = block.items.map((item) => item.map((b) => excerptOf(b, limit)).join(' ')).join(' / ');
      break;
    case 'table':
      text = block.head.map((c) => inlineText(c)).join(' | ');
      break;
    case 'figure':
      text = block.alt || '（挿絵）';
      break;
    default:
      text = '';
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}
