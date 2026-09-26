/**
 * 「ムネモシュネ」の原稿を保存する場所。
 *
 * 取り込んだ原稿は、この端末のブラウザの中（IndexedDB）だけに保存される。
 * サーバーへ送る処理はアプリのどこにも無く、通信そのものを行わない。
 * 栞（読むだけのアプリ）とは別のデータベースなので、
 * 直しかけの原稿が本棚に紛れ込むことはない。
 */

import { get, set, del, keys, createStore } from 'idb-keyval';

const store = createStore('mnemosyne', 'drafts');

const DRAFT_PREFIX = 'draft:';
const draftKey = (id: string) => `${DRAFT_PREFIX}${id}`;

/** 印の種類。読みながら付けるので、指一本で選べる数にとどめている。 */
export type MarkKind = 'fix' | 'question' | 'good' | 'note';

export const MARK_LABEL: Record<MarkKind, string> = {
  fix: '直す',
  question: '疑問',
  good: '良い',
  note: '覚書',
};

export const MARK_HINT: Record<MarkKind, string> = {
  fix: 'あとで直すところ',
  question: '確かめたいところ',
  good: '残したいところ',
  note: '書き添えておくこと',
};

export const MARK_KINDS: MarkKind[] = ['fix', 'question', 'good', 'note'];

/**
 * 本文に付けた印。
 *
 * 場所は「何章の何番目のかたまりの、地の文で何文字目から何文字目まで」で覚える。
 * 原稿を直すとかたまりの番号も文字の位置もずれるので、そのときの文字（`quote`）も
 * 一緒に残しておき、ずれていたら探し直す（`src/mnemo/draft.ts` の `reanchor`）。
 */
export interface Mark {
  id: string;
  kind: MarkKind;
  chapter: number;
  block: number;
  /** かたまりの地の文の中での位置 */
  start: number;
  end: number;
  /** 印を付けた文字そのもの。場所がずれたときに探し直す手がかりになる。 */
  quote: string;
  /** 書き添えたひとこと */
  note: string;
  at: number;
}

/** 直した記録。取り消せるように、直す前の文も残す。 */
export interface Revision {
  id: string;
  /** 直した段が、原文の何行目から何行目までだったか */
  from: number;
  to: number;
  before: string;
  after: string;
  /** 一覧に見せる書き出し */
  excerpt: string;
  at: number;
}

/** 読んでいた場所。字の大きさを変えても続きから読めるよう、ページ番号では覚えない。 */
export interface ReadingPosition {
  chapter: number;
  block: number;
  offset?: number;
  ratio: number;
  at: number;
}

export interface DraftRecord {
  id: string;
  title: string;
  author: string;
  /** いま（直したあと）の原稿。書き出すとこれがそのまま出る。 */
  source: string;
  /** 取り込んだときの原稿。どれだけ直したかを見せ、元に戻すために残す。 */
  original: string;
  fileName: string;
  chars: number;
  addedAt: number;
  openedAt: number;
  position?: ReadingPosition;
  marks: Mark[];
  history: Revision[];
  /** 表紙代わりの見た目を決める種（題名から作る） */
  seed: number;
}

/** 保存されている形が古くても落ちないように、足りないものを補って返す。 */
function normalize(draft: DraftRecord): DraftRecord {
  return {
    ...draft,
    marks: draft.marks ?? [],
    history: draft.history ?? [],
    original: draft.original ?? draft.source,
  };
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const allKeys = await keys(store);
  const draftKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(DRAFT_PREFIX)
  );
  const drafts = await Promise.all(draftKeys.map((k) => get<DraftRecord>(k, store)));
  return drafts
    .filter((d): d is DraftRecord => Boolean(d))
    .map(normalize)
    .sort((a, b) => b.openedAt - a.openedAt);
}

export async function loadDraft(id: string): Promise<DraftRecord | undefined> {
  const draft = await get<DraftRecord>(draftKey(id), store);
  return draft ? normalize(draft) : undefined;
}

export async function saveDraft(draft: DraftRecord): Promise<void> {
  await set(draftKey(draft.id), draft, store);
}

export async function deleteDraft(id: string): Promise<void> {
  await del(draftKey(id), store);
}

/** 原稿をすべて消す（設定の「すべて削除」用）。 */
export async function clearDrafts(): Promise<void> {
  const allKeys = await keys(store);
  await Promise.all(
    allKeys
      .filter((k): k is string => typeof k === 'string' && k.startsWith(DRAFT_PREFIX))
      .map((k) => del(k, store))
  );
}

/**
 * 原稿を「消さないで」とブラウザに頼む。
 *
 * ブラウザの保存領域は、既定では**いつ消されてもよい扱い**になっている。
 * 端末の空きが減ったときなどに、ブラウザの判断でまるごと捨てられることがある。
 * 直しかけの原稿が消えるのはとくに痛いので、開くたびに静かに頼んでおく。
 * 断られても実害はない。
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

/** 保存の状態（「保存データ」に出す）。 */
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

/** 題名から見た目の種を作る（同じ題名ならいつも同じ色になる）。 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
