/**
 * 本文を画面に表示するための描画。
 *
 * ここでは `dangerouslySetInnerHTML` を一切使わない。原稿は解析済みの
 * ブロックとスパンの形でしか渡ってこないので、どんな原稿を読み込ませても
 * 画面上でスクリプトが動くことはない。
 */

import { Fragment, type ReactNode } from 'react';
import type { Block, Span } from './markdown';

export interface RenderOptions {
  /** 内部リンクを押したときの動き（プレビューでは同じ画面の中で移動する）。 */
  onJump?: (chapterIndex: number, anchor: string) => void;
}

function SpanView({ span, options }: { span: Span; options: RenderOptions }): ReactNode {
  switch (span.type) {
    case 'text':
      return span.text;
    case 'break':
      return <br />;
    case 'strong':
      return <strong>{renderSpans(span.children, options)}</strong>;
    case 'em':
      return <em>{renderSpans(span.children, options)}</em>;
    case 'strike':
      return <s>{renderSpans(span.children, options)}</s>;
    case 'code':
      return <code className="inline-code">{span.text}</code>;
    case 'ruby':
      return (
        <ruby>
          {span.base}
          <rp>（</rp>
          <rt>{span.ruby}</rt>
          <rp>）</rp>
        </ruby>
      );
    case 'boten':
      return <em className="boten">{span.text}</em>;
    case 'footnote':
      return (
        <a className="noteref" href={`#fn-${span.index}`}>
          <sup>[{span.index}]</sup>
        </a>
      );
    case 'image':
      return <img className="inline-figure" src={span.src} alt={span.alt} />;
    case 'link': {
      const children = renderSpans(span.children, options);
      if (span.target) {
        const target = span.target;
        return (
          <a
            className="link internal"
            href={`#${target.anchor}`}
            onClick={(event) => {
              if (!options.onJump) return;
              event.preventDefault();
              options.onJump(target.chapterIndex, target.anchor);
            }}
          >
            {children}
          </a>
        );
      }
      if (span.external && /^(https?:|mailto:|tel:)/i.test(span.href)) {
        return (
          <a className="link external" href={span.href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      }
      return <>{children}</>;
    }
    default:
      return null;
  }
}

export function renderSpans(spans: Span[], options: RenderOptions = {}): ReactNode {
  return spans.map((span, i) => (
    <Fragment key={i}>
      <SpanView span={span} options={options} />
    </Fragment>
  ));
}

function BlockView({ block, options }: { block: Block; options: RenderOptions }): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(2, block.level))}` as 'h2';
      return <Tag id={block.anchor}>{renderSpans(block.children, options)}</Tag>;
    }
    case 'paragraph': {
      const image = block.children.find((s) => s.type === 'image');
      if (image && block.children.length === 1 && image.type === 'image') {
        return (
          <figure className="figure">
            <img src={image.src} alt={image.alt} />
          </figure>
        );
      }
      return <p>{renderSpans(block.children, options)}</p>;
    }
    case 'quote':
      return <blockquote>{renderBlocks(block.blocks, options)}</blockquote>;
    case 'code':
      return (
        <pre className="code-block">
          <code>{block.text}</code>
        </pre>
      );
    case 'list':
      return block.ordered ? (
        <ol start={block.start}>
          {block.items.map((item, i) => (
            <li key={i}>{renderBlocks(item, options)}</li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderBlocks(item, options)}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} style={block.align[i] ? { textAlign: block.align[i] } : undefined}>
                    {renderSpans(cell, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={block.align[c] ? { textAlign: block.align[c] } : undefined}>
                      {renderSpans(cell, options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return (
        <figure className="figure">
          <img src={block.src} alt={block.alt} />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    case 'hr':
      return <p className="scene-break">＊　＊　＊</p>;
    default:
      return null;
  }
}

export function renderBlocks(blocks: Block[], options: RenderOptions = {}): ReactNode {
  return blocks.map((block, i) => (
    <Fragment key={i}>
      <BlockView block={block} options={options} />
    </Fragment>
  ));
}
