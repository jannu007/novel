import { useEffect, useRef, useState } from 'react';
import { loadNovel, saveNovel } from '../db';
import type { Novel } from '../types';

export type SaveStatus = 'idle' | 'saving' | 'saved';

export function useNovel(id: string | undefined) {
  const [novel, setNovel] = useState<Novel | null | undefined>(undefined);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Novel | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    loadNovel(id).then((n) => {
      if (!cancelled) {
        setNovel(n ?? null);
        latest.current = n ?? null;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function update(updater: (n: Novel) => Novel) {
    setNovel((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      latest.current = next;
      scheduleSave();
      return next;
    });
  }

  function scheduleSave() {
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (latest.current) {
        await saveNovel(latest.current);
        setSaveStatus('saved');
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (latest.current) saveNovel(latest.current);
      }
    };
  }, []);

  return { novel, update, saveStatus };
}
