import type { Character, Novel, PlotPoint } from '../types';
import { countChars } from './textStats';
import { hashString, mulberry32, pick, makeShuffleBag, fillTemplate } from './prng';
import { preferUnused } from './phraseHistory';

// あらすじ・キャラクター設定・プロットメモから、外部AIを使わず
// 端末内だけで起承転結それぞれ約1,300字（合計5,000字以上）の
// 下書きを組み立てる。同じ入力からは同じ結果になる（seed）が、
// 「別バージョン」でvariationを変えて別の組み合わせを試せる。
//
// 汎用的なつなぎ文（OPENERS・各パートのCLOSERS）は、{p}（主人公名）
// のようなトークンを含んだテンプレートとして持ち、生成時に差し替える。
// これにより「どのテンプレートを使ったか」を作品をまたいで記録でき、
// phraseHistory.ts と組み合わせて同じ言い回しの重複を減らせる。

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
  '遠くの鐘の音が響く中、',
  '湯気の立つカップを両手で包みながら、',
  '誰かの足音が遠ざかっていく中、',
  '薄暗い廊下を歩きながら、',
  'カーテンの隙間から差す光の中、',
  '雨上がりの匂いが漂う中、',
  '街灯がぽつりと灯る頃、',
  '古い時計の音だけが響く部屋で、',
  '誰にも聞こえないつぶやきとともに、',
  '冷めかけたお茶に口をつけながら、',
  '開け放した窓から風が抜ける中、',
  '遠くの踏切の音を聞きながら、',
  '静まり返った廊下の先で、',
  'うつむいたまま歩く足取りの中、',
  '誰かと目が合わないよう俯きながら、',
  '曇り空を見上げた拍子に、',
  '手のひらに残る温もりとともに、',
  '誰もいない放課後の教室で、',
  '遠くの祭囃子が微かに聞こえる中、',
  '電車の揺れに身を任せながら、',
  '静かに閉じた本をそっと置いて、',
  '誰にともなく漏らした独り言とともに、',
  '薄れゆく夕焼けを背に、',
  '誰かの視線を感じた瞬間、',
  'ぽつりと落ちてきた雨粒とともに、',
  '静けさに耳を澄ませながら、',
  '遠く聞こえる誰かの笑い声に、',
  'まだ乾かないインクの匂いの中、',
];

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

function tokensFor(ctx: Ctx): Record<string, string> {
  return {
    p: ctx.protagonist,
    g: ctx.genre ? `${ctx.genre}の` : '',
    d: ctx.deuteragonist ?? '大切な誰か',
    a: ctx.antagonist ?? '正体不明の相手',
    t: ctx.title,
  };
}

/**
 * closer/openerのテンプレート配列から、まだ作品をまたいで使っていない
 * ものを優先しつつシャッフルバッグで巡回するフィラー文生成器を作る。
 * 選んだテンプレート（置換前の文字列）は usedThisRun に記録する。
 */
function makeFillerGenerator(
  rng: () => number,
  closerTemplates: string[],
  ctx: Ctx,
  avoid: Set<string>,
  usedThisRun: Set<string>
) {
  const tokens = tokensFor(ctx);
  const closerPool = preferUnused(closerTemplates, avoid, (t) => t);
  const openerPool = preferUnused(OPENERS, avoid, (t) => t);
  const nextCloser = makeShuffleBag(rng, closerPool);
  const nextOpener = makeShuffleBag(rng, openerPool);
  return () => {
    const closerTemplate = nextCloser();
    usedThisRun.add(closerTemplate);
    const closer = ensurePeriod(fillTemplate(closerTemplate, tokens));
    if (rng() < 0.35) return closer;
    const openerTemplate = nextOpener();
    usedThisRun.add(openerTemplate);
    return `${fillTemplate(openerTemplate, tokens)}${closer}`;
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

const KI_LEADS = [
  'これは、{p}をめぐる{g}物語である。',
  '{t}――それは{p}にとって、忘れられない日々の記録だった。',
  '{p}の日常は、いつもと変わらないはずだった。',
  'これは、{g}世界を生きる{p}の物語だ。',
  '{t}の始まりは、ごく普通の一日だった。',
  '{p}にとって、それはただの一日になるはずだった。',
  'これから語るのは、{p}が歩んだ{g}物語である。',
  '{t}――その記録は、{p}のささやかな日常から始まる。',
];

const KI_CLOSERS = [
  '誰もがまだ、この先に何が待っているのかを知らなかった。',
  'それは、ほんの小さな出来事から始まった。',
  '{p}自身、まだ気づいていなかった。',
  '静かな時間が、もうすぐ終わろうとしていた。',
  '{g}物語は、いつもこんな風に始まるものなのかもしれない。',
  '窓の外の景色は、いつもと変わらないように見えた。',
  '{p}にとって、それはごくありふれた一日のはずだった。',
  '誰も、この物語の行方をまだ知らない。',
  '時計の針は、いつもと変わらない速さで進んでいた。',
  '遠くで鳴る音が、やけに長く尾を引いて聞こえた。',
  '何気ない光が、いつものように差し込んでいた。',
  'その頃の{p}は、まだ何も知らないただの一人だった。',
  '平凡な毎日の中に、小さな綻びがそっと紛れ込んでいた。',
  '誰かが見ていたなら、きっと気づいていたはずだった。',
  'けれど、そのときはまだ、誰も気に留めていなかった。',
  '空気の匂いが、いつもと少しだけ違って感じられた。',
  'すべての始まりは、いつもこんなふうにささやかなものだ。',
  '{p}の一日は、まだ静かに始まったばかりだった。',
  '何かが変わり始めていることに、まだ誰も気づいていない。',
  'その小さな出来事が、後にすべてを変えることになるとは、誰も思わなかった。',
  '{p}は、まだ何も選んでいなかった。',
  'その予感は、まだ形を持たない霧のようなものだった。',
  '{g}物語の幕は、静かに上がろうとしていた。',
  '誰かが仕組んだわけでもないのに、歯車は動き出していた。',
  '{p}の胸の内には、まだ何のさざ波もなかった。',
  'すべてが変わる日だとは、誰も思っていなかった。',
  'その日の空気は、どこか少しだけ違って感じられた。',
  '{p}は、いつも通りの一日を過ごすつもりでいた。',
  'まだ誰も、運命の歯車が回り始めたことに気づいていない。',
  '静かな日常の底に、小さな亀裂が走っていた。',
  '{p}にとって、それは些細な違和感に過ぎなかった。',
  '遠くの空模様が、なぜか妙に気にかかった。',
  '{g}物語の始まりは、いつも静けさの中にある。',
  '誰も気づかぬうちに、季節は静かに移ろっていた。',
  '{p}の毎日は、その日を境に少しずつ形を変えていく。',
  '何の前触れもなく、それは始まった。',
  '{p}は、まだそれが特別な一日になるとは思っていなかった。',
  '空の色さえも、いつもと同じに見えていた。',
  '誰もが、明日もまた同じ日が続くと信じていた。',
  'その静けさの裏で、何かが静かに動き出していた。',
  '{p}の物語は、ここから静かに動き出す。',
  'まだ名前のつかない予感が、胸の奥にわだかまっていた。',
  '何気ない一日のはずが、後に大きな意味を持つことになる。',
  '{p}は、ただいつも通りの朝を迎えたつもりだった。',
  'その違和感の正体に、まだ誰も気づいていなかった。',
  '静かな時間の流れが、少しずつ速さを変え始めていた。',
  '{p}にとって、世界はまだ何も変わっていないように見えた。',
  '遠くから聞こえる物音に、なぜか胸がざわついた。',
  'すべての始まりは、こんなにもささやかで、こんなにも静かだった。',
  '{p}は、まだこの日が特別なものになるとは知らなかった。',
];

const SHO_CLOSERS = [
  '些細な会話が、それぞれの関係を少しずつ変えていった。',
  '誰もが、自分の役割を静かに演じていた。',
  'けれど、その均衡はいつまでも続くものではなかった。',
  '{p}は、まだそのことに気づいていない。',
  '見慣れた景色の中に、小さな違和感が紛れ込んでいた。',
  'それでも毎日は、当たり前のように過ぎていく。',
  '積み重なる何気ない時間が、少しずつ関係を形づくっていった。',
  '誰かの何気ない一言が、いつまでも心に残ることがある。',
  '笑い合う時間の裏側で、それぞれが小さな秘密を抱えていた。',
  '顔を合わせるたびに、少しずつ距離が縮まっていくのを感じていた。',
  '何気ないやりとりの中に、確かな絆が育まれていった。',
  'それぞれの想いは、まだ言葉になっていなかった。',
  '日々の中で、{p}は少しずつ変わり始めていた。',
  '誰にも打ち明けられない思いを、そっと胸にしまっていた。',
  '穏やかな時間の中にも、小さな棘が隠れていた。',
  'すれ違う視線の先に、まだ気づかぬ想いが揺れていた。',
  'その関係は、まだ名前のつかないものだった。',
  '変わらない日常の中で、少しずつ何かが育っていく。',
  'ふとした瞬間に見せる素顔が、{p}の心を揺らした。',
  '誰も、この穏やかさが長く続かないことを知らなかった。',
  '{p}は、少しずつ誰かの存在を近くに感じ始めていた。',
  '何気ない冗談の裏に、本音がそっと隠れていた。',
  '一緒に過ごす時間の意味を、{p}はまだ測りかねていた。',
  '誰かのために何かをする喜びを、{p}は少しずつ知り始めていた。',
  '交わす言葉が増えるほど、距離は静かに縮まっていった。',
  '{p}は、その関係に名前をつけることをまだ躊躇っていた。',
  '何気ない優しさが、{p}の心にそっと積み重なっていく。',
  '誰かと過ごす時間が、いつしかかけがえのないものになっていた。',
  '{p}は、自分の気持ちにまだ気づいていないふりをしていた。',
  '些細なすれ違いが、後に大きな意味を持つとは思わなかった。',
  '笑顔の裏に、それぞれの事情が静かに横たわっていた。',
  '{p}にとって、その時間は何よりも心地よいものだった。',
  '言葉にできない想いが、少しずつ形を持ち始めていた。',
  '誰かと分かち合う沈黙が、{p}には心地よかった。',
  'その関係は、まだ始まったばかりの物語のようだった。',
  '{p}は、少しずつ自分の殻を開き始めていた。',
  '何気ない日常の積み重ねが、絆という形になっていく。',
  '誰かの存在が、{p}の毎日に確かな彩りを添えていた。',
  'その優しさに、{p}は何度も助けられていた。',
  '言葉少なな時間の中にも、確かな信頼が育っていた。',
  '{p}は、その関係を壊したくないと強く思うようになっていた。',
  '何でもない会話が、いつまでも記憶に残ることがある。',
  '誰かと過ごす何気ない時間こそが、{p}の支えになっていた。',
  'その距離感に、{p}はまだ戸惑いを隠せずにいた。',
  '交わした約束が、静かに二人を繋いでいた。',
  '{p}は、誰かのために強くなりたいと思い始めていた。',
  '何気ない仕草の一つ一つに、{p}は心を動かされていた。',
  'その関係が、これからどう変わっていくのか誰にも分からなかった。',
  '穏やかな日々の中に、確かな絆が静かに根を張っていった。',
  '{p}にとって、その存在はもう欠かせないものになっていた。',
];

const TEN_CLOSERS = [
  '後戻りはもう、できなかった。',
  '{p}は、選択を迫られる。',
  'すべてが、少しずつ狂い始めていた。',
  '誰にも、この先どうなるか分からなかった。',
  '胸の奥で、何かが音を立てて崩れていく。',
  'もう、引き返す道は残されていなかった。',
  '張り詰めた空気が、その場を支配していた。',
  '{p}の中で、何かが確かに変わり始めていた。',
  '積み上げてきたものが、音を立てて崩れていく。',
  '誰も味方がいないような、そんな孤独感に襲われた。',
  '時間は、もう{p}を待ってはくれなかった。',
  '予想もしなかった真実が、すべてをひっくり返した。',
  '息をのむ間もなく、状況は次々と変わっていった。',
  '信じていたものが、音もなく崩れ去っていく。',
  '{p}は、初めて本当の恐怖を知った。',
  'その一瞬の判断が、すべての運命を分けることになる。',
  '誰にも相談できないまま、{p}は一人で決断を下す。',
  '静寂の中に、次の嵐の予感だけが漂っていた。',
  'これまで積み上げてきた日常が、音もなく崩れていく。',
  'もう後には引けないと、{p}は覚悟を決めた。',
  '{p}の手が、かすかに震えていた。',
  'すべてが一変する予感に、{p}は息を呑んだ。',
  '誰にも止められない何かが、静かに動き出していた。',
  '{p}は、逃げ場のない現実と向き合わされていた。',
  '積み重ねてきた信頼が、音を立てて揺らいでいく。',
  'その瞬間、{p}の世界の色が変わった。',
  '誰も予想していなかった展開に、その場は騒然となった。',
  '{p}は、自分の弱さと初めて向き合うことになった。',
  '張り詰めた沈黙が、次に起こることを予感させていた。',
  'すべてが崩れ落ちる音を、{p}は確かに聞いた気がした。',
  'もう、誰にも頼ることはできなかった。',
  '{p}の決断が、すべての行方を左右しようとしていた。',
  '予期していなかった痛みが、{p}の胸を貫いた。',
  '誰かの裏切りが、静かに{p}を追い詰めていく。',
  'その真実は、{p}が思っていたよりもずっと重かった。',
  'すべてが手のひらからこぼれ落ちていくようだった。',
  '{p}は、初めて本気で何かを恐れた。',
  '状況は、もう{p}の手には負えないところまで来ていた。',
  '誰も助けてくれないと分かった瞬間、{p}は覚悟を決めた。',
  'その一言が、すべての均衡を崩した。',
  '{p}の中で、これまでの当たり前が音を立てて崩れていく。',
  '予感していた不安が、ついに現実のものとなった。',
  '誰もが息を潜めて、その行方を見守っていた。',
  '{p}は、もう後戻りできないことを悟った。',
  '静かな絶望が、{p}の胸に広がっていった。',
  'すべてを賭けるしかないと、{p}は心を決めた。',
  '予想もしない一撃が、{p}を打ちのめした。',
  'その瞬間から、何もかもが変わってしまった。',
  '{p}にとって、それは避けようのない試練だった。',
  '誰も知らないところで、運命は静かに牙を剥いていた。',
];

const KETSU_CLOSERS = [
  '物語はここで幕を閉じるが、{p}の日々はまだ続いていく。',
  '振り返れば、すべてが必要な道のりだったのかもしれない。',
  '{t}という物語は、こうして一つの区切りを迎えた。',
  'それでも、明日はまた訪れる。',
  '失くしたものの分だけ、{p}は強くなれた気がした。',
  '静かな余韻だけが、その場に残されていた。',
  '長い旅の終わりに、{p}はようやく息をついた。',
  'すべてが終わったあとも、その記憶だけは色褪せなかった。',
  '涙の理由は、もう悲しみだけではなかった。',
  '{p}の頬に、穏やかな笑みが戻っていた。',
  'すべてを乗り越えた先に、小さな光が見えていた。',
  '誰かに語り継がれることはなくとも、それは確かにここにあった物語だった。',
  '過ぎ去った日々を、{p}はもう恐れていなかった。',
  '新しい一歩を踏み出す{p}の背中を、誰かが静かに見送っていた。',
  'すべての答えが出たわけではないが、それでも前を向けた。',
  '{p}にとって、それは終わりであり、始まりでもあった。',
  '静かな朝の光が、すべてを優しく包み込んでいた。',
  'これから先の日々にも、きっと同じ強さを持って歩いていける。',
  '物語は終わっても、{p}の人生はまだ続いていく。',
  '{p}は、ようやく自分らしい笑顔を取り戻していた。',
  'すべてが変わったあとも、{p}はここにいる。',
  '長かった物語も、ここで一つの結末を迎える。',
  '{p}の瞳に、これまでとは違う光が宿っていた。',
  '失ったものを抱えたまま、{p}はそれでも歩き出した。',
  'すべてを経て、{p}はようやく自分の答えを見つけた。',
  '静かな安堵が、{p}の胸を満たしていた。',
  '{t}の物語は、こうして静かに幕を下ろす。',
  'これまでの痛みも、{p}にとって大切な糧になっていた。',
  '{p}は、もう一人ではないことを知っていた。',
  '穏やかな時間が、ようやく{p}のもとに戻ってきた。',
  'すべてが報われたわけではないが、{p}は確かに前に進んでいた。',
  '{p}の口元に、久しぶりの笑みがこぼれた。',
  '長い戦いの終わりに、{p}はただ静かに息をついた。',
  'これから先も、{p}の物語は続いていく。',
  '{p}は、失ったものよりも得たものを数えることにした。',
  'すべてを乗り越えた{p}の姿は、以前よりも少しだけ強く見えた。',
  '誰も知らない場所で、{p}は静かに新しい一歩を踏み出した。',
  '{p}にとって、それは長い旅の終わりであり、新しい始まりだった。',
  '涙の跡が乾く頃、{p}の心にも静けさが戻ってきた。',
  'すべての出来事が、{p}を確かに成長させていた。',
  '{p}は、これまでの自分と静かに向き合っていた。',
  '穏やかな夕暮れが、{p}のこれからを優しく照らしていた。',
  '{t}という物語の続きは、これから{p}自身が紡いでいく。',
  'すべてが終わったその先に、{p}はまだ見ぬ景色を思い描いていた。',
  '{p}は、失った痛みごと、これからを生きていくと決めた。',
  '静かな達成感が、{p}の胸にそっと広がっていた。',
  'これまでの日々を、{p}はもう後悔していなかった。',
  '{p}の物語は、ここで終わるのではなく、ここから始まる。',
  'すべてを見届けたあと、静けさだけがその場に残された。',
  '{p}にとって、その結末はどんな言葉よりも雄弁だった。',
];

function buildKi(
  ctx: Ctx,
  rng: () => number,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
  const tokens = tokensFor(ctx);
  const leadPool = preferUnused(KI_LEADS, avoid, (t) => t);
  const leadTemplate = pick(rng, leadPool);
  usedThisRun.add(leadTemplate);
  const sentences = [fillTemplate(leadTemplate, tokens), ...splitSentences(ctx.synopsis)];
  return assemble(sentences, makeFillerGenerator(rng, KI_CLOSERS, ctx, avoid, usedThisRun));
}

function buildSho(
  ctx: Ctx,
  rng: () => number,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
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
  return assemble(sentences, makeFillerGenerator(rng, SHO_CLOSERS, ctx, avoid, usedThisRun));
}

function buildTen(
  ctx: Ctx,
  rng: () => number,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
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
  return assemble(sentences, makeFillerGenerator(rng, TEN_CLOSERS, ctx, avoid, usedThisRun));
}

function buildKetsu(
  ctx: Ctx,
  rng: () => number,
  avoid: Set<string>,
  usedThisRun: Set<string>
): string {
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
  return assemble(sentences, makeFillerGenerator(rng, KETSU_CLOSERS, ctx, avoid, usedThisRun));
}

export interface FourActDraft {
  ki: string;
  sho: string;
  ten: string;
  ketsu: string;
}

export interface FourActGenerationResult {
  draft: FourActDraft;
  usedTemplates: string[];
}

export const FOUR_ACT_LABELS: { key: keyof FourActDraft; title: string }[] = [
  { key: 'ki', title: '起' },
  { key: 'sho', title: '承' },
  { key: 'ten', title: '転' },
  { key: 'ketsu', title: '結' },
];

export const FOUR_ACT_MIN_TOTAL_CHARS = MIN_CHARS_PER_ACT * 4;
export const FOUR_ACT_TARGET_CHARS_PER_ACT = TARGET_CHARS_PER_ACT;

/**
 * @param avoid 作品をまたいで既に使ったテンプレート集合（phraseHistory.ts）。
 *   指定すると、まだ使っていないつなぎ文を優先して選ぶ。
 */
export function generateFourActDraft(
  novel: Novel,
  variation = 0,
  avoid: Set<string> = new Set()
): FourActGenerationResult {
  const ctx = buildCtx(novel);
  const seedBase = hashString(`${novel.title}::${novel.synopsis}::${variation}`);
  const usedThisRun = new Set<string>();
  const draft: FourActDraft = {
    ki: buildKi(ctx, mulberry32(seedBase ^ 0x11), avoid, usedThisRun),
    sho: buildSho(ctx, mulberry32(seedBase ^ 0x22), avoid, usedThisRun),
    ten: buildTen(ctx, mulberry32(seedBase ^ 0x33), avoid, usedThisRun),
    ketsu: buildKetsu(ctx, mulberry32(seedBase ^ 0x44), avoid, usedThisRun),
  };
  return { draft, usedTemplates: Array.from(usedThisRun) };
}
