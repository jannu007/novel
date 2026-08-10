import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Novel } from '../types';
import { escapeHtml } from './htmlContent';
import { inlineToHtml } from './inlineMarkup';
import {
  contentToBlocks,
  imageExtension,
  type ExportImage,
} from './blockContent';
import { generateCoverImage, generateChapterIllustration } from './coverGenerator';

const STYLE_CSS = `
@charset "UTF-8";
html, body {
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
body {
  font-family: serif;
  line-height: 1.9;
  margin: 0;
  padding: 1em 0;
}
h1.chapter-title {
  font-size: 1.3em;
  text-align: center;
  margin: 0 2em;
}
h1.book-title {
  font-size: 1.8em;
  text-align: center;
  margin-right: 35%;
}
p.author {
  text-align: center;
  margin-right: 1.5em;
}
p {
  margin: 0;
  text-indent: 1em;
}
p.scene-break {
  text-align: center;
  text-indent: 0;
  margin: 0 1.5em;
}
p.no-indent {
  text-indent: 0;
}
ruby {
  ruby-align: center;
}
rt {
  font-size: 0.5em;
  line-height: 1;
  text-emphasis: none;
}
/* rp（ルビ非対応ビューア向けの括弧）は、対応ビューアでは隠す */
rp {
  display: none;
}
div.figure {
  writing-mode: horizontal-tb;
  -epub-writing-mode: horizontal-tb;
  -webkit-writing-mode: horizontal-tb;
  text-align: center;
  margin: 1em 0;
  page-break-inside: avoid;
  break-inside: avoid;
}
div.figure img {
  max-width: 100%;
  max-height: 88vh;
  height: auto;
}
p.figure-caption {
  text-indent: 0;
  text-align: center;
  font-size: 0.8em;
  margin-top: 0.4em;
}
em.boten {
  font-style: normal;
  font-weight: inherit;
  -epub-text-emphasis: filled sesame;
  -webkit-text-emphasis: filled sesame;
  text-emphasis: filled sesame;
}
img.cover-image {
  display: block;
  width: 100%;
  height: 100%;
}
body.cover-body {
  writing-mode: horizontal-tb;
  margin: 0;
  padding: 0;
}
body.illust-body {
  writing-mode: horizontal-tb;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
img.illust {
  display: block;
  width: 100%;
  height: auto;
}
nav#toc {
  writing-mode: horizontal-tb;
}
nav#toc ol { list-style: none; padding-left: 1em; }
nav#toc li { margin-bottom: 0.8em; }
`;

function chapterFileName(i: number) {
  return `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
}

// 一部の簡易EPUBビューアは外部リンクCSSを解決できないことがあるため、
// 縦書き指定は各ページにインラインでも埋め込み、リーダー実装への依存を減らす。
const INLINE_STYLE_TAG = `<style type="text/css">${STYLE_CSS}</style>`;

/**
 * @param userImages 本文に ［画像:ID］ で差し込まれた挿絵。
 *   渡さなければ、その記法は本文から取り除かれる。
 */
export async function generateEpub(
  novel: Novel,
  userImages?: Map<string, ExportImage>
): Promise<void> {
  const zip = new JSZip();
  const uuid = crypto.randomUUID();
  const chapters = [...novel.chapters].sort((a, b) => a.order - b.order);
  const title = escapeHtml(novel.title || '無題の小説');
  const author = escapeHtml(novel.author || novel.penName || '著者未設定');
  const withImages = novel.illustrationsEnabled;

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  zip.file('OEBPS/style.css', STYLE_CSS);

  const manifestItems: string[] = [
    '<item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  const spineItems: string[] = [];
  const navPoints: string[] = [];
  const navLis: string[] = [];
  let playOrder = 1;
  let coverMeta = '';
  // 同じ挿絵が複数の章で使われても、ファイルは一度だけ入れる
  const addedUserImages = new Set<string>();

  if (withImages) {
    const cover = await generateCoverImage(novel, 1000, 1600);
    zip.file('OEBPS/images/cover.png', cover.bytes);
    manifestItems.push(
      '<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>',
      '<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>'
    );
    zip.file(
      'OEBPS/text/cover.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../style.css"/>${INLINE_STYLE_TAG}</head>
<body class="cover-body">
  <img class="cover-image" src="../images/cover.png" alt="${title}"/>
</body>
</html>`
    );
    spineItems.push('<itemref idref="cover-page"/>');
    coverMeta = '\n    <meta name="cover" content="cover-image"/>';
  }

  zip.file(
    'OEBPS/text/title.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../style.css"/>${INLINE_STYLE_TAG}</head>
<body>
  <h1 class="book-title">${title}</h1>
  <p class="author">${author}</p>
</body>
</html>`
  );
  spineItems.push('<itemref idref="title"/>');
  spineItems.push('<itemref idref="nav"/>');

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const fname = chapterFileName(i);
    const id = `chap${i + 1}`;
    const chTitle = escapeHtml(ch.title || `第${i + 1}章`);

    if (withImages) {
      const illust = await generateChapterIllustration(novel, ch.title || `第${i + 1}章`, i, 1200, 500);
      const imgName = `illust-${String(i + 1).padStart(3, '0')}.png`;
      const illustPageName = `illust-page-${String(i + 1).padStart(3, '0')}.xhtml`;
      zip.file(`OEBPS/images/${imgName}`, illust.bytes);
      manifestItems.push(
        `<item id="img${i + 1}" href="images/${imgName}" media-type="image/png"/>`,
        `<item id="illustpage${i + 1}" href="text/${illustPageName}" media-type="application/xhtml+xml"/>`
      );
      spineItems.push(`<itemref idref="illustpage${i + 1}"/>`);
      zip.file(
        `OEBPS/text/${illustPageName}`,
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head><title>${chTitle}</title><link rel="stylesheet" type="text/css" href="../style.css"/>${INLINE_STYLE_TAG}</head>
<body class="illust-body">
  <img class="illust" src="../images/${imgName}" alt=""/>
</body>
</html>`
      );
    }

    manifestItems.push(
      `<item id="${id}" href="text/${fname}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${id}"/>`);
    navPoints.push(
      `<navPoint id="np${playOrder}" playOrder="${playOrder}"><navLabel><text>${chTitle}</text></navLabel><content src="text/${fname}"/></navPoint>`
    );
    playOrder++;
    navLis.push(`<li><a href="text/${fname}">${chTitle}</a></li>`);

    const bodyPieces: string[] = [];
    for (const block of contentToBlocks(ch.content)) {
      if (block.type === 'sceneBreak') {
        bodyPieces.push('<p class="scene-break">＊</p>');
        continue;
      }
      if (block.type === 'paragraph') {
        bodyPieces.push(
          `<p>${inlineToHtml(block.text, { escape: escapeHtml, withRp: true })}</p>`
        );
        continue;
      }
      const image = userImages?.get(block.id);
      if (!image) continue; // 画像が見つからない記法は無視する
      const ext = imageExtension(image.mime);
      const fileName = `user-${image.id}.${ext}`;
      if (!addedUserImages.has(image.id)) {
        addedUserImages.add(image.id);
        zip.file(`OEBPS/images/${fileName}`, image.bytes);
        manifestItems.push(
          `<item id="userimg-${image.id}" href="images/${fileName}" media-type="${image.mime}"/>`
        );
      }
      const alt = escapeHtml(image.caption || '挿絵');
      const caption = image.caption
        ? `<p class="figure-caption">${escapeHtml(image.caption)}</p>`
        : '';
      bodyPieces.push(
        `<div class="figure"><img src="../images/${fileName}" alt="${alt}"/>${caption}</div>`
      );
    }
    const bodyParas = bodyPieces.join('\n');
    zip.file(
      `OEBPS/text/${fname}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head><title>${chTitle}</title><link rel="stylesheet" type="text/css" href="../style.css"/>${INLINE_STYLE_TAG}</head>
<body>
  <h1 class="chapter-title">${chTitle}</h1>
  ${bodyParas || '<p class="no-indent"></p>'}
</body>
</html>`
    );
  }

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    <meta name="primary-writing-mode" content="vertical-rl"/>${coverMeta}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine page-progression-direction="rtl">
    ${spineItems.join('\n    ')}
  </spine>
</package>`
  );

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head><title>目次</title><link rel="stylesheet" type="text/css" href="style.css"/><style type="text/css">${STYLE_CSS}</style></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目次</h1>
    <ol>
      ${navLis.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`
  );

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`
  );

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
  });
  saveAs(blob, `${novel.title || 'novel'}.epub`);
}
