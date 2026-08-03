import type { Novel } from '../types';
import { hashString, mulberry32, pick, fillTemplate } from './prng';
import { preferUnused } from './phraseHistory';
import { fallbackName } from './fallbackNames';

// 章の本文に対して「指示メニュー」を選ぶと、端末内のルールベース処理だけで
// 本文へ描写・会話・緊張感などを補ったり、余分な言い回しを整理したりする。
// 外部の生成AIは一切呼び出さず、通信も発生しない（起承転結の下書き生成と同じ方針）。
//
// 各カテゴリのフレーズは {p}（主人公名）・{o}（相手役の名）を含むテンプレートとして
// 持ち、選んだテンプレート（置換前の文字列）を phraseHistory.ts に記録することで、
// 作品をまたいだ言い回しの重複を減らせるようにしている。

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
  '遠くの鳥の声が、静けさに彩りを添えていた。',
  '光と影の境目が、いつのまにかぼやけていた。',
  '壁時計の秒針の音だけが、やけに大きく響いていた。',
  '窓の外の木々が、風に合わせて静かに揺れていた。',
  '遠くの車の音が、波のように寄せては引いていった。',
  '部屋の隅に溜まった埃が、光の筋に浮かび上がっていた。',
  '曇りガラス越しの景色が、ぼんやりと滲んで見えた。',
  '遠くの空が、じわりと色を変え始めていた。',
  '床板のきしむ音が、静寂の中でやけに響いた。',
  '開いたままの窓から、遠くの匂いが流れ込んできた。',
  '灯りの届かない部屋の隅に、影がじっと佇んでいた。',
  '雨粒が窓を叩く音が、規則正しく続いていた。',
  '遠くの踏切の音が、風に乗って微かに届いた。',
  '陽だまりの中で、埃がゆっくりと舞っていた。',
  '静かな部屋に、時折り軋む床の音だけが響いた。',
  '遠くの雲が、ゆっくりと形を変えながら流れていった。',
  'カーテン越しの光が、部屋全体を淡く染めていた。',
  '誰もいない廊下に、足音の残響だけが漂っていた。',
  '遠くの喧騒が、まるで別世界のことのように感じられた。',
  '窓辺に置かれた花が、静かに香りを漂わせていた。',
  '夕暮れの色が、部屋の壁をゆっくりと染めていった。',
  '冷たい空気が、肌に微かに触れていった。',
  'どこか遠くで、犬の鳴き声が短く響いた。',
  '静まり返った部屋に、呼吸の音だけが響いていた。',
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
  '{p}は、うまく言葉にできない感情を持て余していた。',
  '心の奥に押し込めていた不安が、静かに顔を出した。',
  '{p}は、自分の気持ちに戸惑いを隠せずにいた。',
  '何かが引っかかるような感覚を、{p}は拭えずにいた。',
  '{p}の中で、期待と不安が入り混じっていた。',
  '表には出さないものの、{p}の心は揺れ動いていた。',
  '{p}は、誰にも気づかれないよう静かに息を吐いた。',
  '言葉にならない想いが、{p}の胸の中で渦を巻いていた。',
  '{p}は、その感情の正体をまだ掴みかねていた。',
  'ふとした瞬間、{p}の心に小さな影がよぎった。',
  '{p}は、平静を装いながらも内心穏やかではなかった。',
  '込み上げる感情を、{p}はどうにか飲み込んだ。',
  '{p}の胸には、言い表せない重さが残っていた。',
  '誰にも打ち明けられない不安を、{p}はそっと抱えていた。',
  '{p}は、自分でも驚くほど心が乱れているのを感じた。',
  'その感情に、{p}はまだ名前をつけられずにいた。',
  '{p}の心の奥底で、小さな炎が静かに揺れていた。',
  '言葉にすれば崩れてしまいそうで、{p}は黙っていた。',
  '{p}は、込み上げる思いをそっと胸にしまい込んだ。',
  'その一瞬、{p}の表情がわずかに揺らいだ。',
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
  '「――ねえ、聞こえてる？」',
  '「それ、本気で言ってるの？」',
  '「別に、たいしたことじゃないから。」',
  '「もう少しだけ、そばにいてくれない？」',
  '「どうして、そんな顔をするの？」',
  '「今更、後戻りなんてできないよ。」',
  '「大丈夫、ちゃんと分かってるから。」',
  '「これで、良かったのかな。」',
  '「ずっと、言えなかったことがあるんだ。」',
  '「信じてくれるって、約束できる？」',
  '「一人で抱え込まないで。」',
  '「本当のことを、話してくれない？」',
  '「そんなに、思い詰めないで。」',
  '「もう、隠さなくていいんだよ。」',
  '「これから、どうしていけばいいんだろう。」',
  '「ここにいるから、大丈夫。」',
];

const DIALOGUE_ATTRIBUTIONS = [
  '{o}は、そっとそう言った。',
  '{o}の声は、いつもより小さかった。',
  '{p}は、その言葉に小さくうなずいた。',
  '沈黙のあと、{o}がぽつりとつぶやいた。',
  '{p}は、すぐには答えられなかった。',
  '{o}は、そう言って静かに目を伏せた。',
  '{p}は、しばらく黙ったまま考え込んでいた。',
  '{o}の言葉に、{p}は小さく息をのんだ。',
  'その声には、いつもと違う響きがあった。',
  '{p}は、{o}の顔を見つめたまま言葉を探した。',
  '{o}は、少し困ったように笑ってみせた。',
  '静かな声で、{o}はそうつぶやいた。',
  '{p}の返事を、{o}はじっと待っていた。',
  '{o}は、それ以上何も言わなかった。',
  '{p}は、ようやく小さな声で答えた。',
  'その一言に、{p}の心は揺れ動いた。',
  '{o}は、いつもより優しい声でそう言った。',
  '{p}は、黙って小さくうなずくことしかできなかった。',
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
  '{p}の背筋に、冷たいものが走った。',
  '何かが起こる予感に、場の空気が張り詰めていく。',
  '{p}の心臓が、いつもより速く脈打っていた。',
  '静寂の中に、確かな緊張感が広がっていた。',
  '{p}は、逃げ出したい衝動をどうにか抑え込んだ。',
  '次の瞬間に何が起こるか、誰にも予想できなかった。',
  '{p}の指先が、かすかに震えていた。',
  '不穏な気配が、じわじわとその場を包んでいった。',
  '{p}は、息を潜めてその瞬間を待った。',
  '何かが崩れ落ちる予兆が、確かにそこにあった。',
  '{p}の頭の中で、警鐘が鳴り響いていた。',
  '張り詰めた糸が、今にも切れそうだった。',
  '{p}は、逃れられない何かを感じ取っていた。',
  'その場の誰もが、息をするのも忘れていた。',
  '{p}の中で、恐れと覚悟がせめぎ合っていた。',
  '静かな緊張が、その場全体を支配していた。',
  '{p}は、迫りくる何かにただ身構えるしかなかった。',
  '一瞬の静寂が、次の嵐を予感させた。',
  '{p}の胸に、抑えきれない不安が押し寄せていた。',
  '誰もが、この先の展開を息をのんで見守っていた。',
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
  // 主人公キャラクターが未登録でも、本文の主語が「主人公」という
  // 一般名詞のままにならないよう、作品ごとに決定的な人名を割り当てる。
  const protagonist = protagonistChar?.name || fallbackName(`${novel.id}:protagonist`);
  return {
    protagonist,
    other: otherChar?.name || null,
  };
}

function tokensFor(ctx: RewriteCtx): Record<string, string> {
  return { p: ctx.protagonist, o: ctx.other ?? '相手' };
}

/**
 * まだ作品をまたいで使っていないテンプレートを優先して1件選び、
 * 選んだテンプレート（置換前の文字列）を usedThisRun に記録する。
 */
function pickTemplate(
  rng: () => number,
  candidates: string[],
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
  const pool = preferUnused(candidates, avoid, (t) => t);
  const chosen = pick(rng, pool);
  usedThisRun.add(chosen);
  return chosen;
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
    if (line.trim() !== '' && inserted < maxInsertions && rng() < rate) {
      out.push(...genLines());
      inserted++;
    }
  }
  return out.join('\n');
}

function addScenery(
  content: string,
  rng: () => number,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
  const lines = content.split(/\r?\n/);
  return insertAfterParagraphs(lines, rng, 0.35, 6, () => [
    pickTemplate(rng, SCENERY_SENTENCES, avoid, usedThisRun),
  ]);
}

function addEmotion(
  content: string,
  rng: () => number,
  ctx: RewriteCtx,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
  const lines = content.split(/\r?\n/);
  const tokens = tokensFor(ctx);
  return insertAfterParagraphs(lines, rng, 0.35, 6, () => [
    fillTemplate(pickTemplate(rng, EMOTION_TEMPLATES, avoid, usedThisRun), tokens),
  ]);
}

function addDialogue(
  content: string,
  rng: () => number,
  ctx: RewriteCtx,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
  const lines = content.split(/\r?\n/);
  const tokens = tokensFor(ctx);
  return insertAfterParagraphs(lines, rng, 0.3, 5, () => [
    pickTemplate(rng, DIALOGUE_LINES, avoid, usedThisRun),
    fillTemplate(pickTemplate(rng, DIALOGUE_ATTRIBUTIONS, avoid, usedThisRun), tokens),
  ]);
}

/**
 * 終盤（本文行の後半3分の1）に絞って緊迫感を高める一文を差し込む。
 * 該当する行が全くない極端に短い章では、最後に1文だけ追加する。
 */
function raiseTension(
  content: string,
  rng: () => number,
  ctx: RewriteCtx,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
  const lines = content.split(/\r?\n/);
  const tokens = tokensFor(ctx);
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
      out.push(fillTemplate(pickTemplate(rng, TENSION_SENTENCES, avoid, usedThisRun), tokens));
      inserted++;
    }
  });
  if (inserted === 0) {
    out.push(fillTemplate(pickTemplate(rng, TENSION_SENTENCES, avoid, usedThisRun), tokens));
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

export interface RewriteResult {
  text: string;
  usedTemplates: string[];
}

/**
 * @param avoid 作品をまたいで既に使ったテンプレート集合（phraseHistory.ts）。
 *   指定すると、まだ使っていないフレーズを優先して選ぶ。
 */
export function applyRewriteInstruction(
  content: string,
  instructionKey: string,
  novel: Novel,
  seedExtra = 0,
  avoid: Set<string> = new Set()
): RewriteResult {
  const ctx = buildRewriteCtx(novel);
  const seed = hashString(`${novel.id}::${instructionKey}::${seedExtra}::${content.length}`);
  const rng = mulberry32(seed);
  const usedThisRun = new Set<string>();
  let text: string;
  switch (instructionKey) {
    case 'scenery':
      text = addScenery(content, rng, avoid, usedThisRun);
      break;
    case 'emotion':
      text = addEmotion(content, rng, ctx, avoid, usedThisRun);
      break;
    case 'dialogue':
      text = addDialogue(content, rng, ctx, avoid, usedThisRun);
      break;
    case 'tension':
      text = raiseTension(content, rng, ctx, avoid, usedThisRun);
      break;
    case 'tighten':
      text = tighten(content);
      break;
    default:
      text = content;
  }
  return { text, usedTemplates: Array.from(usedThisRun) };
}
