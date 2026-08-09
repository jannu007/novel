import { inlineSafeBoundaries, inlineToHtml } from './inlineMarkup';
import { escapeHtml } from './htmlContent';

/**
 * 章本文を縦書きリーダー用のテキストに変換する。
 * 改行は強制的な段区切りにはせず、全角スペースの字下げで
 * 連続した縦書きの流れに変換する（実際の書籍の組版に近い見た目にするため）。
 * ルビ・傍点の記法はそのまま残し、表示時にHTMLへ展開する。
 */
export function toReadableText(content: string): string {
  const lines = content.split(/\r?\n/);
  const parts: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      blankRun++;
      continue;
    }
    if (blankRun > 0 && parts.length > 0) {
      parts.push('　　＊　　');
    }
    blankRun = 0;
    parts.push(`　${trimmed}`);
  }
  const joined = parts.join('');
  return joined || '　（本文がありません）';
}

/** リーダーの1ページぶんのテキストを表示用HTMLに変換する。 */
export function readableToHtml(text: string): string {
  return inlineToHtml(text, { escape: escapeHtml });
}

function fits(el: HTMLElement, text: string, maxWidth: number): boolean {
  el.innerHTML = readableToHtml(text);
  return el.clientWidth <= maxWidth;
}

/**
 * 縦書き・自動幅の測定用DOM要素で二分探索しながら、指定した幅を
 * 超えない最大文字数ごとにテキストを分割する。
 * 測定要素は幅を固定せず(display:inline-block)、高さだけを
 * 実際のページと合わせることで、この要素自身の内容幅(clientWidth)を
 * 「その文字数を1ページに収めるのに必要な幅」として利用できる。
 * フォントの実測に基づくため、文字数の見積もり計算より正確。
 *
 * ルビは親文字の横に組まれてページ幅を押し広げるので、測定でも記法を
 * 展開したHTMLを流し込む。あわせて、ルビ・傍点の記法の途中で
 * ページが切れないよう、分割位置を安全な境界まで戻している。
 */
export function paginateVertical(
  el: HTMLElement,
  text: string,
  maxWidth: number
): string[] {
  const pages: string[] = [];
  let remaining = text;
  let offset = 0;
  const safe = inlineSafeBoundaries(text);
  let guard = 0;

  while (remaining.length > 0 && guard < 1000) {
    guard++;
    if (fits(el, remaining, maxWidth)) {
      pages.push(remaining);
      break;
    }
    let lo = 1;
    let hi = remaining.length;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(el, remaining.slice(0, mid), maxWidth)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best === 0) best = 1; // 1文字も収まらない場合でも必ず前進する
    // 記法の内側で切れていたら、その手前の安全な位置まで戻す
    let cut = best;
    while (cut > 1 && !safe.has(offset + cut)) cut--;
    // 長いルビが1ページに収まりきらない場合は、やむを得ず元の位置で切る
    if (!safe.has(offset + cut)) cut = best;
    pages.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
    offset += cut;
  }
  el.innerHTML = '';
  return pages.length > 0 ? pages : [''];
}
