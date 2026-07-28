import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { Novel } from '../types';
import { generateCoverImage, generateChapterIllustration } from './coverGenerator';

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
        children: [new TextRun(line)],
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
