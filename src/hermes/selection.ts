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

/**
 * 画面のその点が、かたまりの地の文の何文字目にあたるか。
 *
 * 二度押しで直す画面を開いたときに、押したところへ字を入れる印（カーソル）を
 * 置くために使う。取れなければ null を返し、呼んだ側は段の先頭に置く。
 */
export function offsetAtPoint(block: Element, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  try {
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    } else {
      const range = doc.caretRangeFromPoint?.(x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }
  } catch {
    return null;
  }
  if (!node || !block.contains(node)) return null;
  return offsetIn(block, node, offset);
}

/**
 * 画面に出ている、そのかたまりの地の文を読み取る。
 *
 * 数え方は上と同じ（ルビの読みは飛ばし、`<br>` は改行1文字）。
 * 本文の上でそのまま直せるようにしたので、**人が直したあとの文字**を
 * 画面から読み戻すのに使う。
 */
export function plainTextIn(root: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

/**
 * かたまりの中の「何文字目」のところに、字を入れる印（カーソル）を置く。
 *
 * 数え方は上と同じなので、`offsetAtPoint` で取った位置をそのまま渡せる。
 * 置けたら true。文字が足りないなどで置けなければ false を返す。
 */
export function placeCaret(block: Element, offset: number): boolean {
  let at = 0;
  let target: Text | null = null;
  let inside = 0;

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (at + len >= offset) {
        target = node as Text;
        inside = offset - at;
        return true;
      }
      at += len;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    if (SKIP.has(el.tagName)) return false;
    if (el.tagName === 'BR') {
      at += 1;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };

  if (!walk(block) || target === null) return false;
  try {
    const range = document.createRange();
    range.setStart(target, Math.max(0, Math.min(inside, (target as Text).length)));
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  } catch {
    return false;
  }
}
