/**
 * Word（.docx）の組み立て。
 *
 * KDPのペーパーバック入稿と、他の人に原稿を渡すときの両方を想定している。
 * ・判型（トリムサイズ）と余白をKDPの規定に合わせて設定
 * ・縦書き（tbRl）にも対応
 * ・見出しはWordの見出しスタイルなので、ナビゲーションと自動目次が効く
 * ・ルビはWordの `w:ruby`（Wordのルビ機能そのもの）として書き出す
 * ・脚注はWordの脚注、リンクは本物のハイパーリンクになる
 */

import {
  AlignmentType,
  Bookmark,
  Document,
  EmphasisMarkType,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  ImportedXmlComponent,
  InternalHyperlink,
  PageTextDirectionType,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import type { Book, BookChapter } from './book';
import type { Block, Span } from './markdown';
import { decodeDataUrl, imageExtension } from './assets';
import type { RenderedImage } from './artwork';
import type { BookArtwork } from './epub';

/** 本文の基準サイズ（half-point 単位。21 = 10.5pt、日本語の標準的な本文） */
const BODY_SIZE = 21;
const RUBY_SIZE = 10;
const TWIP_PER_INCH = 1440;

export type TrimName = 'p5x8' | 'p55x85' | 'p6x9' | 'a5' | 'b6' | 'a4';

export const TRIMS: Record<TrimName, { label: string; w: number; h: number; note: string }> = {
  p5x8: { label: '文庫に近い 5 × 8 インチ', w: 5, h: 8, note: 'KDPペーパーバックの規定サイズ' },
  p55x85: { label: 'A5に近い 5.5 × 8.5 インチ', w: 5.5, h: 8.5, note: 'KDPペーパーバックの規定サイズ' },
  p6x9: { label: '四六判に近い 6 × 9 インチ', w: 6, h: 9, note: 'KDPで最も一般的なサイズ' },
  a5: { label: 'A5（148 × 210 mm）', w: 5.83, h: 8.27, note: '同人誌・自家製本向け' },
  b6: { label: 'B6（128 × 182 mm）', w: 5.04, h: 7.17, note: '日本の単行本に多いサイズ' },
  a4: { label: 'A4原稿（210 × 297 mm）', w: 8.27, h: 11.69, note: '出版社への持ち込み用' },
};

// ---------------------------------------------------------------------------
// ルビ（OOXMLを直接組み立てる）
// ---------------------------------------------------------------------------

function xml(
  name: string,
  attrs?: Record<string, string>,
  children: (ImportedXmlComponent | string)[] = []
): ImportedXmlComponent {
  const node = new ImportedXmlComponent(name, attrs);
  for (const child of children) node.push(child);
  return node;
}

function sizedRun(text: string, size: number): ImportedXmlComponent {
  return xml('w:r', undefined, [
    xml('w:rPr', undefined, [xml('w:sz', { 'w:val': String(size) })]),
    xml('w:t', { 'xml:space': 'preserve' }, [text]),
  ]);
}

function rubyRun(base: string, ruby: string): ParagraphChild {
  const node = xml('w:r', undefined, [
    xml('w:ruby', undefined, [
      xml('w:rubyPr', undefined, [
        xml('w:rubyAlign', { 'w:val': 'distributeSpace' }),
        xml('w:hps', { 'w:val': String(RUBY_SIZE) }),
        xml('w:hpsRaise', { 'w:val': String(BODY_SIZE) }),
        xml('w:hpsBaseText', { 'w:val': String(BODY_SIZE) }),
        xml('w:lid', { 'w:val': 'ja-JP' }),
      ]),
      xml('w:rt', undefined, [sizedRun(ruby, RUBY_SIZE)]),
      xml('w:rubyBase', undefined, [sizedRun(base, BODY_SIZE)]),
    ]),
  ]);
  return node as unknown as ParagraphChild;
}

// ---------------------------------------------------------------------------
// 本文
// ---------------------------------------------------------------------------

interface DocxContext {
  /** 脚注番号（本文の[^n]）→ Wordの脚注ID */
  footnoteIds: Map<number, number>;
  /** 章のアンカー → Wordのブックマーク名 */
  bookmark: (chapterIndex: number, anchor: string) => string;
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  size?: number;
}

function spansToRuns(spans: Span[], ctx: DocxContext, style: RunStyle = {}): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  for (const span of spans) {
    switch (span.type) {
      case 'text':
        if (span.text) runs.push(new TextRun({ text: span.text, ...style, font: style.code ? 'Consolas' : undefined }));
        break;
      case 'break':
        runs.push(new TextRun({ break: 1 }));
        break;
      case 'strong':
        runs.push(...spansToRuns(span.children, ctx, { ...style, bold: true }));
        break;
      case 'em':
        runs.push(...spansToRuns(span.children, ctx, { ...style, italics: true }));
        break;
      case 'strike':
        runs.push(...spansToRuns(span.children, ctx, { ...style, strike: true }));
        break;
      case 'code':
        runs.push(new TextRun({ text: span.text, font: 'Consolas', size: BODY_SIZE - 2 }));
        break;
      case 'ruby':
        runs.push(rubyRun(span.base, span.ruby));
        break;
      case 'boten':
        runs.push(
          new TextRun({ text: span.text, emphasisMark: { type: EmphasisMarkType.DOT }, ...style })
        );
        break;
      case 'footnote': {
        const id = ctx.footnoteIds.get(span.index);
        if (id !== undefined) runs.push(new FootnoteReferenceRun(id));
        break;
      }
      case 'link': {
        const children = spansToRuns(span.children, ctx, { ...style });
        const textRuns = children.filter((c): c is TextRun => c instanceof TextRun);
        if (span.target) {
          runs.push(
            new InternalHyperlink({
              anchor: ctx.bookmark(span.target.chapterIndex, span.target.anchor),
              children: textRuns.length > 0 ? textRuns : [new TextRun('（参照）')],
            })
          );
        } else if (span.external && /^(https?:|mailto:)/i.test(span.href)) {
          runs.push(
            new ExternalHyperlink({
              link: span.href,
              children:
                textRuns.length > 0
                  ? textRuns.map((r) => r)
                  : [new TextRun(span.href)],
            })
          );
        } else {
          runs.push(...children);
        }
        break;
      }
      case 'image':
        // 画像は段落として扱うので、ここでは何もしない
        break;
      default:
        break;
    }
  }
  return runs;
}

/** 本文の横幅（ポイント）。挿絵はこの幅に収める。 */
function imageParagraph(dataUrl: string, maxWidthPt: number, caption?: string): Paragraph[] {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return [];
  const ext = imageExtension(decoded.mime);
  if (ext !== 'png' && ext !== 'jpg' && ext !== 'gif') return [];
  // 実寸がわからないので、幅いっぱい・高さは4:3として置く（Word上で調整可能）
  const width = Math.round(maxWidthPt);
  const height = Math.round((maxWidthPt * 3) / 4);
  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120 },
      children: [
        new ImageRun({
          type: ext === 'jpg' ? 'jpg' : ext,
          data: decoded.bytes,
          transformation: { width, height },
        }),
      ],
    }),
  ];
  if (caption) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: caption, size: 16 })],
      })
    );
  }
  return paragraphs;
}

function fullWidthImage(image: RenderedImage, maxWidthPt: number): Paragraph[] {
  const scale = Math.min(1, maxWidthPt / image.width);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { after: 240 },
      children: [
        new ImageRun({
          type: image.mime === 'image/png' ? 'png' : 'jpg',
          data: image.bytes,
          transformation: {
            width: Math.round(image.width * scale),
            height: Math.round(image.height * scale),
          },
        }),
      ],
    }),
  ];
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function blocksToParagraphs(
  blocks: Block[],
  ctx: DocxContext,
  bodyWidthPt: number,
  depth = 0
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const indent = depth > 0 ? { left: 360 * depth } : undefined;

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const level = HEADING_LEVELS[Math.min(5, Math.max(1, block.level - 1))];
        const options: IParagraphOptions = {
          heading: level,
          spacing: { before: 360, after: 200 },
          children: [
            new Bookmark({
              id: block.anchor,
              children: spansToRuns(block.children, ctx, { bold: true }),
            }),
          ],
        };
        out.push(new Paragraph(options));
        break;
      }
      case 'paragraph': {
        const runs = spansToRuns(block.children, ctx);
        const image = block.children.find((s) => s.type === 'image');
        if (image && image.type === 'image') {
          out.push(...imageParagraph(image.src, bodyWidthPt));
        }
        if (runs.length === 0) break;
        out.push(
          new Paragraph({
            indent: { firstLine: 210, ...indent },
            spacing: { line: 340 },
            children: runs,
          })
        );
        break;
      }
      case 'quote':
        out.push(...blocksToParagraphs(block.blocks, ctx, bodyWidthPt, depth + 1));
        break;
      case 'list': {
        block.items.forEach((item, i) => {
          const marker = block.ordered ? `${block.start + i}. ` : '・';
          const [head, ...tail] = item;
          const headIsText = head?.type === 'paragraph';
          out.push(
            new Paragraph({
              indent: { left: 360 * (depth + 1), hanging: 210 },
              spacing: { after: 60 },
              children: [
                new TextRun(marker),
                ...(headIsText ? spansToRuns(head.children, ctx) : []),
              ],
            })
          );
          const rest = headIsText ? tail : item;
          if (rest.length > 0) out.push(...blocksToParagraphs(rest, ctx, bodyWidthPt, depth + 1));
        });
        break;
      }
      case 'code':
        out.push(
          new Paragraph({
            spacing: { before: 160, after: 160 },
            shading: { fill: 'F2F2F2' },
            children: block.text.split('\n').flatMap((line, i) => {
              const run = new TextRun({ text: line, font: 'Consolas', size: 18 });
              return i === 0 ? [run] : [new TextRun({ break: 1 }), run];
            }),
          })
        );
        break;
      case 'table': {
        const header = new TableRow({
          children: block.header.map(
            (cell) =>
              new TableCell({
                shading: { fill: 'EFEFEF' },
                children: [new Paragraph({ children: spansToRuns(cell, ctx, { bold: true }) })],
              })
          ),
        });
        const rows = block.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({ children: [new Paragraph({ children: spansToRuns(cell, ctx) })] })
              ),
            })
        );
        out.push(
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] })
        );
        break;
      }
      case 'image':
        out.push(...imageParagraph(block.src, bodyWidthPt, block.caption));
        break;
      case 'hr':
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
            children: [new TextRun('＊　＊　＊')],
          })
        );
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------------------

export interface DocxOptions {
  trim: TrimName;
  /** 縦書きで組む。 */
  vertical: boolean;
}

export async function buildDocx(
  book: Book,
  artwork: BookArtwork,
  options: DocxOptions
): Promise<Blob> {
  const trim = TRIMS[options.trim];
  const marginIn = { top: 0.6, bottom: 0.6, outer: 0.55, gutter: 0.35 };
  const bodyWidthPt = (trim.w - marginIn.outer * 2 - marginIn.gutter) * 72;

  // 章ごとのブックマーク名（Wordのブックマークは記号を嫌うので単純な名前にする）
  const bookmarkNames = new Map<string, string>();
  book.chapters.forEach((chapter, i) => {
    bookmarkNames.set(`${i}:${chapter.anchor}`, `ch${i + 1}`);
    chapter.headings.forEach((h) => bookmarkNames.set(`${i}:${h.anchor}`, h.anchor));
  });

  // 脚注はWordの脚注機能に載せる
  const footnoteIds = new Map<number, number>();
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  let footnoteId = 1;

  const ctx: DocxContext = {
    footnoteIds,
    bookmark: (chapterIndex, anchor) =>
      bookmarkNames.get(`${chapterIndex}:${anchor}`) ?? `ch${chapterIndex + 1}`,
  };

  for (const chapter of book.chapters) {
    for (const note of chapter.footnotes) {
      footnoteIds.set(note.index, footnoteId);
      footnotes[String(footnoteId)] = {
        children: blocksToParagraphs(note.blocks, ctx, bodyWidthPt).filter(
          (p): p is Paragraph => p instanceof Paragraph
        ),
      };
      footnoteId++;
    }
  }

  const children: (Paragraph | Table)[] = [];

  // 表紙・扉
  if (artwork.cover) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: artwork.cover.mime === 'image/png' ? 'png' : 'jpg',
            data: artwork.cover.bytes,
            transformation: { width: Math.round(bodyWidthPt), height: Math.round(bodyWidthPt * 1.6) },
          }),
        ],
      })
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      pageBreakBefore: Boolean(artwork.cover),
      spacing: { before: artwork.cover ? 200 : 2400, after: 400 },
      children: [new TextRun({ text: book.meta.title || '無題の本', size: 44, bold: true })],
    })
  );
  if (book.meta.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: book.meta.subtitle, size: 26 })],
      })
    );
  }
  if (book.meta.author) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: book.meta.author, size: 26 })],
      })
    );
  }

  // 目次（章題からWordの内部リンクを張る）
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { after: 400 },
      children: [new TextRun('目次')],
    })
  );
  book.chapters.forEach((chapter, i) => {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new InternalHyperlink({
            anchor: ctx.bookmark(i, chapter.anchor),
            children: [new TextRun(chapter.title)],
          }),
        ],
      })
    );
  });

  // 本文
  book.chapters.forEach((chapter, i) => {
    const art = artwork.chapterArt[i];
    if (art) children.push(...fullWidthImage(art, bodyWidthPt));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: !art,
        spacing: { after: 400 },
        children: [
          new Bookmark({
            id: ctx.bookmark(i, chapter.anchor),
            children: [new TextRun({ text: chapter.title, size: 30, bold: true })],
          }),
        ],
      })
    );
    children.push(...blocksToParagraphs(chapter.blocks, ctx, bodyWidthPt));
  });

  const doc = new Document({
    creator: book.meta.author || '製本所',
    title: book.meta.title,
    description: book.meta.description,
    footnotes,
    styles: {
      default: {
        document: {
          run: { font: 'Yu Mincho', size: BODY_SIZE },
          paragraph: { spacing: { line: 340 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: Math.round(trim.w * TWIP_PER_INCH),
              height: Math.round(trim.h * TWIP_PER_INCH),
            },
            margin: {
              top: Math.round(marginIn.top * TWIP_PER_INCH),
              bottom: Math.round(marginIn.bottom * TWIP_PER_INCH),
              left: Math.round(marginIn.outer * TWIP_PER_INCH),
              right: Math.round(marginIn.outer * TWIP_PER_INCH),
              gutter: Math.round(marginIn.gutter * TWIP_PER_INCH),
            },
            textDirection: options.vertical
              ? PageTextDirectionType.TOP_TO_BOTTOM_RIGHT_TO_LEFT
              : PageTextDirectionType.LEFT_TO_RIGHT_TOP_TO_BOTTOM,
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

/** 章のうち、Wordの見出しに落とせる数（画面での説明用）。 */
export function countHeadings(chapters: BookChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + chapter.headings.length, 0);
}
