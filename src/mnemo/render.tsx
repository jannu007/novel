/**
 * 解析済みの本文を、印つきでReactの要素として組み立てる。
 *
 * 栞の描画（`src/read/render.tsx`）とねらいは同じで、本文をHTMLとして
 * 解釈する場所（`dangerouslySetInnerHTML`）を1か所も持たない。
 * 文字は必ずReactのテキストノードとして描かれるので、原稿に `<script>` と
 * 書いてあっても、そのまま文字として見えるだけになる。
 *
 * 栞と違うのは、**地の文の位置で印を重ねられる**こと。
 * 印は「このかたまりの何文字目から何文字目まで」で持っているので、
 * 描きながら文字数を数え、印の境目で文字を切って包む。
 * 数え方は `draft.ts` の `plainInline` と必ず同じでなければならない
 * （片方だけ直すと、選んだところと印がずれる）。
 */

import type { ReactNode } from 'react';
import type { Block, Inline } from '../read/markdown';
import type { AnchoredMark } from './draft';

export interface RenderOptions {
  /** 本の中のリンク（`#見出し`）を押したときの移動 */
  onJump?: (id: string) => void;
  /** 本の外を指すリンクを押したとき。押しただけでは開かず、確認を出すために呼ぶ。 */
  onExternal?: (href: string) => void;
  /** 検索で見つけたかたまり */
  highlight?: number;
  /** かたまりの番号 → そこに付いている印 */
  marks?: Map<number, AnchoredMark[]>;
  /** 印を押したとき */
  onMark?: (id: string) => void;
}

/**
 * 描いている最中の「いま何文字目か」。
 * 1つのかたまりを描くあいだだけ使い、次のかたまりで 0 に戻す。
 */
interface Cursor {
  at: number;
  marks: AnchoredMark[];
  onMark?: (id: string) => void;
}

/**
 * 地の文を、印の境目で切り分けて描く。
 *
 * 重なった印は、いちばん内側（あとから始まったもの）の色で塗る。
 * 何色も重ねると読めなくなるので、色は1つに絞っている。
 */
function renderText(text: string, cursor: Cursor | null, key: number): ReactNode {
  if (!cursor || cursor.marks.length === 0) {
    if (cursor) cursor.at += text.length;
    return text;
  }
  const from = cursor.at;
  const to = from + text.length;
  cursor.at = to;

  /** この文字のかたまりに掛かっている印だけを見る */
  const hits = cursor.marks.filter((m) => m.start < to && m.end > from);
  if (hits.length === 0) return text;

  // 印の境目を集めて、そこで文字を切る
  const cuts = new Set<number>([from, to]);
  for (const m of hits) {
    if (m.start > from) cuts.add(m.start);
    if (m.end < to) cuts.add(m.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const out: ReactNode[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const piece = text.slice(a - from, b - from);
    if (piece === '') continue;
    // その区間を覆っている印のうち、いちばんあとに始まったもの
    const covering = hits.filter((m) => m.start <= a && m.end >= b);
    const top = covering[covering.length - 1];
    if (!top) {
      out.push(piece);
      continue;
    }
    out.push(
      <mark
        key={`${key}-${i}`}
        className={`mk mk-${top.kind}`}
        data-mark={top.id}
        title={top.note || undefined}
        onClick={(e) => {
          if (!cursor.onMark) return;
          // 押した合図が背後のページ送りに伝わらないようにする
          e.stopPropagation();
          cursor.onMark(top.id);
        }}
        onPointerDown={(e) => cursor.onMark && e.stopPropagation()}
        onPointerUp={(e) => cursor.onMark && e.stopPropagation()}
      >
        {piece}
      </mark>
    );
  }
  return <span key={key}>{out}</span>;
}

function renderInline(nodes: Inline[], opts: RenderOptions, cursor: Cursor | null): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return renderText(node.text, cursor, i);
      case 'br':
        if (cursor) cursor.at += 1;
        return <br key={i} />;
      case 'code':
        return (
          <code className="md-code" key={i}>
            {renderText(node.text, cursor, i)}
          </code>
        );
      case 'em':
        return <em key={i}>{renderInline(node.children, opts, cursor)}</em>;
      case 'strong':
        return <strong key={i}>{renderInline(node.children, opts, cursor)}</strong>;
      case 'del':
        return <del key={i}>{renderInline(node.children, opts, cursor)}</del>;
      case 'ruby':
        return (
          <ruby key={i}>
            {renderText(node.base, cursor, i)}
            <rp>（</rp>
            <rt>{node.ruby}</rt>
            <rp>）</rp>
          </ruby>
        );
      case 'boten':
        return (
          <em className="boten" key={i}>
            {renderText(node.text, cursor, i)}
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
              {renderInline(node.children, opts, cursor)}
            </button>
          );
        }
        /*
         * 本の外を指すリンクは `<a href>` にしない。
         * 踏んだ瞬間に外へ接続が飛ぶと、それだけで
         * 「この端末がこの原稿を開いている」という事実が相手側に残る。
         * 押しても移動せず、行き先を見せて確かめてもらう。
         */
        return (
          <button
            type="button"
            className="md-link-out"
            key={i}
            title={node.title}
            data-href={node.href}
            onClick={() => opts.onExternal?.(node.href)}
          >
            {renderInline(node.children, opts, cursor)}
          </button>
        );
      }
    }
  });
}

function renderBlock(
  block: Block,
  key: number,
  opts: RenderOptions,
  cursor: Cursor | null
): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level, 6)}` as 'h1';
      return (
        <Tag
          key={key}
          id={block.id}
          data-anchor={block.id}
          className={`md-h md-h${block.level}`}
        >
          {renderInline(block.children, opts, cursor)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="md-p">
          {renderInline(block.children, opts, cursor)}
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
          <code>{renderText(block.code, cursor, 0)}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} className="md-hr" />;
    case 'quote':
      return (
        <blockquote key={key} className="md-quote">
          {block.children.map((b, i) => renderBlock(b, i, opts, cursor))}
        </blockquote>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          {item.map((b, j) =>
            block.tight && b.type === 'paragraph' ? (
              <span key={j} className="md-tight">
                {renderInline(b.children, opts, cursor)}
              </span>
            ) : (
              renderBlock(b, j, opts, cursor)
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
                    {renderInline(cell, opts, cursor)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ textAlign: block.align[j] ?? undefined }}>
                      {renderInline(cell, opts, cursor)}
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

/**
 * 章のかたまりを描く。
 * ページの割り出しに使う目印（`data-b`）は栞と同じ形にしてあるので、
 * 組み上がりを測る `layoutFlow` をそのまま使える。
 */
export function RenderBlocks({
  blocks,
  onJump,
  onExternal,
  highlight,
  marks,
  onMark,
}: {
  blocks: Block[];
} & RenderOptions) {
  const opts: RenderOptions = { onJump, onExternal, highlight, marks, onMark };
  return (
    <>
      {blocks.map((block, i) => {
        const here = marks?.get(i);
        // 印の無いかたまりは、文字数を数える手間もかけない
        const cursor: Cursor | null = here ? { at: 0, marks: here, onMark } : null;
        return (
          <div
            key={i}
            data-b={i}
            className={`md-block${highlight === i ? ' md-block-hit' : ''}`}
          >
            {renderBlock(block, i, opts, cursor)}
          </div>
        );
      })}
    </>
  );
}
