import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  EmphasisMarkType,
  ImportedXmlComponent,
  type ParagraphChild,
} from 'docx';
import { saveAs } from 'file-saver';
import type { Novel } from '../types';
import { generateCoverImage, generateChapterIllustration } from './coverGenerator';
import { parseInline } from './inlineMarkup';

/** 本文の基準サイズ（half-point 単位。22 = 11pt） */
const BODY_SIZE = 22;
/** ルビの文字サイズ（親文字のおよそ半分） */
const RUBY_SIZE = 11;

/** OOXMLの要素を1つ組み立てる小さなヘルパー。 */
function xml(
  name: string,
  attrs?: Record<string, string>,
  children: (ImportedXmlComponent | string)[] = []
): ImportedXmlComponent {
  const node = new ImportedXmlComponent(name, attrs);
  for (const child of children) node.push(child);
  return node;
}

/** ルビ用・親文字用のラン（`w:r`）を作る。 */
function sizedRun(text: string, size: number): ImportedXmlComponent {
  return xml('w:r', undefined, [
    xml('w:rPr', undefined, [xml('w:sz', { 'w:val': String(size) })]),
    xml('w:t', { 'xml:space': 'preserve' }, [text]),
  ]);
}

/**
 * Wordのルビ（`w:ruby`）を組み立てる。
 * docx ライブラリにはルビ専用のAPIがないため、OOXMLの要素を直接組み立てて
 * 段落の子要素として差し込んでいる。Wordの「ルビ」機能で入力した場合と
 * 同じ構造なので、Word上でそのまま編集できる。
 */
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

/** 1行ぶんのルビ・傍点記法をWordのランに変換する。 */
function buildRuns(line: string): ParagraphChild[] {
  return parseInline(line).map((token) => {
    if (token.type === 'ruby') return rubyRun(token.base, token.ruby);
    if (token.type === 'emphasis') {
      return new TextRun({
        text: token.text,
        emphasisMark: { type: EmphasisMarkType.DOT },
      });
    }
    return new TextRun(token.text);
  });
}

function buildBodyParagraphs(content: string): Paragraph[] {
  const lines = content.split(/\r?\n/);
  const paras: Paragraph[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun++;
      continue;
    }
    if (blankRun > 0 && paras.length > 0) {
      paras.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 200 },
          children: [new TextRun('＊')],
        })
      );
    }
    blankRun = 0;
    paras.push(
      new Paragraph({
        indent: { firstLine: 240 },
        spacing: { line: 360 },
        children: buildRuns(line),
      })
    );
  }
  if (paras.length === 0) {
    paras.push(new Paragraph({ children: [] }));
  }
  return paras;
}

export async function generateDocx(novel: Novel): Promise<void> {
  const chapters = [...novel.chapters].sort((a, b) => a.order - b.order);
  const title = novel.title || '無題の小説';
  const author = novel.author || novel.penName || '';
  const withImages = novel.illustrationsEnabled;

  const titlePageChildren: Paragraph[] = [];
  if (withImages) {
    const cover = await generateCoverImage(novel, 1000, 1600);
    titlePageChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
        children: [
          new ImageRun({
            type: 'png',
            data: cover.bytes,
            transformation: { width: 300, height: 480 },
          }),
        ],
      })
    );
  } else {
    titlePageChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 3000 },
        children: [new TextRun({ text: title, size: 48, bold: true })],
      })
    );
    if (author) {
      titlePageChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 600 },
          children: [new TextRun({ text: author, size: 28 })],
        })
      );
    }
  }

  const tocChildren: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { after: 400 },
      children: [new TextRun('目次')],
    }),
    ...chapters.map(
      (ch, i) =>
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun(ch.title || `第${i + 1}章`)],
        })
    ),
  ];

  const chapterSections: Paragraph[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const chTitle = ch.title || `第${i + 1}章`;
    if (withImages) {
      const illust = await generateChapterIllustration(novel, chTitle, i, 1200, 500);
      chapterSections.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          pageBreakBefore: true,
          spacing: { after: 300 },
          children: [
            new ImageRun({
              type: 'png',
              data: illust.bytes,
              transformation: { width: 550, height: 229 },
            }),
          ],
        })
      );
    }
    chapterSections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: !withImages,
        spacing: { after: 400 },
        children: [new TextRun(chTitle)],
      })
    );
    chapterSections.push(...buildBodyParagraphs(ch.content));
  }

  const doc = new Document({
    creator: author || 'Novel Writing Studio',
    title,
    styles: {
      default: {
        document: {
          run: { font: 'Yu Mincho', size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {},
        children: [...titlePageChildren, ...tocChildren, ...chapterSections],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${title}.docx`);
}
