import { stripInline } from './inlineMarkup';

// 日本語の小説は「文字数」で分量を測るのが一般的なため、
// 空白・改行を除いた文字数をカウントする。ルビの読みは本文の分量には
// 含めないのが慣例なので、記法を取り除いてから数える。
export function countChars(text: string): number {
  return stripInline(text).replace(/\s/g, '').length;
}

export function countNovelChars(chapters: { content: string }[]): number {
  return chapters.reduce((sum, c) => sum + countChars(c.content), 0);
}

export function estimatePages(charCount: number, charsPerPage = 600): number {
  return Math.max(1, Math.ceil(charCount / charsPerPage));
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
