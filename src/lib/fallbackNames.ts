import { hashString } from './prng';

// キャラクター管理で主人公（役割「主人公」）がまだ登録されていない場合の
// 保険的な名前候補。「主人公」という役割名をそのまま本文の主語にすると
// 固有名詞ではなく一般名詞が並ぶ不自然な文章になるため、作品ごとに
// 決定的（同じ作品なら常に同じ名前）に、それらしい人名を割り当てる。
const NAMES = [
  '陽菜', '葵', '蒼', '悠斗', '美月', '涼太', '千尋', '大和',
  '花音', '翔太', '莉子', '健太', '結衣', '拓海', '沙耶', '直人',
  '桜子', '航平', '真希', '大輔',
];

/**
 * seedKeyから決定的に人名を1つ選ぶ。同じseedKeyには常に同じ名前が
 * 返るため、同じ作品内で生成・再生成しても主人公名がぶれない。
 * excludeに渡した名前とは重複しない。
 */
export function fallbackName(seedKey: string, exclude: string[] = []): string {
  const pool = NAMES.filter((n) => !exclude.includes(n));
  const candidates = pool.length > 0 ? pool : NAMES;
  const idx = hashString(seedKey) % candidates.length;
  return candidates[idx];
}
