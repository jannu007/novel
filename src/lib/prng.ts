// 文字列から決定的なシード値を作る（同じ入力からは常に同じ結果になる）。
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// テンプレート文字列中の {token} を tokens[token] に置き換える。
// 該当キーが無ければそのまま残す（トークンの綴りミスに気づきやすくするため）。
export function fillTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in tokens ? tokens[key] : match
  );
}

/**
 * シャッフルバッグ：候補を毎回シャッフルして1巡し切ってから
 * 次の巡目に入るため、同じ要素が近い間隔で繰り返し出にくくなる
 * （単純なランダム抽選だと数回に1回は同じ文が連続してしまうため）。
 */
export function makeShuffleBag<T>(rng: () => number, items: T[]) {
  let bag: T[] = [];
  let lastItem: T | null = null;

  function refill() {
    bag = [...items];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (lastItem !== null && bag.length > 1 && bag[0] === lastItem) {
      [bag[0], bag[1]] = [bag[1], bag[0]];
    }
  }

  return function next(): T {
    if (bag.length === 0) refill();
    const item = bag.shift()!;
    lastItem = item;
    return item;
  };
}
