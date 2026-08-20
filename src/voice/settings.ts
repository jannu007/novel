/**
 * 聴き方の設定（速さ・声・配色など）。
 * 端末の中（localStorage）だけに保存する。
 */

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SEGMENT, type SegmentOptions } from './segment';

export type Palette = 'auto' | 'paper' | 'sepia' | 'night';

export interface Settings {
  /** 話す速さ */
  rate: number;
  /** 声の高さ */
  pitch: number;
  /** 音の大きさ */
  volume: number;
  /** 使う声の名前（端末の中で話す声だけが入る） */
  voiceName: string;
  palette: Palette;
  /** 読み上げに合わせて画面を送る */
  follow: boolean;
  /** 読み上げ中は画面を消さない */
  awake: boolean;
  /** 本文の字の大きさ（px） */
  size: number;
  /** 何を読み上げるか */
  segment: SegmentOptions;
}

export const DEFAULT_SETTINGS: Settings = {
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceName: '',
  palette: 'auto',
  follow: true,
  awake: true,
  size: 18,
  segment: DEFAULT_SEGMENT,
};

export const RATE_RANGE = { min: 0.5, max: 2, step: 0.05 };
export const PITCH_RANGE = { min: 0.5, max: 1.5, step: 0.05 };
export const SIZE_RANGE = { min: 14, max: 28, step: 1 };

export const PALETTE_LABEL: Record<Palette, string> = {
  auto: '端末に合わせる',
  paper: '紙',
  sepia: '古書',
  night: '夜',
};

const KEY = 'kataribe:settings';

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : fallback;
}

/** 保存されている値が壊れていても、必ず正しい範囲の設定に直してから使う。 */
function sanitize(v: Partial<Settings>): Settings {
  const seg: Partial<SegmentOptions> = v.segment ?? {};
  return {
    rate: clamp(v.rate, RATE_RANGE.min, RATE_RANGE.max, DEFAULT_SETTINGS.rate),
    pitch: clamp(v.pitch, PITCH_RANGE.min, PITCH_RANGE.max, DEFAULT_SETTINGS.pitch),
    volume: clamp(v.volume, 0, 1, DEFAULT_SETTINGS.volume),
    voiceName: typeof v.voiceName === 'string' ? v.voiceName : '',
    palette:
      v.palette === 'paper' || v.palette === 'sepia' || v.palette === 'night'
        ? v.palette
        : 'auto',
    follow: typeof v.follow === 'boolean' ? v.follow : DEFAULT_SETTINGS.follow,
    awake: typeof v.awake === 'boolean' ? v.awake : DEFAULT_SETTINGS.awake,
    size: clamp(v.size, SIZE_RANGE.min, SIZE_RANGE.max, DEFAULT_SETTINGS.size),
    segment: {
      headings: typeof seg.headings === 'boolean' ? seg.headings : DEFAULT_SEGMENT.headings,
      code: typeof seg.code === 'boolean' ? seg.code : DEFAULT_SEGMENT.code,
      tables: typeof seg.tables === 'boolean' ? seg.tables : DEFAULT_SEGMENT.tables,
    },
  };
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
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
      /* 保存できない設定（プライベートモードなど）でも朗読は続けられる */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => sanitize({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setSettings((prev) => ({ ...DEFAULT_SETTINGS, voiceName: prev.voiceName }));
  }, []);

  return { settings, update, reset };
}
