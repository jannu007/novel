/**
 * 「アプリとして入れられます」というブラウザからの知らせを受け止める。
 * 仕組みは「製本所」（src/md/install.ts）と同じ。詳しい理由はそちらのコメントを参照。
 */

import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** アプリの起動時に一度だけ呼ぶ。 */
export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null && !installed,
    () => false
  );
}

export function useInstalled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => installed,
    () => false
  );
}

/** インストールの確認を出す（利用者が押した操作の中から呼ぶこと）。 */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  await event.prompt();
  await event.userChoice;
  deferred = null;
  notify();
}
