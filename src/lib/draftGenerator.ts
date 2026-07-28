import type { Character, Novel, PlotPoint } from '../types';
import { countChars } from './textStats';

// あらすじ・キャラクター設定・プロットメモから、外部AIを使わず
// 端末内だけで起承転結それぞれ約200字の下書きを組み立てる。
// 同じ入力からは同じ結果になる（seed）が、「別バージョン」で
// variationを変えて別の組み合わせを試せる。

function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function ensurePeriod(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  if (/[。！？]$/.test(trimmed)) return trimmed;
  return `${trimmed}。`;
}

/** 文単位を積み上げ、目標文字数(target±tolerance)に収まるよう調整する */
function assemble(
  sentences: string[],
  fillers: string[],
  rng: () => number,
  target = 200,
  tolerance = 40
): string {
  let out = '';
  const pool = [...sentences];
  while (pool.length > 0 && countChars(out) < target + tolerance) {
    const next = ensurePeriod(pool.shift()!);
    if (countChars(out) + countChars(next) > target + tolerance && countChars(out) >= target - tolerance) {
      break;
    }
    out += next;
  }
  let lastFillerIdx = -1;
  let guard = 0;
  while (countChars(out) < target - tolerance && guard < 20) {
    guard++;
    let idx = Math.floor(rng() * fillers.length);
    if (fillers.length > 1) {
      let attempts = 0;
      while (idx === lastFillerIdx && attempts < 5) {
        idx = Math.floor(rng() * fillers.length);
        attempts++;
      }
    }
    lastFillerIdx = idx;
    out += ensurePeriod(fillers[idx]);
  }
  if (countChars(out) > target + tolerance) {
    const cut = splitSentences(out);
    let acc = '';
    for (const s of cut) {
      if (countChars(acc) >= target - tolerance && countChars(acc) + countChars(s) > target + tolerance) break;
      acc += s;
    }
    out = acc || out;
  }
  return out.trim();
}

interface Ctx {
  title: string;
  genre: string;
  protagonist: string;
  deuteragonist: string | null;
  antagonist: string | null;
  synopsis: string;
  characters: Character[];
  plotPoints: PlotPoint[];
}

function buildCtx(novel: Novel): Ctx {
  const protagonistChar =
    novel.characters.find((c) => c.role === '主人公') ?? novel.characters[0];
  const deuteragonistChar = novel.characters.find(
    (c) => c.role === 'ヒロイン' && c !== protagonistChar
  ) ?? novel.characters.find((c) => c !== protagonistChar && c.role !== '敵役');
  const antagonistChar = novel.characters.find((c) => c.role === '敵役');
  return {
    title: novel.title || '無題の物語',
    genre: novel.genre.trim(),
    protagonist: protagonistChar?.name || '主人公',
    deuteragonist: deuteragonistChar?.name || null,
    antagonist: antagonistChar?.name || null,
    synopsis: novel.synopsis.trim(),
    characters: novel.characters,
    plotPoints: novel.plotPoints,
  };
}

function buildKi(ctx: Ctx, rng: () => number): string {
  const genrePrefix = ctx.genre ? `${ctx.genre}の` : '';
  const leads = [
    `これは、${ctx.protagonist}をめぐる${genrePrefix}物語である。`,
    `${ctx.title}――それは${ctx.protagonist}にとって、忘れられない日々の記録だった。`,
    `${ctx.protagonist}の日常は、いつもと変わらないはずだった。`,
  ];
  const fillers = [
    `誰もがまだ、この先に何が待っているのかを知らなかった。`,
    `それは、ほんの小さな出来事から始まった。`,
    `${ctx.protagonist}自身、まだ気づいていなかった。`,
    `静かな時間が、もうすぐ終わろうとしていた。`,
    `${genrePrefix}物語は、いつもこんな風に始まるものなのかもしれない。`,
    `窓の外の景色は、いつもと変わらないように見えた。`,
  ];
  const sentences = [pick(rng, leads), ...splitSentences(ctx.synopsis)];
  return assemble(sentences, fillers, rng);
}

function buildSho(ctx: Ctx, rng: () => number): string {
  const sentences: string[] = [];
  const others = ctx.characters.filter((c) => c.name && c.name !== ctx.protagonist);
  if (others.length === 0) {
    sentences.push(
      `${ctx.protagonist}の周りには、いつもの顔ぶれがそろっていた。`,
      `変わらない毎日が、かけがえのないものであることに、まだ誰も気づいていない。`
    );
  }
  for (const c of others.slice(0, 3)) {
    const desc = c.summary || c.details || `${ctx.protagonist}にとって大切な存在`;
    sentences.push(`${c.name}（${c.role}）は、${desc}という人物だ。`);
  }
  if (ctx.deuteragonist) {
    sentences.push(`${ctx.protagonist}と${ctx.deuteragonist}の距離は、少しずつ近づいていく。`);
  }
  const fillers = [
    `些細な会話が、それぞれの関係を少しずつ変えていった。`,
    `誰もが、自分の役割を静かに演じていた。`,
    `けれど、その均衡はいつまでも続くものではなかった。`,
    `${ctx.protagonist}は、まだそのことに気づいていない。`,
    `見慣れた景色の中に、小さな違和感が紛れ込んでいた。`,
    `それでも毎日は、当たり前のように過ぎていく。`,
  ];
  return assemble(sentences, fillers, rng);
}

function buildTen(ctx: Ctx, rng: () => number): string {
  const active = ctx.plotPoints.filter((p) => p.status !== 'done');
  const sentences: string[] = [];
  if (active.length > 0) {
    for (const p of active.slice(0, 2)) {
      sentences.push(`そんな折、「${p.title}」が${ctx.protagonist}の前に立ちはだかる。`);
      if (p.detail) sentences.push(ensurePeriod(p.detail));
    }
  } else if (ctx.antagonist) {
    sentences.push(
      `そこに現れたのが${ctx.antagonist}だった。`,
      `${ctx.antagonist}の存在が、${ctx.protagonist}の運命を大きく揺さぶっていく。`
    );
  } else {
    sentences.push(
      `だが、平穏な日々は長くは続かなかった。`,
      `予期せぬ出来事が、${ctx.protagonist}の運命を大きく揺さぶる。`
    );
  }
  const fillers = [
    `後戻りはもう、できなかった。`,
    `${ctx.protagonist}は、選択を迫られる。`,
    `すべてが、少しずつ狂い始めていた。`,
    `誰にも、この先どうなるか分からなかった。`,
    `胸の奥で、何かが音を立てて崩れていく。`,
    `もう、引き返す道は残されていなかった。`,
  ];
  return assemble(sentences, fillers, rng);
}

function buildKetsu(ctx: Ctx, rng: () => number): string {
  const done = ctx.plotPoints.filter((p) => p.status === 'done');
  const sentences: string[] = [];
  if (done.length > 0) {
    for (const p of done.slice(0, 2)) {
      sentences.push(`やがて「${p.title}」は、${ctx.protagonist}の手で決着を迎える。`);
      if (p.detail) sentences.push(ensurePeriod(p.detail));
    }
  } else {
    sentences.push(
      `やがて${ctx.protagonist}は、自分なりの答えにたどり着く。`,
      `失ったものと、手に入れたもの――そのすべてが、${ctx.protagonist}を少しだけ変えていた。`
    );
  }
  if (ctx.deuteragonist) {
    sentences.push(`${ctx.deuteragonist}との絆だけは、最後まで変わらなかった。`);
  }
  const fillers = [
    `物語はここで幕を閉じるが、${ctx.protagonist}の日々はまだ続いていく。`,
    `振り返れば、すべてが必要な道のりだったのかもしれない。`,
    `${ctx.title}という物語は、こうして一つの区切りを迎えた。`,
    `それでも、明日はまた訪れる。`,
    `失くしたものの分だけ、${ctx.protagonist}は強くなれた気がした。`,
    `静かな余韻だけが、その場に残されていた。`,
  ];
  return assemble(sentences, fillers, rng);
}

export interface FourActDraft {
  ki: string;
  sho: string;
  ten: string;
  ketsu: string;
}

export const FOUR_ACT_LABELS: { key: keyof FourActDraft; title: string }[] = [
  { key: 'ki', title: '起' },
  { key: 'sho', title: '承' },
  { key: 'ten', title: '転' },
  { key: 'ketsu', title: '結' },
];

export function generateFourActDraft(novel: Novel, variation = 0): FourActDraft {
  const ctx = buildCtx(novel);
  const seedBase = hashString(`${novel.title}::${novel.synopsis}::${variation}`);
  return {
    ki: buildKi(ctx, mulberry32(seedBase ^ 0x11)),
    sho: buildSho(ctx, mulberry32(seedBase ^ 0x22)),
    ten: buildTen(ctx, mulberry32(seedBase ^ 0x33)),
    ketsu: buildKetsu(ctx, mulberry32(seedBase ^ 0x44)),
  };
}
