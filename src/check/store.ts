/**
 * このアプリが端末に置くのは、配色（明暗）の好みだけ。
 * 読み込んだEPUBそのものは、どんな設定でも一切保存しない（メモリの中だけで扱い、
 * タブを閉じれば消える）。
 */

export type ThemeMode = 'auto' | 'light' | 'dark';

const THEME_KEY = 'kenpinjo:theme';

export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: '端末に合わせる',
  light: '明るい',
  dark: '暗い',
};

export function readTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  localStorage.setItem(THEME_KEY, mode);
}

export function initTheme() {
  applyTheme(readTheme());
}
