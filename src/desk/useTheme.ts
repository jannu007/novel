import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'paper' | 'ink';

const KEY = 'fuzukue:theme';
const ORDER: ThemeMode[] = ['auto', 'paper', 'ink'];

export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: '端末に合わせる',
  paper: '紙（明るい）',
  ink: '墨（暗い）',
};

function read(): ThemeMode {
  const stored = localStorage.getItem(KEY);
  return stored === 'paper' || stored === 'ink' ? stored : 'auto';
}

/** `data-theme` を付け外しするだけで、配色はすべてCSS側で切り替わる。 */
function apply(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function initTheme() {
  apply(read());
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(read);

  useEffect(() => {
    apply(mode);
    localStorage.setItem(KEY, mode);
  }, [mode]);

  const cycle = useCallback(() => {
    setMode((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]);
  }, []);

  return { mode, setMode, cycle };
}
