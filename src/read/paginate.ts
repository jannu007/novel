/**
 * 本文をページに割るための計測。
 *
 * ■ 考え方
 * 文字数から見積もるのではなく、**実際に組まれた本文の大きさをブラウザから測って**
 * ページを割っている。フォント・ルビ・字の大きさ・端末の画面比が変わっても、
 * 行が途中で切れたり、最後の行が次のページにこぼれたりしない。
 *
 * ■ 縦書き（既定）
 * 本文を `writing-mode: vertical-rl` で流すと、行は右から左へ積み上がる。
 * 高さをページの高さに固定しておけば、あとは横に伸びていくだけなので、
 * その全長をページ幅で割ればページ数になる。ページ幅は行送りの倍数に
 * 丸めてあるため、ページの境目で行が半分に割れることはない。
 *
 * ■ 横書き
 * CSSの段組み（マルチカラム）に流し込み、1段＝1ページとして扱う。
 * 段の分割はブラウザに任せられるので、見出しや箇条書きも自然に割れる。
 *
 * ■ 泣き別れの回避（縦書き）
 * 挿絵がページの境目にまたがるとき、見出しがページの末尾にぽつんと残るときは、
 * その手前に余白を足して次のページの先頭に送る。実際の書籍の組版と同じ配慮。
 */

export interface PageLayout {
  /** 章全体のページ数 */
  pages: number;
  /** ブロック番号 → そのブロックが始まるページ */
  blockPages: number[];
  /** 見出しID → ページ */
  anchors: Map<string, number>;
}

export interface LayoutOptions {
  /** 縦書きなら true */
  vertical: boolean;
  /** 1ページの本文の幅 */
  pageWidth: number;
  /** 1ページ進むときに動かす距離（横書きは段の間隔を含む） */
  step: number;
}

const EPS = 0.5;

/** 見出しがページ末尾に取り残されるとみなす割合（この位置より後ろなら送る）。 */
const WIDOW_RATIO = 0.82;

export function layoutFlow(flow: HTMLElement, o: LayoutOptions): PageLayout {
  const blocks = Array.from(flow.querySelectorAll<HTMLElement>(':scope > .md-block'));
  const anchors = new Map<string, number>();

  // 前回の調整を戻してから測り直す
  for (const el of blocks) el.style.marginBlockStart = '';
  const sentinel = flow.querySelector<HTMLElement>(':scope > .md-end');

  if (blocks.length === 0) {
    return { pages: 1, blockPages: [], anchors };
  }

  const flowRect = flow.getBoundingClientRect();
  const blockPages: number[] = [];

  if (!o.vertical) {
    // 横書き：段組みの分割はブラウザが済ませているので、位置を読むだけ
    for (let i = 0; i < blocks.length; i++) {
      const rect = blocks[i].getBoundingClientRect();
      blockPages[i] = Math.max(0, Math.round((rect.left - flowRect.left) / o.step));
    }
    const endRect = sentinel?.getBoundingClientRect();
    const lastPage = endRect
      ? Math.round((endRect.left - flowRect.left) / o.step)
      : blockPages[blockPages.length - 1];
    const pages = Math.max(1, lastPage + 1);
    collectAnchors(blocks, blockPages, anchors);
    return { pages: Math.min(pages, 5000), blockPages, anchors };
  }

  // 縦書き：右端が本文の始まり。右端からの距離がそのまま流れの中の位置になる。
  const right = flowRect.right;
  const measured = blocks.map((el) => {
    const rect = el.getBoundingClientRect();
    return { start: right - rect.right, extent: rect.width, el };
  });

  let shift = 0;
  for (let i = 0; i < measured.length; i++) {
    const m = measured[i];
    const start = m.start + shift;
    const page = Math.floor((start + EPS) / o.pageWidth);
    const kind = blockKind(m.el);
    let pad = 0;

    if (kind === 'figure' && m.extent <= o.pageWidth + EPS) {
      // 挿絵がページをまたぐなら、まるごと次のページへ送る
      const endPage = Math.floor((start + m.extent - EPS) / o.pageWidth);
      if (endPage !== page) pad = (page + 1) * o.pageWidth - start;
    } else if (kind === 'heading' && i < measured.length - 1) {
      // 見出しがページの末尾に取り残されるなら、次のページの先頭へ送る
      const posInPage = start - page * o.pageWidth;
      if (posInPage > o.pageWidth * WIDOW_RATIO) {
        pad = (page + 1) * o.pageWidth - start;
      }
    }

    if (pad > EPS) {
      m.el.style.marginBlockStart = `${Math.round(pad)}px`;
      shift += pad;
      blockPages[i] = page + 1;
    } else {
      blockPages[i] = page;
    }
  }

  const last = measured[measured.length - 1];
  const total = last.start + shift + last.extent;
  const pages = Math.max(1, Math.ceil((total - EPS) / o.pageWidth));
  collectAnchors(blocks, blockPages, anchors);
  return { pages: Math.min(pages, 5000), blockPages, anchors };
}

function blockKind(el: HTMLElement): 'figure' | 'heading' | 'other' {
  if (el.firstElementChild?.classList.contains('md-figure')) return 'figure';
  if (el.firstElementChild?.classList.contains('md-h')) return 'heading';
  return 'other';
}

function collectAnchors(
  blocks: HTMLElement[],
  blockPages: number[],
  anchors: Map<string, number>
): void {
  for (let i = 0; i < blocks.length; i++) {
    for (const el of blocks[i].querySelectorAll<HTMLElement>('[data-anchor]')) {
      const id = el.dataset.anchor;
      if (id && !anchors.has(id)) anchors.set(id, blockPages[i] ?? 0);
    }
  }
}

/**
 * ページの寸法を決める。
 * 縦書きでは、ページの幅を行送りの倍数に丸めることで、行がページの境目で
 * 分断されないようにしている（余った幅は左右の余白に回す）。
 */
export function pageMetrics(
  stageWidth: number,
  stageHeight: number,
  lineHeight: number,
  vertical: boolean,
  gap: number
): { pageWidth: number; pageHeight: number; step: number; offset: number } {
  if (vertical) {
    const usable = Math.max(lineHeight, stageWidth);
    const pageWidth = Math.max(lineHeight, Math.floor(usable / lineHeight) * lineHeight);
    return {
      pageWidth,
      pageHeight: stageHeight,
      step: pageWidth,
      offset: Math.max(0, (stageWidth - pageWidth) / 2),
    };
  }
  const pageHeight = Math.max(lineHeight, Math.floor(stageHeight / lineHeight) * lineHeight);
  return {
    pageWidth: stageWidth,
    pageHeight,
    step: stageWidth + gap,
    offset: 0,
  };
}
