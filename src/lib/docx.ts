import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { Novel } from '../types';

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

  const titlePageChildren: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 3000 },
      children: [new TextRun({ text: title, size: 48, bold: true })],
    }),
  ];
  if (author) {
    titlePageChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600 },
        children: [new TextRun({ text: author, size: 28 })],
      })
    );
  }

  const chapterSections = chapters.flatMap((ch, i) => {
    const heading = new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { after: 400 },
      children: [new TextRun(ch.title || `第${i + 1}章`)],
    });
    return [heading, ...buildBodyParagraphs(ch.content)];
  });

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
        children: [...titlePageChildren, ...chapterSections],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${title}.docx`);
}
