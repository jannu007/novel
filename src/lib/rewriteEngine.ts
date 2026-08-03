import type { Novel } from '../types';
import { hashString, mulberry32, pick } from './prng';

// 章の本文に対して「指示メニュー」を選ぶと、端末内のルールベース処理だけで
// 本文へ描写・会話・緊張感などを補ったり、余分な言い回しを整理したりする。
// 外部の生成AIは一切呼び出さず、通信も発生しない（起承転結の下書き生成と同じ方針）。

export interface RewriteInstruction {
  key: string;
  label: string;
  description: string;
}

export const REWRITE_INSTRUCTIONS: RewriteInstruction[] = [
  {
    key: 'scenery',
    label: '情景描写を増やす',
    description: '段落の合間に、場面の空気感や風景を伝える一文を補います。',
  },
  {
    key: 'emotion',
    label: '心情描写を増やす',
    description: '登場人物の内面の揺れを伝える一文を補います。',
  },
  {
    key: 'dialogue',
    label: '会話を増やす',
    description: '登場人物どうしの短いやり取りを段落間に補います。',
  },
  {
    key: 'tension',
    label: '緊迫感を高める',
    description: '章の終盤に向けて、緊張感を強める一文を差し込みます。',
  },
  {
    key: 'tighten',
    label: 'もっと簡潔にする',
    description: '重複した一文や余分な空行を整理して読みやすくします。',
  },
];

const SCENERY_SENTENCES = [
  '窓の外では、雲がゆっくりと形を変えていた。',
  '遠くから、かすかな風の音だけが聞こえていた。',
  '床に落ちた影が、時間の経過を静かに伝えていた。',
  '差し込む光の角度が、いつのまにか変わっていた。',
  '空気の匂いが、ほんの少しだけ変わった気がした。',
  '遠くの喧騒が、やけに他人事のように聞こえた。',
  '静寂の中に、時計の針の音だけが響いていた。',
  '窓ガラスに映る景色が、ゆっくりと流れていく。',
  '足元の影が、いつもより長く伸びていた。',
  '柔らかな風が、カーテンをそっと揺らした。',
  'どこか遠くで、聞き慣れない音が鳴った気がした。',
  '埃っぽい光が、部屋の隅まで届いていた。',
];

const EMOTION_TEMPLATES = [
  '{p}の胸の奥で、言葉にならない何かが揺れていた。',
  '{p}は、その感情にまだ名前をつけられずにいた。',
  'こみ上げてくる思いを、{p}はそっと飲み込んだ。',
  '{p}の心の中で、小さな迷いが顔を出した。',
  'それでも{p}は、表情を崩さずにいた。',
  '胸の奥に沈めていた思いが、ふいに顔を出した。',
  '{p}は、自分でも気づかぬうちに息を止めていた。',
  '説明のつかない胸騒ぎを、{p}は誰にも言えずにいた。',
];

const DIALOGUE_LINES = [
  '「――大丈夫？」',
  '「本当に、それでいいの？」',
  '「なんでもない。気にしないで。」',
  '「まだ、終わってないよ。」',
  '「ねえ、聞いてる？」',
  '「そんな顔しないで。」',
  '「これから、どうするつもり？」',
  '「大丈夫、ちゃんとそばにいるから。」',
];

const DIALOGUE_ATTRIBUTIONS = [
  '{o}は、そっとそう言った。',
  '{o}の声は、いつもより小さかった。',
  '{p}は、その言葉に小さくうなずいた。',
  '沈黙のあと、{o}がぽつりとつぶやいた。',
  '{p}は、すぐには答えられなかった。',
];

const TENSION_SENTENCES = [
  '胸騒ぎが、次第に大きくなっていく。',
  '何かが、確実に狂い始めていた。',
  'このまま何も起きないはずがない、と{p}は感じていた。',
  '張り詰めた空気が、その場を包んでいた。',
  '後戻りは、もうできない気がした。',
  '鼓動が、いつもより速く感じられた。',
  '静けさの中に、不穏な気配だけが漂っていた。',
  '{p}の中で、何かが確かに変わろうとしていた。',
];

// 単独行としてよく紛れ込みがちな、それ自体には意味を持たないつなぎ言葉。
// これらと完全一致する行のみを間引き対象とする（誤って本文を壊さないよう厳格に一致判定）。
const FILLER_STANDALONE_LINES = new Set([
  'そして。',
  'それから。',
  'ふと。',
  'すると。',
  'それにしても。',
  'ところで。',
]);

interface RewriteCtx {
  protagonist: string;
  other: string | null;
}

function buildRewriteCtx(novel: Novel): RewriteCtx {
  const protagonistChar =
    novel.characters.find((c) => c.role === '主人公') ?? novel.characters[0];
  const otherChar = novel.characters.find(
    (c) => c.id !== protagonistChar?.id && c.name
  );
  return {
    protagonist: protagonistChar?.name || '主人公',
    other: otherChar?.name || null,
  };
}

function fillTemplate(template: string, ctx: RewriteCtx): string {
  return template.replace(/\{p\}/g, ctx.protagonist).replace(/\{o\}/g, ctx.other ?? '相手');
}

/**
 * 本文（改行区切り）の空行ではない行の後に、一定確率で生成した行を挿し込む。
 * 挿入数には上限を設け、短い章で不自然に文章量が膨らみすぎないようにする。
 */
function insertAfterParagraphs(
  lines: string[],
  rng: () => number,
  rate: number,
  maxInsertions: number,
  genLines: () => string[]
): string {
  const out: string[] = [];
  let inserted = 0;
  for (const line of lines) {
    out.push(line);
    if (
      line.trim() !== '' &&
      inserted < maxInsertions &&
      rng() < rate
    ) {
      out.push(...genLines());
      inserted++;
    }
  }
  return out.join('\n');
}

function addScenery(content: string, rng: () => number): string {
  const lines = content.split(/\r?\n/);
  return insertAfterParagraphs(lines, rng, 0.35, 6, () => [pick(rng, SCENERY_SENTENCES)]);
}

function addEmotion(content: string, rng: () => number, ctx: RewriteCtx): string {
  const lines = content.split(/\r?\n/);
  return insertAfterParagraphs(lines, rng, 0.35, 6, () => [
    fillTemplate(pick(rng, EMOTION_TEMPLATES), ctx),
  ]);
}

function addDialogue(content: string, rng: () => number, ctx: RewriteCtx): string {
  const lines = content.split(/\r?\n/);
  return insertAfterParagraphs(lines, rng, 0.3, 5, () => [
    pick(rng, DIALOGUE_LINES),
    fillTemplate(pick(rng, DIALOGUE_ATTRIBUTIONS), ctx),
  ]);
}

/**
 * 終盤（本文行の後半3分の1）に絞って緊迫感を高める一文を差し込む。
 * 該当する行が全くない極端に短い章では、最後に1文だけ追加する。
 */
function raiseTension(content: string, rng: () => number, ctx: RewriteCtx): string {
  const lines = content.split(/\r?\n/);
  const nonBlankIdx = lines
    .map((l, i) => (l.trim() !== '' ? i : -1))
    .filter((i) => i >= 0);
  if (nonBlankIdx.length === 0) return content;
  const cutoff = nonBlankIdx[Math.floor(nonBlankIdx.length * (2 / 3))];
  const out: string[] = [];
  let inserted = 0;
  lines.forEach((line, i) => {
    out.push(line);
    if (line.trim() !== '' && i >= cutoff && inserted < 4 && rng() < 0.5) {
      out.push(fillTemplate(pick(rng, TENSION_SENTENCES), ctx));
      inserted++;
    }
  });
  if (inserted === 0) {
    out.push(fillTemplate(pick(rng, TENSION_SENTENCES), ctx));
  }
  return out.join('\n');
}

/**
 * 安全側に倒した簡潔化：本文の意味を変えうる文の削除は行わず、
 * 完全一致するつなぎ言葉だけの行・連続する重複行・余分な空行の整理にとどめる。
 */
function tighten(content: string): string {
  const rawLines = content.split(/\r?\n/).map((l) => l.replace(/[ \t　]+$/, ''));
  const out: string[] = [];
  let prevNonBlank: string | null = null;
  let blankRun = 0;
  for (const line of rawLines) {
    if (line.trim() === '') {
      blankRun++;
      if (blankRun > 1) continue;
      out.push(line);
      continue;
    }
    blankRun = 0;
    if (FILLER_STANDALONE_LINES.has(line.trim())) continue;
    if (line === prevNonBlank) continue;
    out.push(line);
    prevNonBlank = line;
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

export function applyRewriteInstruction(
  content: string,
  instructionKey: string,
  novel: Novel,
  seedExtra = 0
): string {
  const ctx = buildRewriteCtx(novel);
  const seed = hashString(`${novel.id}::${instructionKey}::${seedExtra}::${content.length}`);
  const rng = mulberry32(seed);
  switch (instructionKey) {
    case 'scenery':
      return addScenery(content, rng);
    case 'emotion':
      return addEmotion(content, rng, ctx);
    case 'dialogue':
      return addDialogue(content, rng, ctx);
    case 'tension':
      return raiseTension(content, rng, ctx);
    case 'tighten':
      return tighten(content);
    default:
      return content;
  }
}
