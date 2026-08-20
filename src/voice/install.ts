/**
 * 「アプリとして入れられます」というブラウザからの知らせを受け止める。
 *
 * この知らせ（beforeinstallprompt）は、ページを開いてすぐ、画面を組み立てるより
 * 前に届くことがある。あとから待ち受けても二度は届かないので、
 * アプリの起動のいちばん最初（main.tsx）でここを呼び、受け止めておく。
 *
 * なお、ブラウザは「開いただけで勝手に入れる」ことを認めていない。
 * 入れるかどうかの確認は、利用者が押した操作からしか始められない決まりで、
 * これは安全のための仕組みなので、ページ側からは越えられない。
 * このアプリにできるのは、開いてすぐ案内を出し、一度押せば入る状態にしておくこと。
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
    // ブラウザ既定の案内を止め、こちらの画面で出す
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

/** いま入れられるか（＝ブラウザから知らせが届いているか）。 */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null && !installed,
    () => false
  );
}

/** 入れ終わったか。 */
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

/** すでにアプリとして開いているか。 */
export function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS Safari は独自の目印を持つ
    return (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** iPhone・iPadか（そこだけ入れ方が違うため）。 */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
