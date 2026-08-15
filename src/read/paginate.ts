/**
 * 本文をページに割るための計測。
 *
 * ■ 考え方
 * 文字数から見積もるのではなく、**組み上がった1行1行の位置をブラウザから測って**
 * ページを割っている。行の実測に基づくので、ルビで行が太くなっても、見出しで
 * 字の大きさが変わっても、**ページの境目で行が切れることがない**。
 *
 * ■ 縦書き（既定）
 * 本文を `writing-mode: vertical-rl` で流すと、行は右から左へ積み上がる。
 * 高さをページの高さに固定すれば、あとは横へ伸びていくだけなので、
 * 「各行が流れの中のどこからどこまでか」を測り、ページ幅に収まる範囲で
 * 区切っていけばよい。区切りは必ず行と行のあいだに来る。
 *
 * ■ 横書き
 * CSSの段組み（マルチカラム）に流し込み、1段＝1ページとして扱う。
 * 段の分割はブラウザがやってくれるので、こちらは段の位置を数えるだけでよい。
 *
 * ■ 泣き別れの回避
 * 挿絵・コード・表は「1つのかたまり」として扱い、途中で割らない。入りきらなければ
 * まるごと次のページへ送る。見出しがページの末尾に取り残されるときも次へ送る。
 */

export interface PageLayout {
  /** 章全体のページ数 */
  pages: number;
  /** 各ページが流れの中のどこから始まるか（px。ページ送りの移動量に使う） */
  pageStarts: number[];
  /**
   * 各ページの本文がどこで終わるか（px）。
   * 本文を見せる窓をこの位置で閉じることで、次のページの1行目が
   * 余白に半分だけ覗く（＝文字が切れて見える）ことを防ぐ。
   */
  pageEnds: number[];
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
  /** 横書きで1ページ進むときに動かす距離（段の間隔を含む） */
  step: number;
  /** 行送り（1行が占める幅） */
  lineHeight: number;
}

const EPS = 0.5;

/** 見出しがページ末尾に取り残されるとみなす割合（この位置より後ろなら次ページへ送る）。 */
const WIDOW_RATIO = 0.84;

/** ページ数の上限（壊れた入力で無限に増えないようにする安全弁）。 */
const MAX_PAGES = 5000;

/** これ以上は中を見ずに「1つのかたまり」として扱う要素。 */
const ATOMIC = '.md-figure, .md-pre, .md-table-wrap, img';

interface Item {
  /** 流れの先頭からの距離 */
  start: number;
  /** 同じく、終わりまでの距離 */
  end: number;
  heading: boolean;
}

/**
 * 流れの中の「行」と「割ってはいけないかたまり」を、位置の一覧として集める。
 * 行の位置は Range.getClientRects()（＝ブラウザが実際に組んだ行の矩形）から取る。
 */
function collectItems(flow: HTMLElement, vertical: boolean, lineHeight: number): Item[] {
  const flowRect = flow.getBoundingClientRect();
  const items: Item[] = [];

  // 縦書きは右端が本文の始まり（左へ流れる）、横書きは左端が始まり
  const push = (rect: DOMRect, heading: boolean, text: boolean) => {
    if (rect.width <= 0 && rect.height <= 0) return;
    let start = vertical ? flowRect.right - rect.right : rect.left - flowRect.left;
    let end = vertical ? flowRect.right - rect.left : rect.right - flowRect.left;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (text && end - start < lineHeight) {
      /*
       * 文字そのものの矩形ではなく、その文字が乗っている「行1本ぶん」の幅で扱う。
       * 傍点はDOM上の要素ではなく文字の脇に描かれる装飾なので矩形に表れないが、
       * 行1本ぶんまで広げておけば、ページの区切りが行と行のあいだに来て、
       * 傍点やルビが境目で欠けることがなくなる。
       */
      const pad = (lineHeight - (end - start)) / 2;
      start -= pad;
      end += pad;
    }
    items.push({ start, end, heading });
  };

  const walk = (node: Element, heading: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.textContent || child.textContent.trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        // 1つのテキストでも、折り返されていれば行ごとに矩形が返る
        for (const rect of Array.from(range.getClientRects()))
          push(rect as DOMRect, heading, true);
        range.detach?.();
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (el.matches(ATOMIC)) {
        // 挿絵・コード・表は中を見ずに、まるごと1つのかたまりとして扱う
        push(el.getBoundingClientRect() as DOMRect, false, false);
        continue;
      }
      walk(el, heading || el.classList.contains('md-h'));
    }
  };

  walk(flow, false);
  items.sort((a, b) => a.start - b.start || a.end - b.end);

  /*
   * 重なっているものは1つにまとめる。
   * ルビの読みは親文字の行からはみ出して隣の行間に置かれるため、
   * まとめておかないと「行の頭で切ってよい位置」がルビの内側に来てしまい、
   * ページの境目でルビだけが切れてしまう。
   */
  const merged: Item[] = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (last && item.start < last.end - EPS) {
      last.end = Math.max(last.end, item.end);
      last.heading = last.heading || item.heading;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

/** 位置から、それが何ページ目かを引く。 */
function pageOf(pageStarts: number[], offset: number): number {
  let lo = 0;
  let hi = pageStarts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageStarts[mid] <= offset + EPS) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function layoutFlow(flow: HTMLElement, o: LayoutOptions): PageLayout {
  const blocks = Array.from(flow.querySelectorAll<HTMLElement>(':scope > .md-block'));
  const anchors = new Map<string, number>();
  const flowRect = flow.getBoundingClientRect();
  const startOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return o.vertical ? flowRect.right - r.right : r.left - flowRect.left;
  };

  if (blocks.length === 0) {
    return { pages: 1, pageStarts: [0], pageEnds: [o.pageWidth], blockPages: [], anchors };
  }

  let pageStarts: number[];
  let pageEnds: number[];

  if (o.vertical) {
    // 行の位置を測り、ページ幅に収まるところまでを1ページとする。
    // 区切りは必ず行と行のあいだに来るので、行が半分に切れることはない。
    const items = collectItems(flow, true, o.lineHeight);
    pageStarts = [0];
    pageEnds = [0];
    let cur = 0;
    for (const item of items) {
      const overflows = item.end - cur > o.pageWidth + EPS;
      const widow = item.heading && item.start - cur > o.pageWidth * WIDOW_RATIO;
      // item.start > cur を条件に入れて、1つで1ページを超えるものがあっても必ず前へ進める
      if ((overflows || widow) && item.start > cur + EPS && pageStarts.length < MAX_PAGES) {
        cur = item.start;
        pageStarts.push(cur);
        pageEnds.push(item.end);
      } else {
        pageEnds[pageEnds.length - 1] = Math.max(pageEnds[pageEnds.length - 1], item.end);
      }
    }
  } else {
    // 横書き：段組みの分割はブラウザが済ませているので、段の数を数えるだけでよい。
    // 1段はページ幅ちょうどなので、隣の段が覗くことはない。
    const sentinel = flow.querySelector<HTMLElement>(':scope > .md-end');
    const lastStart = sentinel
      ? startOf(sentinel)
      : startOf(blocks[blocks.length - 1]);
    const count = Math.max(1, Math.min(MAX_PAGES, Math.round(lastStart / o.step) + 1));
    pageStarts = Array.from({ length: count }, (_, i) => i * o.step);
    pageEnds = pageStarts.map((s) => s + o.pageWidth);
  }

  const blockPages = blocks.map((el) => pageOf(pageStarts, startOf(el)));
  for (let i = 0; i < blocks.length; i++) {
    for (const el of blocks[i].querySelectorAll<HTMLElement>('[data-anchor]')) {
      const id = el.dataset.anchor;
      if (id && !anchors.has(id)) anchors.set(id, blockPages[i]);
    }
  }

  return { pages: pageStarts.length, pageStarts, pageEnds, blockPages, anchors };
}

/**
 * ページの寸法を決める。
 * 本文を表示する窓（`.stage-inner`）はここで決めた幅ちょうどに切り取られるので、
 * 隣のページの行が余白に覗くことはない。
 */
export function pageMetrics(
  stageWidth: number,
  stageHeight: number,
  lineHeight: number,
  vertical: boolean,
  gap: number
): { pageWidth: number; pageHeight: number; step: number } {
  if (vertical) {
    // 端数の帯が残らないよう、ページ幅は行送りの倍数に丸めておく
    // （行の位置は別途実測しているので、丸めは見た目を整えるためのもの）
    const pageWidth = Math.max(
      lineHeight,
      Math.floor(Math.max(lineHeight, stageWidth) / lineHeight) * lineHeight
    );
    return { pageWidth, pageHeight: stageHeight, step: pageWidth };
  }
  const pageHeight = Math.max(lineHeight, Math.floor(stageHeight / lineHeight) * lineHeight);
  return { pageWidth: stageWidth, pageHeight, step: stageWidth + gap };
}
