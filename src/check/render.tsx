/**
 * EPUBの本文（XHTML）を、安全にReact要素へ変換する。
 *
 * `dangerouslySetInnerHTML` は使わない。決められたタグだけを許可リストで
 * 個別にReact要素へ組み立て、`<script>` などの危険なタグは中身ごと捨てる。
 * 許可リストに無いタグは、そのタグだけを外して中身は残す（実行はしない）。
 *
 * 画像・内部リンクは、自分で調べた画像一覧（epub.ts の images）と章一覧だけを頼りに
 * 解決する。XHTML中の src・href の文字列をそのままDOMへ渡すことはしない。
 */

import { createElement, type ReactNode } from 'react';
import type { ParsedBook, ParsedImage } from './epub';

const DANGEROUS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'head']);

const BLOCK: Record<string, string> = {
  p: 'p',
  div: 'div',
  section: 'div',
  aside: 'div',
  blockquote: 'blockquote',
  h1: 'h2',
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
  h5: 'h6',
  h6: 'h6',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
};

const INLINE: Record<string, string> = {
  em: 'em',
  i: 'em',
  strong: 'strong',
  b: 'strong',
  sup: 'sup',
  sub: 'sub',
  span: 'span',
  ruby: 'ruby',
  rt: 'rt',
  rp: 'rp',
};

function resolveRelative(basePath: string, href: string): string {
  const baseDir = basePath.slice(0, basePath.lastIndexOf('/') + 1);
  try {
    const url = new URL(href.split('#')[0], `file:///${baseDir}`);
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return href;
  }
}

export interface RenderCtx {
  basePath: string;
  images: Map<string, ParsedImage>;
  chapterIndexByPath: Map<string, number>;
  onJump: (index: number) => void;
}

let keySeq = 0;

function renderChildren(el: Element, ctx: RenderCtx): ReactNode[] {
  const out: ReactNode[] = [];
  el.childNodes.forEach((child) => {
    const node = renderNode(child, ctx);
    if (node !== null) out.push(node);
  });
  return out;
}

export function renderNode(node: Node, ctx: RenderCtx): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

  if (DANGEROUS.has(tag)) return null;

  if (tag === 'br') return createElement('br', { key: `k${keySeq++}` });

  if (tag === 'img') {
    const src = el.getAttribute('src');
    if (!src) return null;
    const path = resolveRelative(ctx.basePath, src);
    const img = ctx.images.get(path);
    if (!img) return null;
    return createElement('img', {
      key: `k${keySeq++}`,
      src: img.url,
      alt: el.getAttribute('alt') ?? '',
      className: 'book-image',
    });
  }

  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    const children = renderChildren(el, ctx);
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      return createElement(
        'a',
        { key: `k${keySeq++}`, href, target: '_blank', rel: 'noopener noreferrer' },
        ...children
      );
    }
    const path = resolveRelative(ctx.basePath, href);
    const targetIndex = ctx.chapterIndexByPath.get(path);
    if (targetIndex !== undefined) {
      return createElement(
        'button',
        {
          key: `k${keySeq++}`,
          type: 'button',
          className: 'in-text-link',
          onClick: () => ctx.onJump(targetIndex),
        },
        ...children
      );
    }
    return createElement('span', { key: `k${keySeq++}` }, ...children);
  }

  const blockTag = BLOCK[tag];
  if (blockTag) {
    const cls = el.getAttribute('class');
    const className = cls === 'boten' ? 'boten' : cls === 'no-indent' ? 'no-indent' : undefined;
    return createElement(blockTag, { key: `k${keySeq++}`, className }, ...renderChildren(el, ctx));
  }

  const inlineTag = INLINE[tag];
  if (inlineTag) {
    return createElement(inlineTag, { key: `k${keySeq++}` }, ...renderChildren(el, ctx));
  }

  // 許可リストに無いタグは、そのタグだけ外して中身を残す
  return createElement('span', { key: `k${keySeq++}` }, ...renderChildren(el, ctx));
}

export function renderChapterBody(chapter: ParsedBook['chapters'][number], ctx: RenderCtx): ReactNode {
  const body = chapter.doc.body ?? chapter.doc.documentElement;
  if (!body) return null;
  return renderChildren(body, ctx);
}
