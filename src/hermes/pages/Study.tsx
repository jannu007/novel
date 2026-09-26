/**
 * 推敲の画面。
 *
 * 読むところは栞と同じ考え方でできている。本文を実際に組んでから
 * 行の位置を測ってページに割るので、ページの境目で行が切れない。
 * 縦書きなら、紙の本と同じく**左から右へなぞると次のページ**。
 *
 * そのうえで、このアプリは読みながら原稿に手を入れられる。
 *   ・段を押す（または朱筆）→ その段の元の文が出てきて、直せる
 *   ・文字をなぞる           → そこに印を付けられる
 * 直すと本文は組み直しになるが、読んでいた場所は覚えておいて戻る。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildBook } from '../../read/book';
import { layoutFlow, pageMetrics, type PageLayout } from '../../read/paginate';
import { RenderBlocks } from '../render';
import Sheet from '../components/Sheet';
import {
  BackIcon,
  DownloadIcon,
  MarkIcon,
  PenIcon,
  SearchIcon,
  TocIcon,
  TrashIcon,
  UndoIcon,
} from '../components/Icons';
import {
  FONT_LABEL,
  LEADING_RANGE,
  MARGIN_PX,
  PALETTE_LABEL,
  SIZE_RANGE,
  useSettings,
  type Palette,
} from '../settings';
import {
  loadDraft,
  saveDraft,
  MARK_HINT,
  MARK_KINDS,
  MARK_LABEL,
  type DraftRecord,
  type Mark,
  type MarkKind,
} from '../db';
import {
  applyPlainEdit,
  excerptOf,
  marksByBlock,
  plainOf,
  reanchorAll,
  replaceBlock,
  sourceOfBlock,
  sourceRangeOf,
  type AnchoredMark,
} from '../draft';
import {
  clearSelection,
  offsetAtPoint,
  placeCaret,
  plainTextIn,
  readSelection,
  type BlockSelection,
} from '../selection';
import { downloadMarks, downloadSource } from '../import';

/** これだけ指を動かせばページが変わる（画面幅に対する割合と、最低限の距離）。 */
const SWIPE_RATIO = 0.16;
const SWIPE_MIN = 44;
/** すばやく払ったときは、距離が短くてもページを送る。 */
const FLICK_SPEED = 0.45;
/** この間に二度押されたら「二度押し」とみなす。 */
const DOUBLE_MS = 340;
/** 二度押しとみなす、指のずれの許し（px）。 */
const DOUBLE_SLOP = 28;

/** 「組み直したら、その章の最後のページを開く」という目印。 */
const LAST_PAGE = -1;

type SheetKind = null | 'toc' | 'settings' | 'search' | 'marks' | 'history' | 'mark';

export default function Study() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, update } = useSettings();

  const [record, setRecord] = useState<DraftRecord | null | undefined>(undefined);
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
  const [outLink, setOutLink] = useState<string | null>(null);

  /** 直している段（かたまりの番号）と、その元の文 */
  /**
   * いま直している段。
   *
   * 直すのは画面に出ている文字そのもの（`plain`）で、記法は見せない。
   * 見た目を変えずに直せるようにするため。書き戻すときに、直す前の文字と
   * 見くらべて「変わったところ」だけを元の文に反映する。
   *
   * どの章のものかも持つ。章をまたいで開くことがあり、そのとき画面側の
   * 「いまの章」はまだ切り替わっていないため。
   */
  const [editing, setEditing] = useState<{
    chapter: number;
    block: number;
    /** 直しはじめたときの、画面に出ていた文字 */
    plain: string;
  } | null>(null);
  /** 直したかどうか。直すまでは、確かめる帯を出さない。 */
  const [dirty, setDirty] = useState(false);
  /** 直すのをやめたとき、画面の文字を組み直すための数え札 */
  const [renderKey, setRenderKey] = useState(0);
  /**
   * いま選ばれているところ。ここに値があるあいだ、画面の上に小さなボタンを出す。
   *
   * 「選んでから押す」ではなく「選んだ時点で出す」ようにしている。
   * 画面を押した瞬間にブラウザが選択を捨ててしまうので、あとから
   * 押して拾おうとすると、その時にはもう何も選ばれていないため。
   */
  const [selAction, setSelAction] = useState<BlockSelection | null>(null);
  /** これから印を付けるところ */
  const [pending, setPending] = useState<BlockSelection | null>(null);
  const [pendingKind, setPendingKind] = useState<MarkKind>('fix');
  const [pendingNote, setPendingNote] = useState('');
  /** 開いている印（押して開いたもの） */
  const [openMark, setOpenMark] = useState<string | null>(null);
  const [markNote, setMarkNote] = useState('');
  /** 画面のすみに出す短い知らせ */
  const [toast, setToast] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const moved = useRef(false);
  /** 二度押しを見分けるための、一度目の押しの控え。 */
  const lastTap = useRef<{
    at: number;
    x: number;
    y: number;
    /** 押された段。段の上でなければ null */
    block: number | null;
    /** 押されたところが、その段の地の文の何文字目か */
    caret: number | null;
    chapter: number;
    /** 一度目に送ったページ数（二度押しなら、これを戻す） */
    turned: number;
    /** 一度目に操作パネルを出し入れしたか（同じく、戻す） */
    toggledChrome: boolean;
  } | null>(null);
  const keepBlock = useRef<number | null>(null);
  const keepOffset = useRef(0);
  const pendingAnchor = useRef<string | null>(null);
  /** 直しはじめた直後に、字を入れる印（カーソル）を置く位置 */
  const caretAt = useRef(0);
  /** 直している最中か（版面を測り直さないための目印） */
  const editingRef = useRef(false);
  /** 左右に送るあいだ、カーソルの場所を預かっておく */
  const heldCaret = useRef<Range | null>(null);
  /**
   * いちばん新しく測った版面の大きさ。
   * 直しているあいだは画面に反映しないが、測ること自体はやめない。
   * 直し終えたときに、そのときの本当の大きさへ戻せるようにするため。
   */
  const lastStage = useRef<{ w: number; h: number } | null>(null);
  /** 本文を上下に動かせるようにするための入れ物（直しているあいだだけ使う） */
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * 直しているあいだ、本文を左右にどれだけ送ったか。
   *
   * 上下はブラウザに任せられるが、左右はページ送りと同じ向きの動きなので
   * こちらで受け取る（`touch-action: pan-y` なので、上下はブラウザ、
   * 左右はこちら、と分かれて届く）。読んでいるあいだは使わない。
   */
  const [pan, setPan] = useState(0);

  const book = useMemo(
    () => (record ? buildBook(record.source, record.title) : null),
    [record]
  );
  const chapters = useMemo(() => book?.chapters ?? [], [book]);
  const current = chapters[chapter];

  /** 印を、いまの本文に合わせて貼り直したもの */
  const anchored = useMemo<AnchoredMark[]>(
    () => (book && record ? reanchorAll(book, record.marks) : []),
    [book, record]
  );
  const chapterMarks = useMemo(
    () => marksByBlock(anchored, chapter),
    [anchored, chapter]
  );

  /* ---------------- 読み込み ---------------- */

  useEffect(() => {
    let alive = true;
    if (!id) return;
    loadDraft(id).then((found) => {
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

  /*
   * 画面の題名（タブ名）に原稿の題名を入れない。
   * ここに入れた文字は閲覧履歴・タブの一覧・端末のアプリ切り替え画面に残り、
   * ブラウザの同期を使っていれば他の端末にも渡っていく。
   */
  useEffect(() => {
    document.title = 'ヘルメス';
  }, [id]);

  /*
   * 直しはじめたら、押したところに字を入れる印（カーソル）を立てる。
   *
   * 直す対象は組んだ文字そのものなので、置く先もその文字の中になる。
   * 何文字目かは分かっているので、地の文を数えながら同じ場所まで進み、
   * その字のところに印を置く。置けなければ段の先頭に置く（指で直せる）。
   */
  useEffect(() => {
    if (!editing) return;
    const el = flowRef.current?.querySelector<HTMLElement>(
      `.md-block[data-b="${editing.block}"]`
    );
    if (!el) return;
    el.focus({ preventScroll: true });
    const at = placeCaret(el, caretAt.current);
    if (!at) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } catch {
        /* 置けなくても、指で置き直せる */
      }
    }
    // キーボードが出そろうのを待ってから、隠れていないか見る
    const timer = window.setTimeout(followCaret, 260);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.block, editing?.chapter, renderKey]);

  /**
   * カーソルがキーボードに隠れていたら、見えるところまで本文を送る。
   *
   * 組み直すのではなく、本文の入れ物を上下に送るだけ。だから改行は動かない。
   * 送った先は指でも動かせる（直しているあいだ、この入れ物は上下に
   * スクロールできるようにしてある）。
   */
  const followCaret = useCallback(() => {
    if (!editingRef.current) return;
    const box = scrollRef.current;
    if (!box) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    let rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) {
      const block = flowRef.current?.querySelector('.md-block.editing');
      if (!block) return;
      rect = block.getBoundingClientRect();
    }
    const view = box.getBoundingClientRect();
    const margin = 28;
    if (rect.bottom > view.bottom - margin) {
      box.scrollTop += rect.bottom - (view.bottom - margin);
    } else if (rect.top < view.top + margin) {
      box.scrollTop -= view.top + margin - rect.top;
    }
  }, []);

  useEffect(() => {
    editingRef.current = Boolean(editing);
    if (editing) return;
    /*
     * 直し終えたら、ずらしを戻して、いちばん新しく測った大きさに合わせ直す。
     *
     * ここで自分で測り直してはいけない。`getBoundingClientRect` は余白まで
     * 含んだ外側の大きさを返すので、余白のぶんだけ版面が広がってしまい、
     * 本文が組み直されてページ数まで変わる（実際そうなった）。
     * 見張り役（ResizeObserver）が測っているのは中身の大きさなので、
     * その控えをそのまま使う。
     */
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setPan(0);
    const size = lastStage.current;
    if (!size) return;
    setStage((prev) => (prev && prev.w === size.w && prev.h === size.h ? prev : size));
  }, [editing]);

  /*
   * キーボードが出入りすると、見えている高さが変わる。
   * そのたびにカーソルを追いかけ直す。
   */
  useEffect(() => {
    if (!editing) return;
    const vv = window.visualViewport;
    const onResize = () => window.setTimeout(followCaret, 60);
    vv?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      vv?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, [editing, followCaret]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
      /*
       * 直しているあいだは測り直さない。
       *
       * 字を打ちはじめるとキーボードが出て、画面の枠がそのぶんだけ縮む。
       * そのまま測り直すと版面の高さが変わり、**本文が組み直されて改行の位置が
       * すっかり変わってしまう**。直している最中に紙面が別物になるので、
       * どこを直していたのか見失う。
       *
       * キーボードで隠れるぶんは、本文を上へずらして見せる（`caretShift`）。
       * 組み方はそのままなので、改行は原稿に忠実なまま。
       */
      const r = entries[0].contentRect;
      const size = { w: Math.round(r.width), h: Math.round(r.height) };
      lastStage.current = size;
      if (editingRef.current) return;
      setStage((prev) => (prev && prev.w === size.w && prev.h === size.h ? prev : size));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [record]);

  /* ---------------- ページ割り ---------------- */

  useLayoutEffect(() => {
    if (!metrics) return;
    const flow = flowRef.current;
    if (!flow || !current) return;
    // 書体が切り替わってから測るため、描画の直後に一度だけ計算する
    const handle = requestAnimationFrame(() => {
      const result = layoutFlow(flow, {
        vertical: settings.vertical,
        pageWidth: metrics.pageWidth,
        step: metrics.step,
        lineHeight,
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
  }, [
    metrics,
    current,
    chapter,
    settings.vertical,
    settings.font,
    settings.size,
    lineHeight,
    chapterMarks,
  ]);

  const pages = layout?.pages ?? 1;

  /** 組み直しの前に、いま読んでいる場所を覚えておく。 */
  const rememberBlock = useCallback(() => {
    if (!layout) return;
    const block = blockAtPage(layout, page);
    keepBlock.current = block;
    keepOffset.current = page - (layout.blockPages[block] ?? 0);
  }, [layout, page]);

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

  useEffect(() => {
    if (!layout || !pendingAnchor.current) return;
    const p = layout.anchors.get(pendingAnchor.current);
    pendingAnchor.current = null;
    if (p !== undefined) setPage(p);
  }, [layout]);

  const onJump = useCallback(
    (anchor: string) => {
      if (!book) return;
      const target = book.chapterOfId.get(anchor);
      if (target === undefined) return;
      jumpTo({ chapter: target, anchor });
    },
    [book, jumpTo]
  );

  /* ---------------- 読んでいた場所を覚える ---------------- */

  useEffect(() => {
    if (!record || !layout) return;
    const block = blockAtPage(layout, page);
    const offset = page - (layout.blockPages[block] ?? 0);
    const ratio =
      (chapter + (layout.pages > 1 ? page / (layout.pages - 1) : 1)) /
      Math.max(1, chapters.length);
    const timer = setTimeout(() => {
      saveDraft({
        ...record,
        openedAt: Date.now(),
        position: { chapter, block, offset, ratio: Math.min(1, ratio), at: Date.now() },
      }).catch(() => {
        /* 保存できなくても推敲は続けられる */
      });
    }, 600);
    return () => clearTimeout(timer);
    // record自体を依存に入れると保存のたびに再実行されるので、位置だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, page, layout]);

  /* ---------------- 直す ---------------- */

  const currentBlock = useMemo(
    () => (layout ? blockAtPage(layout, page) : 0),
    [layout, page]
  );

  /** その段の元の文を出して、直せるようにする。 */
  /**
   * その段を、本文の上でそのまま直せるようにする。
   *
   * 別の画面を開くのではなく、組んだ文字にぴったり重ねて書き込み欄を出す。
   * 読んでいた場所から目を離さずに直せるようにするため。
   * `caret` は、押したところに字を入れる印を置くための位置（地の文の何文字目か）。
   */
  const openEditor = useCallback(
    (block: number, atChapter: number = chapter, caret?: number | null) => {
      if (!record || !book) return;
      const target = chapters[atChapter]?.blocks[block];
      if (!target || sourceRangeOf(book, target) === null) {
        setToast('この段は直せません');
        return;
      }
      clearSelection();
      setSelAction(null);
      setEditing({ chapter: atChapter, block, plain: plainOf(target) });
      setDirty(false);
      setPan(0);
      caretAt.current = caret ?? 0;
      // 章が違うときだけ、その段のところへ移る（同じ章なら画面は動かさない）
      if (atChapter !== chapter) {
        setChapter(atChapter);
        keepBlock.current = block;
      }
    },
    [record, book, chapters, chapter]
  );

  /**
   * 直すのをやめる（書いたものは捨てる）。
   *
   * 画面の文字は人の手で書き換わっているが、こちらの控えは元のままなので、
   * 何もしないと直した字が残って見える。数え札を進めて組み直させる。
   */
  const cancelEditing = useCallback(() => {
    setEditing(null);
    setDirty(false);
    setRenderKey((n) => n + 1);
  }, []);

  /**
   * 直した内容を原稿に書き戻す。
   *
   * 人が直したのは画面の文字なので、まずそれを読み取り、直す前の文字と
   * 見くらべて「変わったところ」を出す。元の文はその範囲だけを差し替えるので、
   * 触っていないところのルビや強調はそのまま残る。
   */
  async function applyEdit() {
    if (!record || !book || !editing) return;
    const target = chapters[editing.chapter]?.blocks[editing.block];
    const el = flowRef.current?.querySelector<HTMLElement>(
      `.md-block[data-b="${editing.block}"]`
    );
    if (!target || !el) {
      cancelEditing();
      return;
    }
    const beforeSource = sourceOfBlock(record.source, book, target) ?? '';
    const afterPlain = plainTextIn(el);
    if (afterPlain === editing.plain) {
      cancelEditing();
      return;
    }
    const nextSource = applyPlainEdit(beforeSource, editing.plain, afterPlain);
    if (nextSource === null) {
      cancelEditing();
      return;
    }
    const next = replaceBlock(record.source, book, target, nextSource);
    if (next === null) {
      setToast('この段は直せません');
      return;
    }
    const before = beforeSource;
    const after = nextSource;
    const range = target?.lines
      ? { from: book.bodyLine + target.lines.from, to: book.bodyLine + target.lines.to }
      : { from: 0, to: 0 };
    /*
     * 印は本文の文字の位置で覚えているので、直すとずれる。
     * ここでは貼り直したものを保存しておく（見失った印も消さずに残す）。
     */
    const nextBook = buildBook(next, record.title);
    const marks: Mark[] = reanchorAll(nextBook, record.marks).map(
      ({ lost: _lost, ...mark }) => mark
    );
    const updated: DraftRecord = {
      ...record,
      source: next,
      marks,
      history: [
        ...record.history,
        {
          id: `${Date.now().toString(36)}-${editing.block}`,
          from: range.from,
          to: range.to,
          before,
          after,
          excerpt: before.replace(/\s+/g, ' ').trim().slice(0, 40),
          at: Date.now(),
        },
      ],
      openedAt: Date.now(),
    };
    rememberBlock();
    setRecord(updated);
    setEditing(null);
    setDirty(false);
    setRenderKey((n) => n + 1);
    setToast('直しました');
    await saveDraft(updated).catch(() => {});
  }

  /** 直した記録をひとつ取り消して、その段を元の文に戻す。 */
  async function undoRevision(revisionId: string) {
    if (!record || !book) return;
    const revision = record.history.find((r) => r.id === revisionId);
    if (!revision) return;
    const lines = record.source.split('\n');
    const after = revision.after.split('\n');
    /*
     * 直した記録は「原文の何行目を、何に置き換えたか」で持っている。
     * そのあと別のところを直していると行番号がずれるので、
     * 覚えている行のところに置き換えた文がそのまま残っているかを確かめ、
     * ずれていたら本文から探し直す。どちらも駄目なら取り消さない。
     */
    let at = revision.from;
    const matches = (index: number) =>
      after.every((line, i) => lines[index + i] === line);
    if (!matches(at)) {
      at = -1;
      for (let i = 0; i + after.length <= lines.length; i++) {
        if (matches(i)) {
          at = i;
          break;
        }
      }
    }
    if (at < 0) {
      setToast('そのあとに直したので、戻せませんでした');
      return;
    }
    const next = [
      ...lines.slice(0, at),
      ...revision.before.split('\n'),
      ...lines.slice(at + after.length),
    ].join('\n');
    const nextBook = buildBook(next, record.title);
    const marks: Mark[] = reanchorAll(nextBook, record.marks).map(
      ({ lost: _lost, ...mark }) => mark
    );
    const updated: DraftRecord = {
      ...record,
      source: next,
      marks,
      history: record.history.filter((r) => r.id !== revisionId),
      openedAt: Date.now(),
    };
    rememberBlock();
    setRecord(updated);
    setToast('元に戻しました');
    await saveDraft(updated).catch(() => {});
  }

  /* ---------------- 印 ---------------- */

  /*
   * 文字が選ばれたら、画面の上に小さなボタンを出す。
   * 選んでいる最中も何度も呼ばれるが、出す場所はいつも同じなので動かない。
   */
  useEffect(() => {
    const onSelect = () => {
      const flow = flowRef.current;
      setSelAction(flow ? readSelection(flow) : null);
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, []);

  /** 選んだところに印を付ける用意をする。 */
  const startMark = useCallback(
    (found: BlockSelection) => {
      /*
       * 見せる文字は、ブラウザの「選んだ文字」ではなく本文から切り出す。
       * ブラウザのほうはルビの読みまで含めて返すので（`灯台` を選ぶと
       * `灯台とうだい` になる）、そのまま見せると、実際に印が付く範囲と
       * 食い違って見える。
       */
      const quote = plainOf(chapters[chapter]?.blocks[found.block]).slice(
        found.start,
        found.end
      );
      setPending({ ...found, text: quote || found.text });
      setPendingKind('fix');
      setPendingNote('');
      setSelAction(null);
      setSheet('mark');
    },
    [chapters, chapter]
  );

  async function addMark() {
    if (!record || !pending) return;
    const block = chapters[chapter]?.blocks[pending.block];
    const quote = plainOf(block).slice(pending.start, pending.end);
    const mark: Mark = {
      id: `${Date.now().toString(36)}-${pending.block}-${pending.start}`,
      kind: pendingKind,
      chapter,
      block: pending.block,
      start: pending.start,
      end: pending.end,
      quote,
      note: pendingNote,
      at: Date.now(),
    };
    const updated: DraftRecord = {
      ...record,
      marks: [...record.marks, mark],
      openedAt: Date.now(),
    };
    rememberBlock();
    setRecord(updated);
    setPending(null);
    setSheet(null);
    clearSelection();
    setToast(`「${MARK_LABEL[mark.kind]}」の印を付けました`);
    await saveDraft(updated).catch(() => {});
  }

  async function saveMarkNote(markId: string, note: string) {
    if (!record) return;
    const updated: DraftRecord = {
      ...record,
      marks: record.marks.map((m) => (m.id === markId ? { ...m, note } : m)),
    };
    setRecord(updated);
    await saveDraft(updated).catch(() => {});
  }

  async function removeMark(markId: string) {
    if (!record) return;
    const updated: DraftRecord = {
      ...record,
      marks: record.marks.filter((m) => m.id !== markId),
    };
    rememberBlock();
    setRecord(updated);
    setOpenMark(null);
    if (sheet === 'mark') setSheet(null);
    await saveDraft(updated).catch(() => {});
  }

  /* ---------------- 指・キーの操作 ---------------- */

  // 縦書きは左から右へなぞると次のページ、横書きはその逆
  const forwardSign = settings.vertical ? 1 : -1;

  /*
   * 長押しは端末が「文字を選ぶ」ために使う動きなので、こちらでは横取りしない。
   * 以前は長押しで直す画面を開いていたが、それでは選ぶことができなくなり、
   * 印を付ける唯一の入り口をふさいでしまう。直すほうは、
   * 選んだあとのシートの「この段を直す」と、操作パネルの朱筆から開く。
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointer.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    moved.current = false;
    setAnimating(false);
    // 送ったあとも続けて打てるよう、いまのカーソルの場所を控えておく
    if (editing) {
      const selection = window.getSelection();
      heldCaret.current =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    }
  };

  /**
   * 直しているあいだ、本文の外を押しても焦点を外さない。
   *
   * 焦点が外れるとキーボードが引っ込み、続きが打てなくなる。左右に送るには
   * 本文の外をなぞることになるので、そのたびに引っ込んでは使えない。
   * `mousedown` の既定の動き（焦点の移動）だけを止める。押したこと自体は
   * `click` として届くので、外を押して直しを確定する動きはそのまま残る。
   */
  const onMouseDown = (e: React.MouseEvent) => {
    if (!editing) return;
    const inside = (e.target as HTMLElement | null)?.closest?.('.md-block.editing');
    if (!inside) e.preventDefault();
  };

  /** 送ったあと、焦点が外れていたら戻す。 */
  const keepFocus = () => {
    if (!editing) return;
    const el = flowRef.current?.querySelector<HTMLElement>('.md-block.editing');
    if (!el || document.activeElement === el) return;
    el.focus({ preventScroll: true });
    const range = heldCaret.current;
    if (!range) return;
    try {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      /* 戻せなくても、指で置き直せる */
    }
  };

  /**
   * 左右に送れる範囲。
   * 本文の右端（始まり）から、最後の列が見えるところまで。
   */
  const panRange = useCallback(() => {
    const flow = flowRef.current;
    if (!flow || !metrics) return 0;
    const width = settings.vertical ? flow.getBoundingClientRect().width : flow.scrollWidth;
    return Math.max(0, Math.round(width - metrics.pageWidth));
  }, [metrics, settings.vertical]);

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
    if (editing) {
      // 直しているあいだは、ページを送らずに本文をそのまま左右へ動かす
      setDrag(dx);
      return;
    }
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
    if (editing) {
      // 動かしたぶんをそのまま覚える（ページは送らない）
      const limit = panRange();
      const base = layout?.pageStarts[page] ?? 0;
      const next = Math.min(limit - base, Math.max(-base, pan + dx * forwardSign));
      setPan(Math.round(next));
      setDrag(0);
      keepFocus();
      return;
    }
    const speed = Math.abs(dx) / Math.max(1, performance.now() - start.t);
    const threshold = Math.max(SWIPE_MIN, (stage?.w ?? 320) * SWIPE_RATIO);
    setDrag(0);
    setAnimating(true);
    if (Math.abs(dx) > threshold || speed > FLICK_SPEED) {
      go(dx * forwardSign > 0 ? 1 : -1);
    }
  };

  /**
   * 画面を押したとき。
   *
   * 二度押しは「その段を直す」に充てている。本文のどこでも効かせたいが、
   * 左右の端は一度押しでページが送られるので、素直に作ると
   * 二度押しでページが2つ動いてしまう。かといって、二度目を待ってから
   * 送るようにすると、ページ送りがもたついて読む邪魔になる。
   *
   * そこで**一度目はすぐ送り、二度目だと分かった時点で送ったぶんを戻す**。
   * 送りの手ざわりは変わらないまま、どこを二度押ししても直す画面が開く。
   */
  const onTap = (e: React.MouseEvent) => {
    if (moved.current) return;
    /*
     * 直しているあいだは、本文を押してもページを送らない。
     * 直している段の中を押したときは、字を入れる印を置き直すだけにする
     * （ここで閉じてしまうと、印を置き直せない）。
     * 外を押したときは、そこで直しを確定して閉じる（書いたものが黙って
     * 消えるより、残すほうが困らない。気が変わったら「直した記録」から戻せる）。
     */
    if (editing) {
      const inside = (e.target as HTMLElement | null)?.closest?.('.md-block.editing');
      if (!inside) void applyEdit();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const target = (e.target as HTMLElement | null)?.closest?.('.md-block');
    const index = target instanceof HTMLElement ? Number(target.dataset.b) : NaN;
    const block = Number.isInteger(index) ? index : null;
    /*
     * 押したところが地の文の何文字目かは、**この一度目の時点で**取っておく。
     * 二度目まで待つと、一度目でページが送られたあとの画面を見ることになり、
     * 指の下にあるのは別の段になってしまう。
     */
    const caret = target && block !== null ? offsetAtPoint(target, e.clientX, e.clientY) : null;
    const now = performance.now();
    const first = lastTap.current;

    /* ---- 二度目か ---- */
    if (
      first &&
      now - first.at < DOUBLE_MS &&
      Math.abs(e.clientX - first.x) < DOUBLE_SLOP &&
      Math.abs(e.clientY - first.y) < DOUBLE_SLOP &&
      first.block !== null
    ) {
      lastTap.current = null;
      /*
       * 一度目の押しで送ったぶんを戻す。直しはじめても画面は動かさない決まりなので、
       * ここで戻しておかないと、二度押ししただけでページが1つずれてしまう。
       * 章をまたいでいた場合は openEditor が章ごと戻すので、ここでは触らない。
       */
      if (first.chapter === chapter && first.turned !== 0) go(-first.turned);
      if (first.toggledChrome) setChrome((v) => !v);
      /*
       * 机の上のブラウザでは、二度押しでその語が選ばれる。
       * 選んだままだと印のボタンが出たままになるので、ここで解いておく。
       */
      clearSelection();
      setSelAction(null);
      openEditor(first.block, first.chapter, first.caret);
      return;
    }

    /* ---- 一度目 ---- */
    /*
     * 選んだところを消すつもりで押したときに、ページまでめくれてしまうと
     * 読んでいた場所を見失う。最初の一押しは選択を解くだけにする。
     */
    if (selAction) {
      setSelAction(null);
      clearSelection();
      lastTap.current = null;
      return;
    }

    let turned = 0;
    let toggledChrome = false;
    if (x < 0.34) {
      turned = forwardSign > 0 ? 1 : -1;
      go(turned);
    } else if (x > 0.66) {
      turned = forwardSign > 0 ? -1 : 1;
      go(turned);
    } else {
      setChrome((v) => !v);
      toggledChrome = true;
    }
    lastTap.current = {
      at: now,
      x: e.clientX,
      y: e.clientY,
      block,
      caret,
      chapter,
      turned,
      toggledChrome,
    };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      /*
       * 直しているあいだは、書き込み欄に字が入る。ページ送りの鍵は効かせない。
       * Escapeだけは、やめて本文に戻る逃げ道として受ける。
       */
      if (editing) {
        if (e.key === 'Escape') cancelEditing();
        return;
      }
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
  }, [go, pages, sheet, editing, cancelEditing, settings.vertical, navigate]);

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

  /* ---------------- 印の一覧 ---------------- */

  const markRows = useMemo(() => {
    const order: Record<MarkKind, number> = { fix: 0, question: 1, good: 2, note: 3 };
    return [...anchored].sort(
      (a, b) =>
        Number(Boolean(a.lost)) - Number(Boolean(b.lost)) ||
        a.chapter - b.chapter ||
        a.block - b.block ||
        a.start - b.start ||
        order[a.kind] - order[b.kind]
    );
  }, [anchored]);

  const openedMark = useMemo(
    () => anchored.find((m) => m.id === openMark) ?? null,
    [anchored, openMark]
  );

  /* ---------------- 表示 ---------------- */

  if (record === undefined) return <div className="loading">読み込み中…</div>;
  if (record === null || !book || !current) {
    return (
      <div className="loading">
        <p>原稿が見つかりませんでした。</p>
        <button className="btn" onClick={() => navigate('/')}>
          卓へ戻る
        </button>
      </div>
    );
  }

  const progress =
    (chapter + (pages > 1 ? page / (pages - 1 || 1) : 1)) / Math.max(1, chapters.length);
  // ページの位置は行の実測から決まるので、等間隔とは限らない
  const pageStart = layout?.pageStarts[page] ?? 0;
  /*
   * 直しているあいだは、ページの切れ目ではなく「指で送ったところ」を見せる。
   * 送った量は本文の始まりからの距離なので、向きは組み方に合わせて直す。
   */
  const shownStart = editing ? pageStart + pan : pageStart;
  const offset = editing
    ? (settings.vertical ? shownStart : -shownStart) + drag
    : (settings.vertical ? pageStart : -pageStart) + drag;
  /*
   * 本文を見せる窓の幅。そのページの本文が終わるところで閉じるので、
   * 余白に次のページの1行目が半分だけ覗くことがない（＝文字が切れない）。
   */
  const windowWidth =
    editing || !metrics || !layout
      ? (metrics?.pageWidth ?? 0)
      : Math.max(
          metrics.pageWidth * 0.2,
          Math.min(metrics.pageWidth, (layout.pageEnds[page] ?? 0) - pageStart)
        );
  const sideMargin = metrics ? Math.max(0, ((stage?.w ?? 0) - metrics.pageWidth) / 2) : 0;

  return (
    <div className={`study font-${settings.font} ${settings.vertical ? 'v' : 'h'}`}>
      <header className={`study-bar${chrome ? '' : ' hidden'}`}>
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="卓へ戻る">
          <BackIcon />
        </button>
        <div className="study-title">
          <strong>{record.title}</strong>
          <span>{current.title || `第${chapter + 1}章`}</span>
        </div>
        <button
          className="icon-btn"
          onClick={() => openEditor(currentBlock)}
          aria-label="いまの段を直す"
          title="いまの段を直す"
        >
          <PenIcon />
        </button>
        <button
          className="icon-btn"
          onClick={() => setSheet('marks')}
          aria-label="印の一覧"
          title="印の一覧"
        >
          <MarkIcon />
          {record.marks.length > 0 && <span className="badge">{record.marks.length}</span>}
        </button>
        <button className="icon-btn" onClick={() => setSheet('toc')} aria-label="目次">
          <TocIcon />
        </button>
        <button className="icon-btn" onClick={() => setSheet('search')} aria-label="本文を検索">
          <SearchIcon />
        </button>
        <button
          className="icon-btn"
          onClick={() => setSheet('settings')}
          aria-label="読み方の設定"
        >
          <span className="aa">あ</span>
        </button>
      </header>

      <div
        className="stage"
        ref={stageRef}
        // 上下は操作パネルのぶんを空けておく。パネルが隠れても本文が動かない。
        style={{ padding: `${pad + 46}px ${pad}px ${pad + 42}px` }}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={() => {
          pointer.current = null;
          setDrag(0);
        }}
        onClick={onTap}
      >
        <div
          ref={scrollRef}
          className={`stage-inner${editing ? ' scrollable' : ''}`}
          style={
            metrics
              ? settings.vertical
                ? { width: windowWidth, marginLeft: 'auto', marginRight: sideMargin }
                : { width: metrics.pageWidth, margin: '0 auto' }
              : undefined
          }
        >
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
                        right: 0,
                        fontSize: settings.size,
                        lineHeight: `${lineHeight}px`,
                        ['--u' as string]: `${lineHeight}px`,
                        ['--page' as string]: `${metrics.pageWidth}px`,
                        ['--pageh' as string]: `${metrics.pageHeight}px`,
                      }
                    : {
                        height: metrics.pageHeight,
                        width: metrics.pageWidth,
                        columnWidth: metrics.pageWidth,
                        columnGap: gap,
                        fontSize: settings.size,
                        lineHeight: `${lineHeight}px`,
                        ['--u' as string]: `${lineHeight}px`,
                        ['--page' as string]: `${metrics.pageWidth}px`,
                        ['--pageh' as string]: `${metrics.pageHeight}px`,
                      }
                }
              >
                <RenderBlocks
                  key={renderKey}
                  blocks={current.blocks}
                  onJump={onJump}
                  onExternal={(href) => setOutLink(href)}
                  highlight={hit && hit.chapter === chapter ? hit.block : undefined}
                  marks={chapterMarks}
                  edit={
                    editing && editing.chapter === chapter
                      ? {
                          block: editing.block,
                          onInput: () => {
                            setDirty(true);
                            followCaret();
                          },
                        }
                      : undefined
                  }
                  onMark={(markId) => {
                    const found = anchored.find((m) => m.id === markId);
                    setOpenMark(markId);
                    setMarkNote(found?.note ?? '');
                  }}
                />
                <div className="md-end" aria-hidden />
              </div>
            </div>
          )}
          {/*
            直しているあいだだけ置く、高さのあるつっかえ棒。
            本文は浮かせて（position: absolute）置いてあるので、そのままでは
            入れ物に「送るぶんの高さ」が無く、指で動かせない。
            版面と同じ高さのものを1つ入れて、上下に送れるようにする。
          */}
          {editing && metrics && (
            <div
              className="edit-scroll"
              style={{ height: metrics.pageHeight }}
              aria-hidden
            />
          )}
        </div>
      </div>

      <footer className={`study-foot${chrome ? '' : ' hidden'}`}>
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
          <span className="foot-hint">なぞると印、二度押しで直す</span>
          <span className="foot-rest">
            {pages - page - 1 > 0
              ? `この章 あと${pages - page - 1}ページ`
              : chapter < chapters.length - 1
                ? 'この章の終わり'
                : '最後の章'}
          </span>
        </div>
      </footer>

      {toast && <div className="toast">{toast}</div>}

      {/*
        選んだところのそばに出る小さなボタン。
        押すときに選択が消えないよう、押し下げの既定の動き（選択の解除）を止めている。
        これを止めないと、押した瞬間に選択が消えて、何に印を付けるのか分からなくなる。
      */}
      {selAction && sheet === null && openedMark === null && (
        <div
          className="sel-bar"
          onPointerDown={(e) => e.preventDefault()}
        >
          <button onClick={() => startMark(selAction)}>
            <MarkIcon />
            印をつける
          </button>
          <button
            onClick={() => {
              const block = selAction.block;
              setSelAction(null);
              clearSelection();
              openEditor(block);
            }}
          >
            <PenIcon />
            この段を直す
          </button>
        </div>
      )}

      {/*
        直したときだけ、画面の下に出す小さな帯。
        直しはじめただけでは出さない（本文にカーソルが立つだけにしたいため）。
        本文の上にはかぶせない。
      */}
      {editing && dirty && (
        <div className="edit-bar" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn btn-sm btn-ghost" onClick={cancelEditing}>
            やめる
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void applyEdit()}>
            直す
          </button>
        </div>
      )}

      {/* ---- 直した記録 ---- */}
      <Sheet open={sheet === 'history'} title="直した記録" onClose={() => setSheet(null)}>
        {record.history.length === 0 && <p className="muted">まだ直していません。</p>}
        <ul className="history">
          {[...record.history].reverse().map((revision) => (
            <li key={revision.id}>
              <div className="rev">
                <span className="rev-before">{revision.before.replace(/\s+/g, ' ').slice(0, 90)}</span>
                <span className="rev-arrow" aria-hidden>
                  ↓
                </span>
                <span className="rev-after">{revision.after.replace(/\s+/g, ' ').slice(0, 90)}</span>
              </div>
              <button className="btn btn-sm" onClick={() => void undoRevision(revision.id)}>
                <UndoIcon />
                元に戻す
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {/* ---- 印を付ける ---- */}
      <Sheet
        open={sheet === 'mark'}
        title="印をつける"
        onClose={() => {
          setSheet(null);
          setPending(null);
        }}
        footer={
          <div className="sheet-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setSheet(null);
                setPending(null);
                clearSelection();
              }}
            >
              やめる
            </button>
            <button className="btn btn-primary" onClick={() => void addMark()}>
              付ける
            </button>
          </div>
        }
      >
        <blockquote className="quoted">{pending?.text}</blockquote>
        <div className="sheet-sub" style={{ marginTop: 0, marginBottom: 14 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const block = pending?.block;
              const at = pending?.start;
              setSheet(null);
              setPending(null);
              clearSelection();
              if (block !== undefined) openEditor(block, chapter, at);
            }}
          >
            <PenIcon />
            印ではなく、この段をいま直す
          </button>
        </div>
        <div className="kinds">
          {MARK_KINDS.map((kind) => (
            <button
              key={kind}
              className={`kind kind-${kind}${pendingKind === kind ? ' on' : ''}`}
              onClick={() => setPendingKind(kind)}
            >
              <strong>{MARK_LABEL[kind]}</strong>
              <span>{MARK_HINT[kind]}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>覚書（なくてもかまいません）</span>
          <textarea
            className="input textarea"
            value={pendingNote}
            rows={3}
            placeholder="例：ここは前の章と辻褄が合っていない"
            spellCheck={false}
            data-gramm="false"
            onChange={(e) => setPendingNote(e.target.value)}
          />
        </label>
      </Sheet>

      {/* ---- 押した印 ---- */}
      <Sheet
        open={openedMark !== null}
        title={openedMark ? `印「${MARK_LABEL[openedMark.kind]}」` : '印'}
        onClose={() => setOpenMark(null)}
        footer={
          <div className="sheet-actions">
            <button
              className="btn btn-danger"
              onClick={() => openedMark && void removeMark(openedMark.id)}
            >
              <TrashIcon />
              印を外す
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (openedMark) void saveMarkNote(openedMark.id, markNote);
                setOpenMark(null);
              }}
            >
              覚書を保存
            </button>
          </div>
        }
      >
        <blockquote className="quoted">{openedMark?.quote}</blockquote>
        <label className="field">
          <span>覚書</span>
          <textarea
            className="input textarea"
            value={markNote}
            rows={4}
            spellCheck={false}
            data-gramm="false"
            onChange={(e) => setMarkNote(e.target.value)}
          />
        </label>
      </Sheet>

      {/* ---- 印の一覧 ---- */}
      <Sheet open={sheet === 'marks'} title="印の一覧" onClose={() => setSheet(null)}>
        {markRows.length === 0 && (
          <p className="muted">
            まだ印はありません。本文の文字を指でなぞると、印を付けられます。
          </p>
        )}
        <ul className="marks">
          {markRows.map((mark) => (
            <li key={mark.id} className={mark.lost ? 'lost' : ''}>
              <button
                className="mark-item"
                disabled={mark.lost}
                onClick={() => jumpTo({ chapter: mark.chapter, block: mark.block })}
              >
                <span className={`chip chip-${mark.kind}`}>{MARK_LABEL[mark.kind]}</span>
                <span className="mark-text">
                  <strong>{mark.quote.replace(/\s+/g, ' ').slice(0, 48)}</strong>
                  {mark.note && <span className="mark-note">{mark.note}</span>}
                  {mark.lost && (
                    <span className="mark-note">
                      本文が変わって、この印の場所が分からなくなりました
                    </span>
                  )}
                </span>
              </button>
              <button
                className="icon-btn"
                onClick={() => void removeMark(mark.id)}
                aria-label="この印を外す"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
        <div className="sheet-sub">
          <button
            className="btn btn-ghost"
            disabled={markRows.length === 0}
            onClick={() =>
              downloadMarks(
                record,
                markRows.map((mark) => ({
                  kind: MARK_LABEL[mark.kind],
                  chapter: chapters[mark.chapter]?.title || `第${mark.chapter + 1}章`,
                  quote: mark.quote,
                  note: mark.note,
                  lost: mark.lost,
                }))
              )
            }
          >
            <DownloadIcon />
            印の一覧を書き出す
          </button>
          <button className="btn btn-ghost" onClick={() => downloadSource(record)}>
            <DownloadIcon />
            直したあとの原稿を書き出す
          </button>
          {record.history.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setSheet('history')}>
              <UndoIcon />
              直した記録（{record.history.length}）
            </button>
          )}
        </div>
      </Sheet>

      {/* ---- 目次 ---- */}
      <Sheet open={sheet === 'toc'} title="目次" onClose={() => setSheet(null)}>
        <ol className="toc">
          {book.toc.length === 0 && <li className="muted">見出しのない原稿です</li>}
          {book.toc.map((entry, i) => (
            <li key={i} className={`toc-l${Math.min(entry.level, 4)}`}>
              <button
                className={`toc-item${entry.chapter === chapter ? ' on' : ''}`}
                onClick={() => jumpTo({ chapter: entry.chapter, anchor: entry.id })}
              >
                <span className="toc-title">{entry.title || '（無題）'}</span>
              </button>
            </li>
          ))}
        </ol>
      </Sheet>

      {/* ---- 検索 ---- */}
      <Sheet open={sheet === 'search'} title="本文を検索" onClose={() => setSheet(null)}>
        {/* 探した言葉が外（スペルチェックの照会・入力履歴）に残らないようにする */}
        <input
          className="input"
          autoFocus
          value={query}
          placeholder="探したい言葉"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
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

      {/* ---- 読み方 ---- */}
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
            <button
              className={settings.animate ? 'on' : ''}
              onClick={() => update({ animate: true })}
            >
              あり
            </button>
            <button
              className={!settings.animate ? 'on' : ''}
              onClick={() => update({ animate: false })}
            >
              なし
            </button>
          </div>
        </div>
      </Sheet>

      {/*
        本文の中の「外を指すリンク」を押したときの確認。
        押しただけでは何も起きない。行き先を見てから決めてもらう。
      */}
      <Sheet
        open={outLink !== null}
        title="このリンクは原稿の外です"
        onClose={() => setOutLink(null)}
      >
        <p className="sheet-note">
          押すとヘルメスの外（ブラウザなど別のアプリ）に移ります。移った先には、
          あなたがここを開いたことが記録として残ることがあります。原稿そのものは渡りません。
        </p>
        <p className="link-dest">{outLink}</p>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setOutLink(null)}>
            開かない
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const href = outLink;
              setOutLink(null);
              if (href) window.open(href, '_blank', 'noopener,noreferrer');
            }}
          >
            それでも開く
          </button>
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
