import { get, set } from 'idb-keyval';

// 起承転結の自動下書き生成・章のAIリライトで使った定型フレーズを、
// 作品をまたいで端末内（IndexedDB）だけに記録しておく。次回以降の生成では
// まだ使っていないフレーズを優先することで、複数の作品間での言い回しの
// 重複を減らす。外部には一切送信しない。

const HISTORY_KEY = 'phraseHistory:v1';
const MAX_ENTRIES = 6000;

let cache: Set<string> | null = null;

export async function loadPhraseHistory(): Promise<Set<string>> {
  if (cache) return cache;
  const stored = (await get<string[]>(HISTORY_KEY)) ?? [];
  cache = new Set(stored);
  return cache;
}

export async function recordPhraseUsage(templates: Iterable<string>): Promise<void> {
  const history = await loadPhraseHistory();
  for (const t of templates) history.add(t);
  let list = Array.from(history);
  if (list.length > MAX_ENTRIES) {
    // 挿入順を保つSetの性質を利用し、古いものから捨てる（FIFO）。
    list = list.slice(list.length - MAX_ENTRIES);
  }
  cache = new Set(list);
  await set(HISTORY_KEY, list);
}

/**
 * 候補一覧のうち、まだ一度も使っていないものを優先したプールを返す。
 * 未使用の候補が少なすぎる場合（残り物が偏る／すべて使用済み）は、
 * 全候補にフォールバックしてバリエーション不足を防ぐ。
 */
export function preferUnused<T>(
  candidates: T[],
  avoid: Set<string>,
  keyOf: (item: T) => string,
  minFreshCount = 5
): T[] {
  const fresh = candidates.filter((item) => !avoid.has(keyOf(item)));
  return fresh.length >= Math.min(minFreshCount, candidates.length) ? fresh : candidates;
}
