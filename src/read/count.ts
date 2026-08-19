/**
 * 本の文字数を数える。
 *
 * 「文字数」は、数え方によって1割ちかく変わる。同じ原稿でも
 *   ・Markdownの記号（`#`、`｜`、`《》`）を数えるか
 *   ・ルビの読み（｜漢字《かんじ》の「かんじ」）を数えるか
 *   ・空白と改行を数えるか
 * で答えが違うため、どれか1つだけを黙って出すと「実際と合わない」ことになる。
 *
 * そこでこのモジュールは4通りを同時に返し、画面ではその内訳を見せる。
 * 本棚に大きく出すのは `body`。
 *
 *   body         … 地の文だけ。見出し（章題）も、Markdownの記号も、
 *                  ルビの読みも、空白・改行も数えない。
 *                  **同じリポジトリの執筆アプリ（文机・製本所）と同じ数え方**で、
 *                  書いているときに見ていた数とそのまま突き合わせられる。
 *   withHeadings … body に、見出し（章題）の文字を足したもの。
 *   withRuby     … さらに、ルビの読みを足したもの。
 *   raw          … 取り込んだファイルそのままの長さ（記号も改行も全部）。
 *                  文章を書く道具（エディタ）が出す数はたいていこれ。
 */

import type { Block, Inline } from './markdown';

export interface BookCounts {
  /** 地の文だけ（見出し・記号・ルビの読み・空白を除く）。執筆アプリと同じ数え方。 */
  body: number;
  /** 地の文＋見出し（章題） */
  withHeadings: number;
  /** さらにルビの読みを足したもの */
  withRuby: number;
  /** 原文そのまま（Markdownの記号・改行を含む） */
  raw: number;
}

/** 何を数に入れるか。 */
export interface CountOptions {
  /** 見出し（章題）を数えるか。執筆アプリは数えないので、既定は false。 */
  headings?: boolean;
  /** ルビの読みを数えるか。読みは分量ではないので、既定は false。 */
  ruby?: boolean;
}

/**
 * 空白と改行を除いた長さ。
 * 全角スペース（字下げ）も空白として扱う（`\s` に含まれる）。
 */
export function visibleLength(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** ひとつづきの文字列から、数える対象だけを取り出す。 */
function inlineChars(nodes: Inline[], withRuby: boolean): number {
  let n = 0;
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
      case 'boten':
        n += visibleLength(node.text);
        break;
      case 'ruby':
        // 親文字は本文。読みは「本文に足すか」を選べるようにする
        n += visibleLength(node.base);
        if (withRuby) n += visibleLength(node.ruby);
        break;
      case 'image':
        // 挿絵の代替文字は読者に見えないので数えない
        break;
      case 'br':
        break;
      default:
        n += inlineChars(node.children, withRuby);
    }
  }
  return n;
}

/** ひとかたまり（段落・見出しなど）の文字数。 */
export function blockChars(block: Block, opts: CountOptions = {}): number {
  const ruby = opts.ruby ?? false;
  switch (block.type) {
    case 'paragraph':
      return inlineChars(block.children, ruby);
    case 'heading':
      return opts.headings ? visibleLength(block.plain) : 0;
    case 'code':
      return visibleLength(block.code);
    case 'quote':
      return block.children.reduce((n, b) => n + blockChars(b, opts), 0);
    case 'list':
      return block.items.reduce(
        (n, item) => n + item.reduce((m, b) => m + blockChars(b, opts), 0),
        0
      );
    case 'table':
      return (
        block.head.reduce((n, cell) => n + inlineChars(cell, ruby), 0) +
        block.rows.reduce(
          (n, row) => n + row.reduce((m, cell) => m + inlineChars(cell, ruby), 0),
          0
        )
      );
    default:
      // 挿絵・区切り線には数える文字が無い
      return 0;
  }
}

/** ひとまとまりの本文の文字数。 */
export function countBlocks(blocks: Block[], opts: CountOptions = {}): number {
  return blocks.reduce((n, b) => n + blockChars(b, opts), 0);
}

/**
 * 数え方を変えたときに、本棚にある本の数を数え直すための目印。
 * 保存してある本の `countRule` がこれと違えば、その本は数え直す。
 */
export const COUNT_RULE = 3;
