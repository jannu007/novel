import type { TrimSize } from '../types';

export const TRIM_SIZES: Record<
  TrimSize,
  { label: string; widthIn: number; heightIn: number; note: string }
> = {
  pocket: {
    label: '文庫サイズ相当',
    widthIn: 5,
    heightIn: 8,
    note: 'KDPペーパーバック公式トリムサイズ 5" x 8"',
  },
  a5: {
    label: 'A5相当',
    widthIn: 5.5,
    heightIn: 8.5,
    note: 'KDPペーパーバック公式トリムサイズ 5.5" x 8.5"',
  },
  b6: {
    label: '四六判相当',
    widthIn: 6,
    heightIn: 9,
    note: 'KDPペーパーバック公式トリムサイズ 6" x 9"',
  },
  kindle: {
    label: 'Kindle電子書籍（リフロー型）',
    widthIn: 0,
    heightIn: 0,
    note: '固定判型なし。画面サイズに合わせて自動的にレイアウトされます。',
  },
};
