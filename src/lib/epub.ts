import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Novel } from '../types';
import { escapeHtml, contentToParagraphs } from './htmlContent';

const STYLE_CSS = `
@charset "UTF-8";
body {
  font-family: serif;
  line-height: 1.9;
  margin: 0;
  padding: 0 1em;
}
h1.chapter-title {
  font-size: 1.3em;
  text-align: center;
  margin: 2.5em 0 2em;
  page-break-before: always;
}
h1.book-title {
  font-size: 1.8em;
  text-align: center;
  margin-top: 35%;
}
p.author {
  text-align: center;
  margin-top: 1.5em;
}
p {
  margin: 0;
  text-indent: 1em;
}
p.scene-break {
  text-align: center;
  text-indent: 0;
  margin: 1.5em 0;
}
p.no-indent {
  text-indent: 0;
}
nav#toc ol { list-style: none; padding-left: 1em; }
`;

function chapterFileName(i: number) {
  return `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
}

export async function generateEpub(novel: Novel): Promise<void> {
  const zip = new JSZip();
  const uuid = crypto.randomUUID();
  const chapters = [...novel.chapters].sort((a, b) => a.order - b.order);
  const title = escapeHtml(novel.title || '無題の小説');
  const author = escapeHtml(novel.author || novel.penName || '著者未設定');

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

  zip.file(
    'OEBPS/text/title.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
  <h1 class="book-title">${title}</h1>
  <p class="author">${author}</p>
</body>
</html>`
  );

  const manifestItems: string[] = [
    '<item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  const spineItems: string[] = ['<itemref idref="title"/>'];
  const navPoints: string[] = [];
  const navLis: string[] = [];

  chapters.forEach((ch, i) => {
    const fname = chapterFileName(i);
    const id = `chap${i + 1}`;
    manifestItems.push(
      `<item id="${id}" href="text/${fname}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${id}"/>`);
    const chTitle = escapeHtml(ch.title || `第${i + 1}章`);
    navPoints.push(
      `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${chTitle}</text></navLabel><content src="text/${fname}"/></navPoint>`
    );
    navLis.push(`<li><a href="text/${fname}">${chTitle}</a></li>`);

    const bodyParas = contentToParagraphs(ch.content).join('\n');
    zip.file(
      `OEBPS/text/${fname}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head><title>${chTitle}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
  <h1 class="chapter-title">${chTitle}</h1>
  ${bodyParas || '<p class="no-indent"></p>'}
</body>
</html>`
    );
  });

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
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`
  );

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head><title>目次</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
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
