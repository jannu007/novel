/**
 * EPUB 3 の組み立て。Kindle（KDP）にそのまま登録できる形で書き出す。
 *
 * ・縦書き（vertical-rl・右綴じ）と横書きの両方に対応
 * ・目次は nav.xhtml / toc.ncx / 読者に見える目次ページの三つを自動生成
 * ・原稿中のリンクは、章をまたぐ内部リンクとして解決してから埋め込む
 * ・脚注は epub:type="noteref" / "footnote" で組み、Kindleでポップアップ表示になる
 * ・画像はすべて同梱（外部URLは参照しない）
 */

import JSZip from 'jszip';
import type { Book } from './book';
import type { Block, Span } from './markdown';
import { decodeDataUrl, imageExtension } from './assets';
import type { RenderedImage } from './artwork';

export interface BookArtwork {
  cover: RenderedImage | null;
  /** 章の順番どおりに並んだ扉絵。null なら挿絵なし。 */
  chapterArt: (RenderedImage | null)[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 属性に入れる URL。書き出し先でも危険なスキームを通さない。 */
function safeHref(href: string): string | null {
  if (/^(https?:|mailto:|tel:)/i.test(href)) return escapeXml(href);
  return null;
}

const chapterFile = (i: number) => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;

// ---------------------------------------------------------------------------
// スタイル
// ---------------------------------------------------------------------------

function styleSheet(vertical: boolean): string {
  const flow = vertical
    ? `html, body {
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}`
    : `html, body {
  writing-mode: horizontal-tb;
}`;

  return `@charset "UTF-8";
${flow}
body {
  font-family: serif;
  line-height: 1.85;
  margin: 0;
  padding: 1em 0;
  text-align: justify;
}
p {
  margin: 0;
  text-indent: 1em;
}
p.no-indent, p.caption, p.scene-break { text-indent: 0; }
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  line-height: 1.4;
}
h1.chapter-title {
  font-size: 1.4em;
  margin: ${vertical ? '0 1.5em 0 0' : '0 0 1.6em'};
  ${vertical ? '' : 'text-align: center;'}
}
h1.book-title {
  font-size: 2em;
  ${vertical ? 'margin-right: 25%;' : 'text-align: center; margin-top: 25%;'}
}
h2 { font-size: 1.2em; margin: ${vertical ? '0 1.2em 0 0' : '1.6em 0 0.8em'}; }
h3 { font-size: 1.08em; margin: ${vertical ? '0 1em 0 0' : '1.4em 0 0.6em'}; }
h4, h5, h6 { font-size: 1em; margin: ${vertical ? '0 0.8em 0 0' : '1.2em 0 0.5em'}; }
p.scene-break { text-align: center; margin: ${vertical ? '0 1.5em' : '1.5em 0'}; }
p.author { text-align: center; }
blockquote {
  margin: ${vertical ? '1.2em 1.4em' : '1.2em 1.6em'};
  padding: ${vertical ? '0 0.8em 0 0' : '0 0 0 0.8em'};
  border-${vertical ? 'top' : 'left'}: 3px solid rgba(0,0,0,0.25);
  font-size: 0.96em;
}
ul, ol { margin: 1em 1.6em; }
li { margin-bottom: 0.4em; }
pre, table, div.figure, div.code {
  writing-mode: horizontal-tb;
  -epub-writing-mode: horizontal-tb;
  -webkit-writing-mode: horizontal-tb;
  page-break-inside: avoid;
  break-inside: avoid;
}
pre {
  font-family: monospace;
  font-size: 0.82em;
  line-height: 1.5;
  background: rgba(0,0,0,0.05);
  padding: 0.8em;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}
code { font-family: monospace; font-size: 0.9em; }
table { border-collapse: collapse; font-size: 0.86em; margin: 1em 0; }
th, td { border: 1px solid rgba(0,0,0,0.35); padding: 0.35em 0.6em; }
th { background: rgba(0,0,0,0.06); }
hr { border: 0; border-top: 1px solid rgba(0,0,0,0.3); margin: 1.4em 2em; }
div.figure { text-align: center; margin: 1.2em 0; }
div.figure img { max-width: 100%; max-height: 88vh; height: auto; }
p.caption { font-size: 0.8em; text-align: center; margin-top: 0.3em; }
ruby { ruby-align: center; }
rt { font-size: 0.5em; line-height: 1; text-emphasis: none; }
rp { display: none; }
em.boten {
  font-style: normal;
  -epub-text-emphasis: filled sesame;
  -webkit-text-emphasis: filled sesame;
  text-emphasis: filled sesame;
}
a { color: inherit; }
a.noteref { text-decoration: none; font-size: 0.7em; vertical-align: super; }
aside.footnote { font-size: 0.85em; margin-top: 0.6em; }
section.notes {
  margin-${vertical ? 'right' : 'top'}: 2em;
  padding-${vertical ? 'right' : 'top'}: 1em;
  border-${vertical ? 'right' : 'top'}: 1px solid rgba(0,0,0,0.25);
}
body.cover-body, body.art-body {
  writing-mode: horizontal-tb;
  -epub-writing-mode: horizontal-tb;
  margin: 0;
  padding: 0;
  text-align: center;
}
img.full { display: block; width: 100%; height: auto; }
nav#toc, body.toc-body { writing-mode: ${vertical ? 'vertical-rl' : 'horizontal-tb'}; }
nav#toc ol, body.toc-body ol { list-style: none; padding: 0 1em; }
nav#toc li, body.toc-body li { margin-bottom: 0.7em; }
nav#toc li.sub { font-size: 0.9em; padding-${vertical ? 'top' : 'left'}: 1em; opacity: 0.85; }
`;
}

// ---------------------------------------------------------------------------
// 本文 → XHTML
// ---------------------------------------------------------------------------

interface RenderContext {
  /** 章の番号（0始まり）。 */
  index: number;
  /** 画像のデータURLを、EPUB内のパスに変換する。 */
  image: (src: string) => string | null;
  /** 章をまたぐリンクの行き先を、相対パスに変換する。 */
  link: (chapterIndex: number, anchor: string) => string;
}

function spansToXhtml(spans: Span[], ctx: RenderContext): string {
  return spans
    .map((span) => {
      switch (span.type) {
        case 'text':
          return escapeXml(span.text);
        case 'break':
          return '<br/>';
        case 'strong':
          return `<strong>${spansToXhtml(span.children, ctx)}</strong>`;
        case 'em':
          return `<em>${spansToXhtml(span.children, ctx)}</em>`;
        case 'strike':
          return `<s>${spansToXhtml(span.children, ctx)}</s>`;
        case 'code':
          return `<code>${escapeXml(span.text)}</code>`;
        case 'ruby':
          return `<ruby>${escapeXml(span.base)}<rp>（</rp><rt>${escapeXml(span.ruby)}</rt><rp>）</rp></ruby>`;
        case 'boten':
          return `<em class="boten">${escapeXml(span.text)}</em>`;
        case 'footnote':
          return `<a class="noteref" epub:type="noteref" id="fnref-${span.index}" href="#fn-${span.index}"><sup>[${span.index}]</sup></a>`;
        case 'image': {
          const href = ctx.image(span.src);
          if (!href) return '';
          return `<div class="figure"><img class="full" src="${href}" alt="${escapeXml(span.alt)}"/></div>`;
        }
        case 'link': {
          const inner = spansToXhtml(span.children, ctx);
          if (span.target) {
            return `<a href="${ctx.link(span.target.chapterIndex, span.target.anchor)}">${inner}</a>`;
          }
          const href = safeHref(span.href);
          if (!href) return inner;
          return `<a href="${href}">${inner}</a>`;
        }
        default:
          return '';
      }
    })
    .join('');
}

function blocksToXhtml(blocks: Block[], ctx: RenderContext): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(2, block.level));
        out.push(`<h${level} id="${block.anchor}">${spansToXhtml(block.children, ctx)}</h${level}>`);
        break;
      }
      case 'paragraph': {
        const html = spansToXhtml(block.children, ctx);
        if (!html.trim()) break;
        // 画像だけの段落は、図として組む
        if (/^<div class="figure">/.test(html)) out.push(html);
        else out.push(`<p>${html}</p>`);
        break;
      }
      case 'quote':
        out.push(`<blockquote>${blocksToXhtml(block.blocks, ctx)}</blockquote>`);
        break;
      case 'code':
        out.push(`<div class="code"><pre><code>${escapeXml(block.text)}</code></pre></div>`);
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
        const items = block.items
          .map((item) => `<li>${blocksToXhtml(item, ctx).replace(/^<p>([\s\S]*)<\/p>$/, '$1')}</li>`)
          .join('');
        out.push(`<${tag}${start}>${items}</${tag}>`);
        break;
      }
      case 'table': {
        const head = block.header
          .map((cell, i) => `<th${block.align[i] ? ` style="text-align:${block.align[i]}"` : ''}>${spansToXhtml(cell, ctx)}</th>`)
          .join('');
        const body = block.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell, i) => `<td${block.align[i] ? ` style="text-align:${block.align[i]}"` : ''}>${spansToXhtml(cell, ctx)}</td>`)
                .join('')}</tr>`
          )
          .join('');
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
        break;
      }
      case 'image': {
        const href = ctx.image(block.src);
        if (!href) break;
        const caption = block.caption
          ? `<p class="caption">${escapeXml(block.caption)}</p>`
          : '';
        out.push(`<div class="figure"><img class="full" src="${href}" alt="${escapeXml(block.alt)}"/>${caption}</div>`);
        break;
      }
      case 'hr':
        out.push('<p class="scene-break">＊　＊　＊</p>');
        break;
      default:
        break;
    }
  }
  return out.join('\n  ');
}

function page(title: string, bodyClass: string, body: string, css: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
  <style type="text/css">${css}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  ${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

export async function buildEpub(book: Book, artwork: BookArtwork): Promise<Blob> {
  const zip = new JSZip();
  const vertical = book.options.vertical;
  const css = styleSheet(vertical);
  const uuid = crypto.randomUUID();
  const title = book.meta.title || '無題の本';
  const author = book.meta.author || '著者未設定';

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
  zip.file('OEBPS/style.css', css);

  const manifest: string[] = [
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  const spine: string[] = [];

  // 画像は同じものを二重に入れないよう、データURLごとに1ファイルにまとめる
  const imageFiles = new Map<string, string>();
  const registerImage = (dataUrl: string): string | null => {
    const known = imageFiles.get(dataUrl);
    if (known) return `../${known}`;
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) return null;
    const name = `images/img-${String(imageFiles.size + 1).padStart(3, '0')}.${imageExtension(decoded.mime)}`;
    imageFiles.set(dataUrl, name);
    zip.file(`OEBPS/${name}`, decoded.bytes);
    manifest.push(
      `<item id="img${imageFiles.size}" href="${name}" media-type="${decoded.mime}"/>`
    );
    return `../${name}`;
  };

  let coverMeta = '';
  if (artwork.cover) {
    const ext = imageExtension(artwork.cover.mime);
    zip.file(`OEBPS/images/cover.${ext}`, artwork.cover.bytes);
    manifest.push(
      `<item id="cover-image" href="images/cover.${ext}" media-type="${artwork.cover.mime}" properties="cover-image"/>`,
      '<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>'
    );
    zip.file(
      'OEBPS/text/cover.xhtml',
      page(title, 'cover-body', `<img class="full" src="../images/cover.${ext}" alt="${escapeXml(title)}"/>`, css)
    );
    spine.push('<itemref idref="cover-page" properties="rendition:page-spread-center"/>');
    coverMeta = '\n    <meta name="cover" content="cover-image"/>';
  }

  // 扉
  manifest.push('<item id="titlepage" href="text/title.xhtml" media-type="application/xhtml+xml"/>');
  zip.file(
    'OEBPS/text/title.xhtml',
    page(
      title,
      '',
      `<h1 class="book-title">${escapeXml(title)}</h1>
  ${book.meta.subtitle ? `<p class="no-indent author">${escapeXml(book.meta.subtitle)}</p>` : ''}
  <p class="author">${escapeXml(author)}</p>`,
      css
    )
  );
  spine.push('<itemref idref="titlepage"/>');

  // 読者に見える目次ページ
  const tocLinks = book.chapters
    .map((chapter, i) => {
      const subs = chapter.headings
        .filter((h) => h.anchor !== chapter.anchor)
        .slice(0, 12)
        .map((h) => `<li class="sub"><a href="${chapterFile(i)}#${h.anchor}">${escapeXml(h.text)}</a></li>`)
        .join('\n        ');
      return `<li><a href="${chapterFile(i)}">${escapeXml(chapter.title)}</a></li>${subs ? `\n        ${subs}` : ''}`;
    })
    .join('\n        ');
  manifest.push('<item id="tocpage" href="text/toc.xhtml" media-type="application/xhtml+xml"/>');
  zip.file(
    'OEBPS/text/toc.xhtml',
    page('目次', 'toc-body', `<h1 class="chapter-title">目次</h1>\n  <ol>\n        ${tocLinks}\n  </ol>`, css)
  );
  spine.push('<itemref idref="tocpage"/>');

  const link = (chapterIndex: number, anchor: string) => {
    const file = chapterFile(chapterIndex);
    const chapter = book.chapters[chapterIndex];
    return chapter && chapter.anchor === anchor ? file : `${file}#${anchor}`;
  };

  const navPoints: string[] = [];
  const navList: string[] = [];

  book.chapters.forEach((chapter, i) => {
    const art = artwork.chapterArt[i];
    if (art) {
      const ext = imageExtension(art.mime);
      const name = `images/art-${String(i + 1).padStart(3, '0')}.${ext}`;
      zip.file(`OEBPS/${name}`, art.bytes);
      manifest.push(
        `<item id="art${i + 1}" href="${name}" media-type="${art.mime}"/>`,
        `<item id="artpage${i + 1}" href="text/art-${String(i + 1).padStart(3, '0')}.xhtml" media-type="application/xhtml+xml"/>`
      );
      zip.file(
        `OEBPS/text/art-${String(i + 1).padStart(3, '0')}.xhtml`,
        page(chapter.title, 'art-body', `<img class="full" src="../${name}" alt=""/>`, css)
      );
      spine.push(`<itemref idref="artpage${i + 1}"/>`);
    }

    const ctx: RenderContext = {
      index: i,
      image: registerImage,
      link,
    };
    const body = blocksToXhtml(chapter.blocks, ctx);
    const notes =
      chapter.footnotes.length > 0
        ? `\n  <section class="notes" epub:type="footnotes">\n  ${chapter.footnotes
            .map(
              (note) =>
                `<aside class="footnote" epub:type="footnote" id="fn-${note.index}"><p class="no-indent"><a href="#fnref-${note.index}">[${note.index}]</a> ${blocksToXhtml(
                  note.blocks,
                  ctx
                ).replace(/<\/?p>/g, '')}</p></aside>`
            )
            .join('\n  ')}\n  </section>`
        : '';

    zip.file(
      `OEBPS/text/${chapterFile(i)}`,
      page(
        chapter.title,
        '',
        `<h1 class="chapter-title" id="${chapter.anchor}">${escapeXml(chapter.title)}</h1>
  ${body || '<p class="no-indent"></p>'}${notes}`,
        css
      )
    );
    manifest.push(
      `<item id="chap${i + 1}" href="text/${chapterFile(i)}" media-type="application/xhtml+xml"/>`
    );
    spine.push(`<itemref idref="chap${i + 1}"/>`);
    navPoints.push(
      `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(chapter.title)}</text></navLabel><content src="text/${chapterFile(i)}"/></navPoint>`
    );
    const subs = chapter.headings
      .filter((h) => h.anchor !== chapter.anchor)
      .slice(0, 20)
      .map((h) => `<li class="sub"><a href="text/${chapterFile(i)}#${h.anchor}">${escapeXml(h.text)}</a></li>`)
      .join('\n          ');
    navList.push(
      `<li><a href="text/${chapterFile(i)}">${escapeXml(chapter.title)}</a></li>${subs ? `\n          ${subs}` : ''}`
    );
  });

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="UTF-8"/><title>目次</title><link rel="stylesheet" type="text/css" href="style.css"/><style type="text/css">${css}</style></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目次</h1>
    <ol>
          ${navList.join('\n          ')}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      ${artwork.cover ? '<li><a epub:type="cover" href="text/cover.xhtml">表紙</a></li>' : ''}
      <li><a epub:type="toc" href="text/toc.xhtml">目次</a></li>
      <li><a epub:type="bodymatter" href="text/${chapterFile(0)}">本文</a></li>
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
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
  <navMap>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`
  );

  const description = book.meta.description
    ? `\n    <dc:description>${escapeXml(book.meta.description)}</dc:description>`
    : '';
  const publisher = book.meta.publisher
    ? `\n    <dc:publisher>${escapeXml(book.meta.publisher)}</dc:publisher>`
    : '';
  const subject = book.meta.genre ? `\n    <dc:subject>${escapeXml(book.meta.genre)}</dc:subject>` : '';

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator id="creator">${escapeXml(author)}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:language>ja</dc:language>
    <dc:date>${new Date().toISOString().slice(0, 10)}</dc:date>${description}${publisher}${subject}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    <meta property="rendition:layout">reflowable</meta>
    <meta property="rendition:spread">auto</meta>
    <meta name="primary-writing-mode" content="${vertical ? 'vertical-rl' : 'horizontal-tb'}"/>${coverMeta}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx" page-progression-direction="${vertical ? 'rtl' : 'ltr'}">
    ${spine.join('\n    ')}
  </spine>
</package>`
  );

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  });
}
