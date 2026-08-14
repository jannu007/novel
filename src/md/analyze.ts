/**
 * 本文を読んで、表紙と挿絵の「題材」を決める。
 *
 * 外部のAIや画像生成サービスは使わない（＝通信しない・費用もかからない）。
 * そのかわり、日本語・英語の語彙表と重み付けで、原稿がどんな情景の物語かを
 * 見立て、情景・時刻・季節・天候・気分を決めて、それを絵に描く。
 * 同じ原稿からは必ず同じ絵ができる（乱数の種を内容から作るため）。
 */

export type SceneName =
  | 'sea'
  | 'mountain'
  | 'forest'
  | 'city'
  | 'sky'
  | 'room'
  | 'school'
  | 'field'
  | 'castle'
  | 'space'
  | 'road'
  | 'flower';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'none';
export type Weather = 'clear' | 'rain' | 'snow' | 'cloud' | 'petals' | 'stars';
export type Mood = 'warm' | 'cool' | 'dark' | 'bright' | 'calm';

export interface SceneProfile {
  scene: SceneName;
  time: TimeOfDay;
  season: Season;
  weather: Weather;
  mood: Mood;
  genre: string;
  /** 判断のもとになった語（画面で根拠として見せる）。 */
  evidence: string[];
  /** 内容から作った乱数の種。 */
  seed: number;
}

type Dict<T extends string> = { key: T; words: string[]; weight?: number }[];

const SCENE_WORDS: Dict<SceneName> = [
  { key: 'sea', words: ['海', '波', '浜', '砂浜', '潮', '船', '港', '島', '灯台', '漁', '水平線', 'sea', 'ocean', 'wave', 'beach', 'harbor'] },
  { key: 'mountain', words: ['山', '峠', '嶺', '崖', '谷', '登山', '山脈', '岩', '雪山', 'mountain', 'cliff', 'valley'] },
  { key: 'forest', words: ['森', '林', '木々', '樹', '梢', '苔', '獣道', '茂み', '木漏れ日', 'forest', 'woods', 'tree'] },
  { key: 'city', words: ['街', '町', '都市', 'ビル', '路地', '駅', '電車', 'ネオン', '交差点', '信号', '雑踏', '喫茶', 'city', 'street', 'town', 'station'] },
  { key: 'sky', words: ['空', '雲', '月', '星', '夜空', '天', '翼', '飛', '風', '銀河', 'sky', 'moon', 'star', 'cloud'] },
  { key: 'room', words: ['部屋', '窓', '机', '本棚', '台所', '寝室', '扉', '椅子', '灯り', 'ランプ', '書斎', 'room', 'window', 'desk', 'door'] },
  { key: 'school', words: ['学校', '教室', '校庭', '放課後', '部活', '制服', '黒板', '下駄箱', '文化祭', '先輩', 'school', 'classroom'] },
  { key: 'field', words: ['野原', '草原', '田', '畑', '丘', '牧場', '平原', '麦', 'field', 'meadow', 'hill', 'plain'] },
  { key: 'castle', words: ['城', '王', '騎士', '塔', '砦', '宮殿', '玉座', '王国', '剣', '魔法', 'castle', 'king', 'knight', 'tower'] },
  { key: 'space', words: ['宇宙', '惑星', '銀河', '恒星', '宇宙船', '軌道', 'ロケット', '人工知能', 'アンドロイド', 'space', 'planet', 'galaxy', 'orbit'] },
  { key: 'road', words: ['道', '旅', '線路', '橋', '駅前', '坂', '歩道', '峠道', '旅路', 'road', 'journey', 'bridge', 'path'] },
  { key: 'flower', words: ['花', '桜', '薔薇', '庭', '花園', '花束', '蕾', '向日葵', '紫陽花', 'flower', 'rose', 'garden', 'bloom'] },
];

const TIME_WORDS: Dict<TimeOfDay> = [
  { key: 'dawn', words: ['夜明け', '明け方', '朝日', '朝', '曙', '暁', '早朝', 'dawn', 'morning', 'sunrise'] },
  { key: 'day', words: ['昼', '正午', '日差し', '陽射し', '真昼', '午後', '青空', 'noon', 'afternoon', 'daylight'] },
  { key: 'dusk', words: ['夕', '夕暮れ', '黄昏', '夕焼け', '日暮れ', '茜', '薄暮', 'dusk', 'sunset', 'evening'] },
  { key: 'night', words: ['夜', '深夜', '真夜中', '月明かり', '星空', '闇', '宵', 'night', 'midnight', 'moonlight'] },
];

const SEASON_WORDS: Dict<Season> = [
  { key: 'spring', words: ['春', '桜', '花見', '新学期', '芽吹', '菜の花', 'spring', 'blossom'] },
  { key: 'summer', words: ['夏', '蝉', '海水浴', '入道雲', '花火', '祭り', '汗', 'summer'] },
  { key: 'autumn', words: ['秋', '紅葉', '落ち葉', '月見', '稲', '実り', '木枯らし', 'autumn', 'fall'] },
  { key: 'winter', words: ['冬', '雪', '氷', '凍', 'こたつ', '寒', '吐く息', 'winter', 'snow'] },
];

const WEATHER_WORDS: Dict<Weather> = [
  { key: 'rain', words: ['雨', '傘', '雫', '雷', '梅雨', '濡れ', 'rain', 'storm'] },
  { key: 'snow', words: ['雪', '吹雪', '粉雪', '霜', 'snow', 'blizzard'] },
  { key: 'cloud', words: ['曇', '霧', '靄', '雲', 'cloud', 'fog', 'mist'] },
  { key: 'petals', words: ['花びら', '桜吹雪', '舞い散', 'petal'] },
  { key: 'stars', words: ['星', '流れ星', '星座', '銀河', 'star', 'constellation'] },
];

const MOOD_WORDS: Dict<Mood> = [
  { key: 'warm', words: ['笑', '温か', 'やさし', '優し', '幸せ', '好き', '愛', '灯', 'ぬくもり', 'smile', 'warm', 'love'] },
  { key: 'cool', words: ['静か', '澄ん', '涼', '透明', '青', '冷た', 'quiet', 'cool', 'clear'] },
  { key: 'dark', words: ['死', '血', '闇', '恐', '殺', '呪', '絶望', '孤独', '涙', '別れ', 'dark', 'death', 'fear'] },
  { key: 'bright', words: ['光', '輝', '希望', '未来', '走', '叫', '夢', '始ま', 'light', 'hope', 'shine'] },
  { key: 'calm', words: ['眠', '穏やか', 'ゆっくり', '波音', '休', '午睡', 'calm', 'gentle'] },
];

const GENRE_WORDS: Dict<string> = [
  { key: 'ファンタジー', words: ['魔法', '魔術', '勇者', '竜', 'ドラゴン', '精霊', '異世界', '王国', '剣', '呪文', 'エルフ', 'magic', 'dragon'] },
  { key: 'SF', words: ['宇宙', 'AI', '人工知能', 'ロボット', 'アンドロイド', '未来', '端末', '実験', '量子', 'サイバー', 'android', 'cyber'] },
  { key: 'ミステリー', words: ['事件', '犯人', '探偵', '推理', '殺人', '謎', '証拠', '容疑', '刑事', '密室', 'murder', 'detective'] },
  { key: '恋愛', words: ['恋', '好き', '告白', 'キス', '恋人', 'デート', '片想い', '心臓', 'ときめ', 'love', 'kiss'] },
  { key: 'ホラー', words: ['幽霊', '怪異', '呪い', '祟', '悲鳴', '血', '骸', '不気味', 'ghost', 'horror'] },
  { key: '歴史・時代', words: ['武士', '侍', '藩', '殿', '幕府', '戦国', '合戦', '刀', '天下', '御所'] },
  { key: '青春', words: ['放課後', '部活', '教室', '文化祭', '制服', '先輩', '受験', '卒業', '青春'] },
  { key: '実用・ビジネス', words: ['方法', '手順', '本書', 'ポイント', '第一に', 'まとめ', '事例', '効率', '仕事', 'ステップ'] },
  { key: 'エッセイ', words: ['私は', '思う', '日々', '暮らし', '記憶', 'なのだ', 'だろう', '感じる'] },
];

/** 数えるのは先頭のこの文字数まで（大きな原稿でも一瞬で終わらせる）。 */
const SAMPLE_LIMIT = 80_000;

function countAll(text: string, words: string[]): { score: number; hits: string[] } {
  let score = 0;
  const hits: string[] = [];
  for (const word of words) {
    let from = 0;
    let count = 0;
    for (;;) {
      const at = text.indexOf(word, from);
      if (at < 0) break;
      count++;
      from = at + word.length;
      if (count > 200) break;
    }
    if (count > 0) {
      // 同じ語を何度も数えすぎないよう、頻度は緩やかに効かせる
      score += Math.sqrt(count) * (word.length >= 2 ? 1.3 : 1);
      hits.push(word);
    }
  }
  return { score, hits };
}

function pick<T extends string>(
  text: string,
  dict: Dict<T>,
  fallback: T
): { key: T; hits: string[]; score: number } {
  let best = { key: fallback, hits: [] as string[], score: 0 };
  for (const entry of dict) {
    const { score, hits } = countAll(text, entry.words);
    const weighted = score * (entry.weight ?? 1);
    if (weighted > best.score) best = { key: entry.key, hits: hits.slice(0, 3), score: weighted };
  }
  return best;
}

function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/**
 * 本文（と、あれば題名やジャンル）から情景を見立てる。
 * @param hint 題名・章題など、短くても内容をよく表す文字列
 */
export function analyzeScene(text: string, hint = '', extraSeed = 0): SceneProfile {
  // 題名や章題は本文より強く効かせたいので、繰り返して重みを付ける
  const sample = `${hint} ${hint} ${hint} ${text.slice(0, SAMPLE_LIMIT)}`;

  const scene = pick(sample, SCENE_WORDS, 'sky');
  const time = pick(sample, TIME_WORDS, 'day');
  const season = pick(sample, SEASON_WORDS, 'none');
  const weather = pick(sample, WEATHER_WORDS, 'clear');
  const mood = pick(sample, MOOD_WORDS, 'calm');
  const genre = pick(sample, GENRE_WORDS, '');

  // 天候が弱い判定のときは、季節から自然なものを補う
  let finalWeather = weather.key;
  if (weather.score < 2) {
    if (season.key === 'winter') finalWeather = 'snow';
    else if (season.key === 'spring') finalWeather = 'petals';
    else if (time.key === 'night') finalWeather = 'stars';
    else finalWeather = 'clear';
  }

  // 情景がはっきりしないときは、ジャンルから決める
  let finalScene = scene.key;
  if (scene.score < 2) {
    if (genre.key === 'ファンタジー') finalScene = 'castle';
    else if (genre.key === 'SF') finalScene = 'space';
    else if (genre.key === '青春') finalScene = 'school';
    else if (genre.key === '実用・ビジネス' || genre.key === 'エッセイ') finalScene = 'room';
    else finalScene = 'sky';
  }

  const evidence = [
    ...scene.hits,
    ...time.hits.slice(0, 1),
    ...season.hits.slice(0, 1),
    ...mood.hits.slice(0, 1),
  ].slice(0, 6);

  return {
    scene: finalScene,
    time: time.key,
    season: season.key,
    weather: finalWeather,
    mood: mood.key,
    genre: genre.key,
    evidence,
    seed: hashString(`${hint}::${text.slice(0, 2000)}::${extraSeed}`),
  };
}

/** 情景を日本語のひとことにする（画面での説明用）。 */
export function describeScene(profile: SceneProfile): string {
  const scene: Record<SceneName, string> = {
    sea: '海辺',
    mountain: '山並み',
    forest: '森',
    city: '街',
    sky: '空',
    room: '部屋の窓辺',
    school: '学校',
    field: '野原',
    castle: '城',
    space: '宇宙',
    road: '道',
    flower: '花',
  };
  const time: Record<TimeOfDay, string> = {
    dawn: '夜明け',
    day: '昼',
    dusk: '夕暮れ',
    night: '夜',
  };
  const weather: Record<Weather, string> = {
    clear: '晴れた',
    rain: '雨の',
    snow: '雪の',
    cloud: '曇った',
    petals: '花びらの舞う',
    stars: '星の見える',
  };
  const season: Record<Season, string> = {
    spring: '春',
    summer: '夏',
    autumn: '秋',
    winter: '冬',
    none: '',
  };
  const when = profile.season === 'none' ? '' : `${season[profile.season]}の`;
  return `${when}${weather[profile.weather]}${time[profile.time]}の${scene[profile.scene]}`;
}
