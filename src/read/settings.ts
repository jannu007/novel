/**
 * 読み方の設定（縦横・字の大きさ・配色など）。
 * 端末の中（localStorage）だけに保存する。
 */

import { useCallback, useEffect, useState } from 'react';

export type Palette = 'auto' | 'paper' | 'sepia' | 'night';
export type FontKind = 'mincho' | 'gothic';
export type Margin = 'narrow' | 'normal' | 'wide';

export interface Settings {
  /** 縦書き（右から左）で読む */
  vertical: boolean;
  font: FontKind;
  /** 本文の字の大きさ（px） */
  size: number;
  /** 行送り（字の大きさに対する倍率） */
  leading: number;
  margin: Margin;
  palette: Palette;
  /** ページをめくるときの動き */
  animate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  vertical: true,
  font: 'mincho',
  size: 19,
  leading: 1.9,
  margin: 'normal',
  palette: 'auto',
  animate: true,
};

export const SIZE_RANGE = { min: 14, max: 30, step: 1 };
export const LEADING_RANGE = { min: 1.5, max: 2.6, step: 0.1 };

export const MARGIN_PX: Record<Margin, number> = {
  narrow: 16,
  normal: 30,
  wide: 52,
};

export const PALETTE_LABEL: Record<Palette, string> = {
  auto: '端末に合わせる',
  paper: '紙',
  sepia: '古書',
  night: '夜',
};

export const FONT_LABEL: Record<FontKind, string> = {
  mincho: '明朝',
  gothic: 'ゴシック',
};

const KEY = 'shiori:settings';

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return sanitize(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 保存されている値が壊れていても、必ず正しい範囲の設定に直してから使う。 */
function sanitize(v: Partial<Settings>): Settings {
  const clamp = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  return {
    vertical: typeof v.vertical === 'boolean' ? v.vertical : DEFAULT_SETTINGS.vertical,
    font: v.font === 'gothic' ? 'gothic' : 'mincho',
    size: clamp(v.size, SIZE_RANGE.min, SIZE_RANGE.max, DEFAULT_SETTINGS.size),
    leading: clamp(v.leading, LEADING_RANGE.min, LEADING_RANGE.max, DEFAULT_SETTINGS.leading),
    margin: v.margin === 'narrow' || v.margin === 'wide' ? v.margin : 'normal',
    palette:
      v.palette === 'paper' || v.palette === 'sepia' || v.palette === 'night'
        ? v.palette
        : 'auto',
    animate: typeof v.animate === 'boolean' ? v.animate : DEFAULT_SETTINGS.animate,
  };
}

/** 配色は `data-palette` を付け替えるだけで、色の指定はすべてCSS側にある。 */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  if (palette === 'auto') root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', palette);
}

export function initSettings(): void {
  applyPalette(read().palette);
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(read);

  useEffect(() => {
    applyPalette(settings.palette);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* 保存できない設定（プライベートモードなど）でも読書は続けられる */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => sanitize({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return { settings, update, reset };
}
