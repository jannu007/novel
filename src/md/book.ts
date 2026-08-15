/**
 * 解析したMarkdownを「本」の形（章立て・目次・リンク）に組み直す。
 *
 * 利用者がすることは、原稿を貼るか読み込ませるかだけ。章の切り出し方も、
 * 章題も、目次も、章をまたぐリンクの行き先も、ここで自動的に決まる。
 */

import {
  blocksToText,
  slugify,
  spansToText,
  type Block,
  type Footnote,
  type ParsedDoc,
  type Span,
  type Warning,
} from './markdown';

export type SplitMode = 'auto' | 1 | 2 | 3 | 'none';

export interface BookOptions {
  /** 何段目の見出しで章を分けるか。auto は原稿の形から自動で決める。 */
  splitMode: SplitMode;
  /** 改行を段落の区切りとして扱う（小説の原稿でよくある書き方）。 */
  lineAsParagraph: boolean;
  /** 章の頭に自動生成の挿絵を入れる。 */
  illustrations: boolean;
  /** 縦書きで組む。 */
  vertical: boolean;
}

export const DEFAULT_OPTIONS: BookOptions = {
  splitMode: 'auto',
  lineAsParagraph: true,
  illustrations: true,
  vertical: true,
};

export interface BookMeta {
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  description: string;
  genre: string;
  /** 表紙・挿絵の作り直しに使う番号。変えると絵柄が変わる。 */
  artSeed: number;
}

export interface ChapterHeading {
  text: string;
  anchor: string;
  level: number;
}

export interface BookChapter {
  id: string;
  title: string;
  anchor: string;
  blocks: Block[];
  footnotes: Footnote[];
  headings: ChapterHeading[];
  chars: number;
}

export interface BookStats {
  chars: number;
  chapters: number;
  paragraphs: number;
  images: number;
  internalLinks: number;
  externalLinks: number;
  footnotes: number;
}

export interface Book {
  meta: BookMeta;
  options: BookOptions;
  chapters: BookChapter[];
  warnings: Warning[];
  stats: BookStats;
}

const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1〜99 を漢数字にする（章題の自動生成用）。 */
export function kanjiNumber(n: number): string {
  if (n < 10) return KANJI[n];
  if (n > 99) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? KANJI[tens] : ''}十${ones > 0 ? KANJI[ones] : ''}`;
}

/** 章題らしい行（第一章・第1話・プロローグ など）。見出しの無い原稿で使う。 */
const CHAPTER_LINE =
  /^\s*(?:[#＃]*\s*)?(?:第[0-9０-９一二三四五六七八九十百]+[章話節幕部]|プロローグ|エピローグ|序章|終章|幕間|序|跋).{0,40}$/;

// ---------------------------------------------------------------------------
// 章の切り出し
// ---------------------------------------------------------------------------

function headingCounts(blocks: Block[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const block of blocks) {
    if (block.type === 'heading') counts.set(block.level, (counts.get(block.level) ?? 0) + 1);
  }
  return counts;
}

/**
 * 章に分ける見出しの深さを決める。
 * 2回以上出てくる中で最も浅い見出しを選ぶ（＝それが章の粒度）。
 */
function decideSplitLevel(blocks: Block[], mode: SplitMode): number | null {
  if (mode === 'none') return null;
  if (typeof mode === 'number') return mode;
  const counts = headingCounts(blocks);
  for (let level = 1; level <= 6; level++) {
    if ((counts.get(level) ?? 0) >= 2) return level;
  }
  for (let level = 1; level <= 6; level++) {
    if ((counts.get(level) ?? 0) >= 1) return level;
  }
  return null;
}

/** 段落の中の改行を、段落の区切りに変える。 */
function splitByLineBreaks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.type === 'quote') {
      out.push({ type: 'quote', blocks: splitByLineBreaks(block.blocks) });
      continue;
    }
    if (block.type === 'list') {
      out.push({ ...block, items: block.items.map(splitByLineBreaks) });
      continue;
    }
    if (block.type !== 'paragraph') {
      out.push(block);
      continue;
    }
    let current: Span[] = [];
    const flush = () => {
      if (current.some((span) => span.type !== 'break')) {
        out.push({ type: 'paragraph', children: current });
      }
      current = [];
    };
    for (const span of block.children) {
      if (span.type === 'break') flush();
      else current.push(span);
    }
    flush();
  }
  return out;
}

/** 見出しがまったく無い原稿を、水平線や「第一章」の行で切り分ける。 */
function splitWithoutHeadings(blocks: Block[]): { title: string; blocks: Block[] }[] {
  const hrCount = blocks.filter((b) => b.type === 'hr').length;
  const groups: { title: string; blocks: Block[] }[] = [];
  let current: Block[] = [];

  const pushGroup = (title: string) => {
    if (current.length > 0) groups.push({ title, blocks: current });
    current = [];
  };

  if (hrCount >= 2) {
    for (const block of blocks) {
      if (block.type === 'hr') {
        pushGroup('');
        continue;
      }
      current.push(block);
    }
    pushGroup('');
    return groups;
  }

  // 「第一章」のような行を章の頭とみなす
  let title = '';
  let matched = 0;
  for (const block of blocks) {
    const text = block.type === 'paragraph' ? spansToText(block.children).trim() : '';
    if (text && text.length <= 40 && CHAPTER_LINE.test(text)) {
      pushGroup(title);
      title = text;
      matched++;
      continue;
    }
    current.push(block);
  }
  pushGroup(title);
  if (matched >= 1) {
    const found = groups.filter((g) => g.blocks.length > 0 || g.title);
    // 最初の章題より前にある本文は、前書きとして扱う
    if (found.length > 1 && !found[0].title) found[0].title = 'まえがき';
    return found;
  }

  return [{ title: '', blocks }];
}

// ---------------------------------------------------------------------------
// 本を組む
// ---------------------------------------------------------------------------

export function buildBook(
  doc: ParsedDoc,
  options: BookOptions,
  overrides: Partial<BookMeta> = {}
): Book {
  const warnings: Warning[] = [...doc.warnings];
  let blocks = options.lineAsParagraph ? splitByLineBreaks(doc.blocks) : doc.blocks;

  const counts = headingCounts(blocks);
  const splitLevel = decideSplitLevel(blocks, options.splitMode);

  // 本のタイトル。フロントマター → 単独のH1 → 最初の見出し → 先頭の一文
  const firstHeading = blocks.find((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading');
  const onlyOneH1 = (counts.get(1) ?? 0) === 1;
  let titleFromBody = '';
  if (onlyOneH1 && firstHeading?.level === 1 && (splitLevel === null || splitLevel >= 2)) {
    titleFromBody = firstHeading.text;
    blocks = blocks.filter((b) => b !== firstHeading);
  } else if (firstHeading && splitLevel === null) {
    titleFromBody = firstHeading.text;
  }

  const meta: BookMeta = {
    title:
      overrides.title ??
      doc.frontMatter.title ??
      titleFromBody ??
      '',
    subtitle: overrides.subtitle ?? doc.frontMatter.subtitle ?? '',
    author:
      overrides.author ??
      doc.frontMatter.author ??
      doc.frontMatter.creator ??
      doc.frontMatter.penname ??
      '',
    publisher: overrides.publisher ?? doc.frontMatter.publisher ?? '',
    description: overrides.description ?? doc.frontMatter.description ?? doc.frontMatter.summary ?? '',
    genre: overrides.genre ?? doc.frontMatter.genre ?? doc.frontMatter.category ?? '',
    artSeed: overrides.artSeed ?? 0,
  };
  if (!meta.title) {
    const firstText = blocksToText(blocks).split('\n').find((l) => l.trim());
    meta.title = (firstText ?? '無題の本').slice(0, 40).trim() || '無題の本';
  }

  // 章に切り分ける
  const groups: { title: string; anchor: string; blocks: Block[] }[] = [];
  if (splitLevel === null) {
    for (const group of splitWithoutHeadings(blocks)) {
      groups.push({ title: group.title, anchor: '', blocks: group.blocks });
    }
  } else {
    let current: { title: string; anchor: string; blocks: Block[] } | null = null;
    const lead: Block[] = [];
    for (const block of blocks) {
      if (block.type === 'heading' && block.level === splitLevel) {
        if (current) groups.push(current);
        current = { title: block.text, anchor: block.anchor, blocks: [] };
        continue;
      }
      if (current) current.blocks.push(block);
      else lead.push(block);
    }
    if (current) groups.push(current);
    if (lead.some((b) => b.type !== 'hr')) {
      groups.unshift({ title: 'まえがき', anchor: '', blocks: lead });
    }
  }

  const chapters: BookChapter[] = groups.map((group, index) => {
    const headings: ChapterHeading[] = [];
    const walk = (list: Block[]) => {
      for (const block of list) {
        if (block.type === 'heading') {
          headings.push({ text: block.text, anchor: block.anchor, level: block.level });
        } else if (block.type === 'quote') walk(block.blocks);
      }
    };
    walk(group.blocks);
    const text = blocksToText(group.blocks);
    return {
      id: `ch-${index + 1}`,
      title: group.title || `第${kanjiNumber(index + 1)}章`,
      anchor: group.anchor || `chapter-${index + 1}`,
      blocks: group.blocks,
      footnotes: [],
      headings,
      chars: countChars(text),
    };
  });

  if (chapters.length === 0) {
    chapters.push({
      id: 'ch-1',
      title: '本文',
      anchor: 'chapter-1',
      blocks: [],
      footnotes: [],
      headings: [],
      chars: 0,
    });
  }

  resolveLinks(chapters, warnings);
  const stats = attachFootnotesAndCount(chapters, doc.footnotes);

  return { meta, options, chapters, warnings, stats };
}

/** 全角・半角を問わず、空白と改行を除いた文字数。 */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

// ---------------------------------------------------------------------------
// リンクの解決
// ---------------------------------------------------------------------------

function eachSpan(blocks: Block[], visit: (span: Span) => void) {
  const walkSpans = (spans: Span[]) => {
    for (const span of spans) {
      visit(span);
      if (span.type === 'link' || span.type === 'strong' || span.type === 'em' || span.type === 'strike') {
        walkSpans(span.children);
      }
    }
  };
  const walk = (list: Block[]) => {
    for (const block of list) {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          walkSpans(block.children);
          break;
        case 'quote':
          walk(block.blocks);
          break;
        case 'list':
          for (const item of block.items) walk(item);
          break;
        case 'table':
          for (const cell of block.header) walkSpans(cell);
          for (const row of block.rows) for (const cell of row) walkSpans(cell);
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
}

/**
 * `#見出し名` のようなリンクを、章とアンカーの組に解決する。
 * 原稿の中で章題をそのまま書いたリンク（`[第三章](#第三章)`）も、
 * 記号や大文字小文字の違いを吸収して結びつける。
 */
function resolveLinks(chapters: BookChapter[], warnings: Warning[]) {
  const index = new Map<string, { chapterIndex: number; anchor: string }>();
  const put = (key: string, value: { chapterIndex: number; anchor: string }) => {
    const slug = slugify(key);
    if (slug && !index.has(slug)) index.set(slug, value);
  };
  chapters.forEach((chapter, chapterIndex) => {
    put(chapter.title, { chapterIndex, anchor: chapter.anchor });
    put(chapter.anchor, { chapterIndex, anchor: chapter.anchor });
    for (const heading of chapter.headings) {
      put(heading.text, { chapterIndex, anchor: heading.anchor });
      put(heading.anchor, { chapterIndex, anchor: heading.anchor });
    }
  });

  let missing = 0;
  for (const chapter of chapters) {
    eachSpan(chapter.blocks, (span) => {
      if (span.type !== 'link' || span.external) return;
      if (!span.href.startsWith('#')) return;
      let key = span.href.slice(1);
      try {
        key = decodeURIComponent(key);
      } catch {
        /* 壊れたパーセント記法はそのまま扱う */
      }
      const found = index.get(slugify(key));
      if (found) span.target = found;
      else missing++;
    });
  }
  if (missing > 0) {
    warnings.push({
      kind: 'missing-anchor',
      message: `行き先の見つからない内部リンクが ${missing} 件ありました。`,
      detail: '該当のリンクは、文字だけを残して本に入れます。',
    });
  }
}

/** 章ごとに脚注を割り当て、あわせて全体の統計を数える。 */
function attachFootnotesAndCount(chapters: BookChapter[], footnotes: Footnote[]): BookStats {
  const byId = new Map(footnotes.map((f) => [f.id, f]));
  const stats: BookStats = {
    chars: 0,
    chapters: chapters.length,
    paragraphs: 0,
    images: 0,
    internalLinks: 0,
    externalLinks: 0,
    footnotes: 0,
  };

  for (const chapter of chapters) {
    const used = new Set<string>();
    eachSpan(chapter.blocks, (span) => {
      if (span.type === 'footnote') used.add(span.id);
      if (span.type === 'image') stats.images++;
      if (span.type === 'link') {
        if (span.external) stats.externalLinks++;
        else if (span.target) stats.internalLinks++;
      }
    });
    const countBlocks = (list: Block[]) => {
      for (const block of list) {
        if (block.type === 'paragraph') stats.paragraphs++;
        else if (block.type === 'image') stats.images++;
        else if (block.type === 'quote') countBlocks(block.blocks);
        else if (block.type === 'list') for (const item of block.items) countBlocks(item);
      }
    };
    countBlocks(chapter.blocks);

    chapter.footnotes = [...used]
      .map((id) => byId.get(id))
      .filter((f): f is Footnote => Boolean(f))
      .sort((a, b) => a.index - b.index);
    stats.footnotes += chapter.footnotes.length;
    stats.chars += chapter.chars;
  }

  return stats;
}
