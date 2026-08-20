/**
 * 「語り部」の書棚を保存する場所。
 *
 * 取り込んだ本は、この端末のブラウザの中（IndexedDB）だけに保存される。
 * サーバーへ送る処理はアプリのどこにも無く、通信そのものを行わない。
 * 同じリポジトリの他のアプリとは別のデータベースなので、混ざることもない。
 *
 * ■ 保存できない場所でも動く
 *
 * 1ファイル版（`file://` で開くもの）では、ブラウザが IndexedDB を
 * 使わせてくれない。保存する先が無いからといって朗読できないのでは困るので、
 * その場合は**画面を閉じるまでのあいだ、記憶の中だけ**に置く。
 *
 * これは劣化ではなく、いちばん安全な状態でもある。端末に何も残らないので、
 * 端末を後から調べられても本の中身は出てこない。どちらで動いているかは
 * `isEphemeral()` で分かり、設定画面に出している。
 */

import { get, set, del, keys, createStore } from 'idb-keyval';

const store = createStore('kataribe', 'books');

const BOOK_PREFIX = 'book:';
const bookKey = (id: string) => `${BOOK_PREFIX}${id}`;

/** 保存が使えないと分かったあとの置き場（画面を閉じると消える）。 */
const memory = new Map<string, VoiceBook>();
let ephemeral = false;

/** いま「端末に何も残さない」状態で動いているか。 */
export function isEphemeral(): boolean {
  return ephemeral;
}

/**
 * IndexedDB を試し、使えなければ記憶の中で済ませる。
 * 一度でも断られたら、以後は試さない（毎回の失敗で待たされないように）。
 */
async function withStore<T>(run: () => Promise<T>, fallback: () => T): Promise<T> {
  if (ephemeral) return fallback();
  try {
    return await run();
  } catch {
    ephemeral = true;
    return fallback();
  }
}

/** どこまで聴いたか。文の番号で覚える。 */
export interface ListeningPosition {
  /** 読み上げる文の並びの何番目か */
  line: number;
  /** 本全体のどのあたりか（0〜1）。書棚に進み具合を出すために使う。 */
  ratio: number;
  at: number;
}

export interface VoiceBook {
  id: string;
  title: string;
  author: string;
  /** 取り込んだ Markdown そのもの。 */
  source: string;
  fileName: string;
  chars: number;
  addedAt: number;
  openedAt: number;
  position?: ListeningPosition;
  /** 表紙の見た目を決める種（題名から作る） */
  seed: number;
}

export async function listBooks(): Promise<VoiceBook[]> {
  const sort = (books: VoiceBook[]) => books.sort((a, b) => b.openedAt - a.openedAt);
  return withStore(
    async () => {
      const allKeys = await keys(store);
      const bookKeys = allKeys.filter(
        (k): k is string => typeof k === 'string' && k.startsWith(BOOK_PREFIX)
      );
      const books = await Promise.all(bookKeys.map((k) => get<VoiceBook>(k, store)));
      return sort(books.filter((b): b is VoiceBook => Boolean(b)));
    },
    () => sort([...memory.values()])
  );
}

export async function loadBook(id: string): Promise<VoiceBook | undefined> {
  return withStore(
    () => get<VoiceBook>(bookKey(id), store),
    () => memory.get(id)
  );
}

export async function saveBook(book: VoiceBook): Promise<void> {
  // 記憶の中にも必ず置く。保存が途中で使えなくなっても、聴いている本は見失わない。
  memory.set(book.id, book);
  await withStore(
    () => set(bookKey(book.id), book, store),
    () => undefined
  );
}

export async function deleteBook(id: string): Promise<void> {
  memory.delete(id);
  await withStore(
    () => del(bookKey(id), store),
    () => undefined
  );
}

/** 書棚をまるごと空にする。 */
export async function clearLibrary(): Promise<void> {
  memory.clear();
  await withStore(
    async () => {
      const allKeys = await keys(store);
      await Promise.all(
        allKeys
          .filter((k): k is string => typeof k === 'string' && k.startsWith(BOOK_PREFIX))
          .map((k) => del(k, store))
      );
    },
    () => undefined
  );
}

/**
 * 書棚を「消さないで」とブラウザに頼む。
 * ブラウザの保存領域は既定では「いつ消してもよい」扱いで、端末の空きが
 * 減ったときに捨てられることがある。この宣言でその対象から外れる。
 */
export async function keepStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 保存の状態（設定に出す）。 */
export async function storageInfo(): Promise<{ kept: boolean; used: string }> {
  let kept = false;
  let used = '不明';
  try {
    kept = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* 分からなければ「未設定」として扱う */
  }
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage !== undefined) {
      const mb = estimate.usage / 1024 / 1024;
      used = mb < 1 ? `${Math.round(estimate.usage / 1024)} KB` : `${mb.toFixed(1)} MB`;
    }
  } catch {
    /* 同上 */
  }
  return { kept, used };
}

/** 題名から表紙の種を作る（同じ題名なら必ず同じ表紙になる）。 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
