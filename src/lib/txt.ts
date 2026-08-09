import { saveAs } from 'file-saver';
import type { Novel } from '../types';
import { stripInline } from './inlineMarkup';

/**
 * @param keepMarkup ルビ・傍点記法をそのまま残すか。小説投稿サイトへ
 *   貼り付ける場合は残し、純粋な本文だけが欲しい場合は取り除く。
 */
export function generateTxt(novel: Novel, keepMarkup = true): void {
  const chapters = [...novel.chapters].sort((a, b) => a.order - b.order);
  const parts: string[] = [];
  parts.push(novel.title || '無題の小説');
  if (novel.author || novel.penName) {
    parts.push(novel.author || novel.penName);
  }
  parts.push('');
  for (const ch of chapters) {
    parts.push('');
    parts.push('　');
    parts.push(ch.title || '');
    parts.push('');
    parts.push(keepMarkup ? ch.content : stripInline(ch.content));
  }
  const text = parts.join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, `${novel.title || 'novel'}.txt`);
}

export function generateBackupJson(novel: Novel): void {
  const blob = new Blob([JSON.stringify(novel, null, 2)], {
    type: 'application/json',
  });
  saveAs(blob, `${novel.title || 'novel'}-backup.json`);
}
