import { useCallback, useEffect, useRef, useState } from 'react';
import { loadWork, saveWork } from './db';
import type { Novel } from '../types';

export type SaveState = 'idle' | 'saving' | 'saved';

/**
 * 作品を読み込み、変更を少し遅らせてまとめて保存する。
 * 執筆中は入力のたびに書き込まず、手が止まったところで保存することで
 * 端末への負荷を抑えている。画面を離れるときは即座に保存する。
 */
export function useWork(id: string | undefined) {
  const [work, setWork] = useState<Novel | null | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Novel | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadWork(id).then((w) => {
      if (cancelled) return;
      setWork(w ?? null);
      latest.current = w ?? null;
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current) {
      await saveWork(latest.current);
      setSaveState('saved');
    }
  }, []);

  const update = useCallback((updater: (w: Novel) => Novel) => {
    setWork((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      latest.current = next;
      setSaveState('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (latest.current) {
          void saveWork(latest.current).then(() => setSaveState('saved'));
        }
      }, 500);
      return next;
    });
  }, []);

  // 画面を離れる・アプリが背面に回るときは、待たずに保存する
  useEffect(() => {
    const onHide = () => {
      if (latest.current) void saveWork(latest.current);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (timer.current) {
        clearTimeout(timer.current);
        if (latest.current) void saveWork(latest.current);
      }
    };
  }, []);

  return { work, update, saveState, flush };
}
