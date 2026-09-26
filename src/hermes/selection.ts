/**
 * 指でなぞったところが「どのかたまりの、何文字目から何文字目までか」を割り出す。
 *
 * 印はその位置でしか場所を持たないので、ここでの数え方は
 * `draft.ts` の `plainOf` と**1文字もずれてはいけない**。
 * そのために、数えるものを次の2つだけに絞ってある。
 *
 *   ・文字そのもの（ただしルビの読みは除く。行の脇に置かれる飾りなので）
 *   ・`<br>`（`plainInline` が改行1文字として数えているため）
 *
 * 箇条書きの点や番号はCSSが描くもので文字ではないから、数に入らない。
 * これで、解析した本文の側とDOMの側が同じ数になる。
 */

/** ルビの読みは地の文ではない。中の文字を数えない要素。 */
const SKIP = new Set(['RT', 'RP']);

export interface BlockSelection {
  /** かたまりの番号（`data-b`） */
  block: number;
  start: number;
  end: number;
  text: string;
}

/**
 * 要素の中の文字数を、上の決まりどおりに数える。
 * `stop` に来たら、そこまでの数を返して打ち切る。
 */
function count(
  node: Node,
  stop: { node: Node; offset: number } | null,
  state: { at: number; done: boolean }
): void {
  if (state.done) return;

  if (node.nodeType === Node.TEXT_NODE) {
    if (stop && stop.node === node) {
      state.at += Math.min(stop.offset, node.textContent?.length ?? 0);
      state.done = true;
      return;
    }
    state.at += node.textContent?.length ?? 0;
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP.has(el.tagName)) return;
  if (el.tagName === 'BR') {
    state.at += 1;
    return;
  }

  const children = Array.from(node.childNodes);
  for (let i = 0; i < children.length; i++) {
    /*
     * 範囲の端が「要素の子の何番目か」で示されることがある
     * （段落の先頭を選んだときなど）。その子に入る前に打ち切る。
     */
    if (stop && stop.node === node && stop.offset === i) {
      state.done = true;
      return;
    }
    count(children[i], stop, state);
    if (state.done) return;
  }
  if (stop && stop.node === node && stop.offset >= children.length) {
    state.done = true;
  }
}

/** かたまりの先頭から、その位置までが何文字目か。 */
function offsetIn(block: Element, node: Node, offset: number): number {
  const state = { at: 0, done: false };
  count(block, { node, offset }, state);
  return state.at;
}

/** その節点を含んでいる `.md-block` を探す。 */
function blockOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
  return (el as Element | null)?.closest?.('.md-block') ?? null;
}

/**
 * いま選ばれているところを、かたまりと文字の位置に直す。
 *
 * 選択が2つ以上のかたまりにまたがっているときは、**始めたほうのかたまり**の
 * 終わりまでを採る。ページをまたいで選ぶと意図しない範囲に印が付くので、
 * 「始めたところの段に付く」と決め打ちにしている。
 */
export function readSelection(root: HTMLElement): BlockSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const block = blockOf(range.startContainer);
  if (!block || !root.contains(block)) return null;
  const index = Number(block.dataset.b);
  if (!Number.isInteger(index)) return null;

  const start = offsetIn(block, range.startContainer, range.startOffset);

  let end: number;
  if (block.contains(range.endContainer)) {
    end = offsetIn(block, range.endContainer, range.endOffset);
  } else {
    // ほかのかたまりへ渡っている。この段の終わりまでにする。
    const state = { at: 0, done: false };
    count(block, null, state);
    end = state.at;
  }

  if (end <= start) return null;
  return { block: index, start, end, text: selection.toString() };
}

/** 画面から選択を消す（印を付けたあとに残っていると、次の操作が紛らわしい）。 */
export function clearSelection(): void {
  try {
    window.getSelection()?.removeAllRanges();
  } catch {
    /* 消せない環境でも実害はない */
  }
}
