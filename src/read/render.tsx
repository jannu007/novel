/**
 * 解析済みの本文（AST）を、Reactの要素として組み立てる。
 *
 * ここが「本文をHTMLとして解釈しない」という安全上の約束を守っている場所で、
 * このアプリには本文からHTML文字列を作る処理（`dangerouslySetInnerHTML`）が
 * 1か所も無い。文字列は必ずReactのテキストノードとして描かれるため、
 * `<script>` や `<img onerror=…>` と書かれていても、そのまま文字として見えるだけになる。
 */

import type { ReactNode } from 'react';
import type { Block, Inline } from './markdown';

interface RenderOptions {
  /** 本の中のリンク（`#見出し`）を押したときの移動 */
  onJump?: (id: string) => void;
  /** 検索などで強調したいブロックの番号 */
  highlight?: number;
}

function renderInline(nodes: Inline[], opts: RenderOptions): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'br':
        return <br key={i} />;
      case 'code':
        return (
          <code className="md-code" key={i}>
            {node.text}
          </code>
        );
      case 'em':
        return <em key={i}>{renderInline(node.children, opts)}</em>;
      case 'strong':
        return <strong key={i}>{renderInline(node.children, opts)}</strong>;
      case 'del':
        return <del key={i}>{renderInline(node.children, opts)}</del>;
      case 'ruby':
        return (
          <ruby key={i}>
            {node.base}
            <rp>（</rp>
            <rt>{node.ruby}</rt>
            <rp>）</rp>
          </ruby>
        );
      case 'boten':
        return (
          <em className="boten" key={i}>
            {node.text}
          </em>
        );
      case 'image':
        return <img className="md-inline-img" key={i} src={node.src} alt={node.alt} />;
      case 'link': {
        if (node.href.startsWith('#')) {
          const id = node.href.slice(1);
          return (
            <button
              type="button"
              className="md-jump"
              key={i}
              onClick={() => opts.onJump?.(id)}
            >
              {renderInline(node.children, opts)}
            </button>
          );
        }
        return (
          <a
            key={i}
            href={node.href}
            title={node.title}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {renderInline(node.children, opts)}
          </a>
        );
      }
    }
  });
}

function renderBlock(block: Block, key: number, opts: RenderOptions): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level, 6)}` as 'h1';
      return (
        <Tag key={key} id={block.id} data-anchor={block.id} className={`md-h md-h${block.level}`}>
          {renderInline(block.children, opts)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="md-p">
          {renderInline(block.children, opts)}
        </p>
      );
    case 'figure':
      return (
        <figure key={key} className="md-figure">
          <img src={block.src} alt={block.alt} />
          {block.alt && <figcaption>{block.alt}</figcaption>}
        </figure>
      );
    case 'code':
      return (
        <pre key={key} className="md-pre" data-lang={block.lang || undefined}>
          <code>{block.code}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} className="md-hr" />;
    case 'quote':
      return (
        <blockquote key={key} className="md-quote">
          {block.children.map((b, i) => renderBlock(b, i, opts))}
        </blockquote>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          {item.map((b, j) =>
            block.tight && b.type === 'paragraph' ? (
              <span key={j} className="md-tight">
                {renderInline(b.children, opts)}
              </span>
            ) : (
              renderBlock(b, j, opts)
            )
          )}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} className="md-list" start={block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {items}
        </ul>
      );
    }
    case 'table':
      return (
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} style={{ textAlign: block.align[i] ?? undefined }}>
                    {renderInline(cell, opts)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ textAlign: block.align[j] ?? undefined }}>
                      {renderInline(cell, opts)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** 章のブロック列を描く。ページの割り出しに使う目印（data-b）も付ける。 */
export function RenderBlocks({
  blocks,
  onJump,
  highlight,
}: {
  blocks: Block[];
  onJump?: (id: string) => void;
  highlight?: number;
}) {
  const opts: RenderOptions = { onJump, highlight };
  return (
    <>
      {blocks.map((block, i) => (
        <div
          key={i}
          data-b={i}
          className={`md-block${highlight === i ? ' md-block-hit' : ''}`}
        >
          {renderBlock(block, i, opts)}
        </div>
      ))}
    </>
  );
}
