import type { Character, Novel, PlotPoint } from '../types';
import { countChars } from './textStats';
import { hashString, mulberry32, pick, makeShuffleBag } from './prng';

// あらすじ・キャラクター設定・プロットメモから、外部AIを使わず
// 端末内だけで起承転結それぞれ約1,300字（合計5,000字以上）の
// 下書きを組み立てる。同じ入力からは同じ結果になる（seed）が、
// 「別バージョン」でvariationを変えて別の組み合わせを試せる。

const MIN_CHARS_PER_ACT = 1260; // 4パート合計で必ず5,000字以上になる下限
const TARGET_CHARS_PER_ACT = 1320;
const MAX_CHARS_PER_ACT = 1550;
const PARAGRAPH_TARGET = 220;

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

// 「その日の放課後、」のような時・場所を示す一般的な前置き。
// どんな一文の前に置いても意味が通るため、末尾の一文（closer）と
// 自由に組み合わせて文のバリエーションを大きく増やせる。
const OPENERS = [
  'その日の放課後、',
  '誰もいない教室の片隅で、',
  '夕暮れに染まる校舎で、',
  '静かな夜の帳の中で、',
  'ふと目を伏せた拍子に、',
  '小さなため息とともに、',
  '遠くの喧騒をよそに、',
  '窓越しの光が差し込む中、',
  '言葉にならない沈黙の中で、',
  'すれ違う人波の中で、',
  '何度も繰り返してきた日々の中で、',
  'ページをめくる手を止めて、',
];

function makeFillerGenerator(rng: () => number, closers: string[]) {
  const nextCloser = makeShuffleBag(rng, closers);
  const nextOpener = makeShuffleBag(rng, OPENERS);
  return () => {
    const closer = ensurePeriod(nextCloser());
    if (rng() < 0.35) return closer;
    return `${nextOpener()}${closer}`;
  };
}

/**
 * 文単位・段落単位で積み上げ、最低文字数(minChars)を必ず満たすまで
 * 生成し続ける。段落は改行区切りにする（空行を挟むと「＊」のシーン
 * 区切り記号になってしまうため、単一の改行のみを使う）。
 */
function assemble(
  sentences: string[],
  fillerGenerator: () => string,
  minChars = MIN_CHARS_PER_ACT,
  maxChars = MAX_CHARS_PER_ACT
): string {
  const paragraphs: string[] = [];
  let currentPara = '';
  let total = 0;

  function push(sentence: string) {
    currentPara += sentence;
    total += countChars(sentence);
    if (countChars(currentPara) >= PARAGRAPH_TARGET) {
      paragraphs.push(currentPara);
      currentPara = '';
    }
  }

  const pool = [...sentences];
  while (pool.length > 0 && total < maxChars) {
    push(ensurePeriod(pool.shift()!));
  }

  let lastSentence = '';
  let guard = 0;
  while (total < minChars && guard < 400) {
    guard++;
    let s = fillerGenerator();
    let attempts = 0;
    while (s === lastSentence && attempts < 5) {
      s = fillerGenerator();
      attempts++;
    }
    lastSentence = s;
    push(s);
  }

  if (currentPara) paragraphs.push(currentPara);
  return paragraphs.join('\n');
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
  const closers = [
    `誰もがまだ、この先に何が待っているのかを知らなかった。`,
    `それは、ほんの小さな出来事から始まった。`,
    `${ctx.protagonist}自身、まだ気づいていなかった。`,
    `静かな時間が、もうすぐ終わろうとしていた。`,
    `${genrePrefix}物語は、いつもこんな風に始まるものなのかもしれない。`,
    `窓の外の景色は、いつもと変わらないように見えた。`,
    `${ctx.protagonist}にとって、それはごくありふれた一日のはずだった。`,
    `誰も、この物語の行方をまだ知らない。`,
    `時計の針は、いつもと変わらない速さで進んでいた。`,
    `遠くで鳴る音が、やけに長く尾を引いて聞こえた。`,
    `何気ない光が、いつものように差し込んでいた。`,
    `その頃の${ctx.protagonist}は、まだ何も知らないただの一人だった。`,
    `平凡な毎日の中に、小さな綻びがそっと紛れ込んでいた。`,
    `誰かが見ていたなら、きっと気づいていたはずだった。`,
    `けれど、そのときはまだ、誰も気に留めていなかった。`,
    `空気の匂いが、いつもと少しだけ違って感じられた。`,
    `すべての始まりは、いつもこんなふうにささやかなものだ。`,
    `${ctx.protagonist}の一日は、まだ静かに始まったばかりだった。`,
    `何かが変わり始めていることに、まだ誰も気づいていない。`,
    `その小さな出来事が、後にすべてを変えることになるとは、誰も思わなかった。`,
  ];
  const sentences = [pick(rng, leads), ...splitSentences(ctx.synopsis)];
  return assemble(sentences, makeFillerGenerator(rng, closers));
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
  for (const c of others.slice(0, 5)) {
    const desc = c.summary || c.details || `${ctx.protagonist}にとって大切な存在`;
    sentences.push(`${c.name}（${c.role}）は、${desc}という人物だ。`);
  }
  if (ctx.deuteragonist) {
    sentences.push(`${ctx.protagonist}と${ctx.deuteragonist}の距離は、少しずつ近づいていく。`);
  }
  const closers = [
    `些細な会話が、それぞれの関係を少しずつ変えていった。`,
    `誰もが、自分の役割を静かに演じていた。`,
    `けれど、その均衡はいつまでも続くものではなかった。`,
    `${ctx.protagonist}は、まだそのことに気づいていない。`,
    `見慣れた景色の中に、小さな違和感が紛れ込んでいた。`,
    `それでも毎日は、当たり前のように過ぎていく。`,
    `積み重なる何気ない時間が、少しずつ関係を形づくっていった。`,
    `誰かの何気ない一言が、いつまでも心に残ることがある。`,
    `笑い合う時間の裏側で、それぞれが小さな秘密を抱えていた。`,
    `顔を合わせるたびに、少しずつ距離が縮まっていくのを感じていた。`,
    `何気ないやりとりの中に、確かな絆が育まれていった。`,
    `それぞれの想いは、まだ言葉になっていなかった。`,
    `日々の中で、${ctx.protagonist}は少しずつ変わり始めていた。`,
    `誰にも打ち明けられない思いを、そっと胸にしまっていた。`,
    `穏やかな時間の中にも、小さな棘が隠れていた。`,
    `すれ違う視線の先に、まだ気づかぬ想いが揺れていた。`,
    `その関係は、まだ名前のつかないものだった。`,
    `変わらない日常の中で、少しずつ何かが育っていく。`,
    `ふとした瞬間に見せる素顔が、${ctx.protagonist}の心を揺らした。`,
    `誰も、この穏やかさが長く続かないことを知らなかった。`,
  ];
  return assemble(sentences, makeFillerGenerator(rng, closers));
}

function buildTen(ctx: Ctx, rng: () => number): string {
  const active = ctx.plotPoints.filter((p) => p.status !== 'done');
  const sentences: string[] = [];
  if (active.length > 0) {
    for (const p of active.slice(0, 4)) {
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
  const closers = [
    `後戻りはもう、できなかった。`,
    `${ctx.protagonist}は、選択を迫られる。`,
    `すべてが、少しずつ狂い始めていた。`,
    `誰にも、この先どうなるか分からなかった。`,
    `胸の奥で、何かが音を立てて崩れていく。`,
    `もう、引き返す道は残されていなかった。`,
    `張り詰めた空気が、その場を支配していた。`,
    `${ctx.protagonist}の中で、何かが確かに変わり始めていた。`,
    `積み上げてきたものが、音を立てて崩れていく。`,
    `誰も味方がいないような、そんな孤独感に襲われた。`,
    `時間は、もう${ctx.protagonist}を待ってはくれなかった。`,
    `予想もしなかった真実が、すべてをひっくり返した。`,
    `息をのむ間もなく、状況は次々と変わっていった。`,
    `信じていたものが、音もなく崩れ去っていく。`,
    `${ctx.protagonist}は、初めて本当の恐怖を知った。`,
    `その一瞬の判断が、すべての運命を分けることになる。`,
    `誰にも相談できないまま、${ctx.protagonist}は一人で決断を下す。`,
    `静寂の中に、次の嵐の予感だけが漂っていた。`,
    `これまで積み上げてきた日常が、音もなく崩れていく。`,
    `もう後には引けないと、${ctx.protagonist}は覚悟を決めた。`,
  ];
  return assemble(sentences, makeFillerGenerator(rng, closers));
}

function buildKetsu(ctx: Ctx, rng: () => number): string {
  const done = ctx.plotPoints.filter((p) => p.status === 'done');
  const sentences: string[] = [];
  if (done.length > 0) {
    for (const p of done.slice(0, 4)) {
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
  const closers = [
    `物語はここで幕を閉じるが、${ctx.protagonist}の日々はまだ続いていく。`,
    `振り返れば、すべてが必要な道のりだったのかもしれない。`,
    `${ctx.title}という物語は、こうして一つの区切りを迎えた。`,
    `それでも、明日はまた訪れる。`,
    `失くしたものの分だけ、${ctx.protagonist}は強くなれた気がした。`,
    `静かな余韻だけが、その場に残されていた。`,
    `長い旅の終わりに、${ctx.protagonist}はようやく息をついた。`,
    `すべてが終わったあとも、その記憶だけは色褪せなかった。`,
    `涙の理由は、もう悲しみだけではなかった。`,
    `${ctx.protagonist}の頬に、穏やかな笑みが戻っていた。`,
    `すべてを乗り越えた先に、小さな光が見えていた。`,
    `誰かに語り継がれることはなくとも、それは確かにここにあった物語だった。`,
    `過ぎ去った日々を、${ctx.protagonist}はもう恐れていなかった。`,
    `新しい一歩を踏み出す${ctx.protagonist}の背中を、誰かが静かに見送っていた。`,
    `すべての答えが出たわけではないが、それでも前を向けた。`,
    `${ctx.protagonist}にとって、それは終わりであり、始まりでもあった。`,
    `静かな朝の光が、すべてを優しく包み込んでいた。`,
    `これから先の日々にも、きっと同じ強さを持って歩いていける。`,
    `物語は終わっても、${ctx.protagonist}の人生はまだ続いていく。`,
  ];
  return assemble(sentences, makeFillerGenerator(rng, closers));
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

export const FOUR_ACT_MIN_TOTAL_CHARS = MIN_CHARS_PER_ACT * 4;
export const FOUR_ACT_TARGET_CHARS_PER_ACT = TARGET_CHARS_PER_ACT;

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
