import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { imageNotation, parseImageLine } from '../../lib/blockContent';
import { insertRubyNotation, insertEmphasisNotation } from '../../lib/inlineMarkup';
import { CloseIcon } from './Icons';

/**
 * 挿絵をその場に表示しながら書ける本文エディタ。
 *
 * 本文は「文章のかたまり」と「挿絵」が交互に並んだものとして扱い、
 * 文章の部分だけを textarea にする。こうすると挿絵を実際の絵として
 * 見せながら、文字の入力・変換・選択はブラウザ本来のものがそのまま使える。
 *
 * 挿絵のない章では textarea が1つだけになるので、見た目も操作も
 * これまでとまったく同じになる。
 */

type Segment =
  | { kind: 'text'; lines: string[] }
  | { kind: 'image'; id: string };

/**
 * 本文を段に分ける。挿絵の前後には必ず文章の段を置き、
 * どこにでも文字を入力できるようにしている。
 */
function toSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let lines: string[] = [];
  const flush = () => {
    segments.push({ kind: 'text', lines });
    lines = [];
  };
  for (const line of content.split(/\r?\n/)) {
    const imageId = parseImageLine(line);
    if (imageId) {
      flush();
      segments.push({ kind: 'image', id: imageId });
    } else {
      lines.push(line);
    }
  }
  flush();
  return segments;
}

/** 段の並びを本文の文字列に戻す（分ける前とまったく同じ形になる）。 */
function toContent(segments: Segment[]): string {
  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'image') lines.push(imageNotation(segment.id));
    else lines.push(...segment.lines);
  }
  return lines.join('\n');
}

export interface EditorImage {
  url: string;
  caption: string;
  /** 本文に対する大きさの割合（0〜1） */
  scale: number;
}

export interface MarkupEditorHandle {
  /** 直前に触れていた文章の段にルビを振る */
  insertRuby(): void;
  insertBoten(): void;
  /** 直前に触れていた位置に挿絵を差し込む */
  insertImage(id: string): void;
}

interface Props {
  content: string;
  vertical: boolean;
  images: Map<string, EditorImage>;
  placeholder?: string;
  onChange: (content: string) => void;
  /** 挿絵をその位置から外す（画像そのものは残る） */
  onDetachImage: (id: string) => void;
  /** 挿絵を押したとき（修正画面を開く） */
  onEditImage: (id: string) => void;
}

const MarkupEditor = forwardRef<MarkupEditorHandle, Props>(function MarkupEditor(
  { content, vertical, images, placeholder, onChange, onDetachImage, onEditImage },
  ref
) {
  const segments = useMemo(() => toSegments(content), [content]);
  // 余白を受け持つ段（末尾の文章）。ここを広げておくと、
  // 本文の下（縦書きでは左）の空いた場所を触っても文字を入力できる。
  const lastTextIndex = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].kind === 'text') return i;
    }
    return -1;
  }, [segments]);
  const areaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  // 最後に触れていた文章の段。ボタン操作の対象になる。
  const lastIndex = useRef(0);

  /**
   * textarea を中身の大きさに合わせる。
   * 縦書きでは「幅」が、横書きでは「高さ」が中身の量で決まる。
   * flex で引き伸ばされた状態だと実寸が測れないので、
   * いったん最小にしてから測り直している。
   */
  const fit = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.flex = '0 0 auto';
      if (vertical) {
        el.style.height = '100%';
        el.style.width = '0px';
        el.style.width = `${el.scrollWidth}px`;
      } else {
        el.style.width = '100%';
        el.style.height = '0px';
        el.style.height = `${el.scrollHeight}px`;
      }
      // 余った場所は最後の段だけが受け持つ。すべての段を伸ばすと、
      // 挿絵の手前の段まで間延びしてしまう。
      el.style.flexGrow = el.dataset.grow === '1' ? '1' : '0';
      el.style.flexShrink = '0';
      el.style.flexBasis = 'auto';
    },
    [vertical]
  );

  useLayoutEffect(() => {
    for (const el of areaRefs.current) fit(el);
  }, [segments, fit, content]);

  // 画面の大きさが変わったら測り直す
  useEffect(() => {
    const onResize = () => {
      for (const el of areaRefs.current) fit(el);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit]);

  function replaceSegment(index: number, lines: string[]) {
    const next = segments.map((s, i) =>
      i === index && s.kind === 'text' ? { kind: 'text' as const, lines } : s
    );
    onChange(toContent(next));
  }

  /** 対象の textarea に対して文字列の差し替えを行い、選択位置を戻す。 */
  function editActive(
    build: (value: string, start: number, end: number) => {
      text: string;
      selectionStart: number;
      selectionEnd: number;
    } | null
  ) {
    const index = lastIndex.current;
    const el = areaRefs.current[index];
    if (!el) return;
    const result = build(el.value, el.selectionStart, el.selectionEnd);
    if (!result) return;
    replaceSegment(index, result.text.split('\n'));
    requestAnimationFrame(() => {
      const again = areaRefs.current[index];
      if (!again) return;
      again.focus();
      again.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  useImperativeHandle(ref, () => ({
    insertRuby() {
      editActive((value, start, end) => {
        if (start === end) {
          alert('ふりがなを振る文字を選んでください。');
          return null;
        }
        const reading = prompt('ふりがな', '');
        if (reading === null || reading.trim() === '') return null;
        return insertRubyNotation(value, start, end, reading.trim());
      });
    },
    insertBoten() {
      editActive((value, start, end) => {
        if (start === end) {
          alert('傍点を打つ文字を選んでください。');
          return null;
        }
        return insertEmphasisNotation(value, start, end);
      });
    },
    insertImage(id: string) {
      const index = lastIndex.current;
      const el = areaRefs.current[index];
      const segment = segments[index];
      if (!el || !segment || segment.kind !== 'text') {
        // 触れていた段が見つからないときは、いちばん後ろに足す
        onChange(toContent([...segments, { kind: 'image', id }, { kind: 'text', lines: [] }]));
        return;
      }
      // カーソルのある行で文章を切り分け、その境目に挿絵を挟む
      const caret = el.selectionStart;
      const before = el.value.slice(0, caret);
      const after = el.value.slice(caret);
      const beforeLines = before === '' ? [] : before.split('\n');
      const afterLines = after === '' ? [] : after.split('\n');
      // 行の境目にカーソルがある場合、そこにできる空の行は挿絵の行に置き換える。
      // 残したままだと空行になり、シーン区切り（＊）として書き出されてしまう。
      if (before.endsWith('\n')) beforeLines.pop();
      if (after.startsWith('\n')) afterLines.shift();
      const next: Segment[] = [
        ...segments.slice(0, index),
        { kind: 'text', lines: beforeLines },
        { kind: 'image', id },
        { kind: 'text', lines: afterLines },
        ...segments.slice(index + 1),
      ];
      onChange(toContent(next));
    },
  }));

  return (
    <div className={`seg-editor ${vertical ? 'tategaki' : ''}`}>
      {segments.map((segment, index) => {
        if (segment.kind === 'image') {
          const image = images.get(segment.id);
          return (
            <figure
              className="seg-image"
              key={`img-${segment.id}-${index}`}
              style={{ ['--fig-scale' as string]: image?.scale ?? 0.62 }}
              onClick={() => onEditImage(segment.id)}
              title="押すと修正できます"
            >
              {image ? (
                <img src={image.url} alt={image.caption || '挿絵'} />
              ) : (
                <div className="seg-image-missing">画像が見つかりません</div>
              )}
              {image?.caption && <figcaption>{image.caption}</figcaption>}
              <span className="seg-image-hint">押して修正</span>
              <button
                type="button"
                className="seg-image-remove"
                aria-label="この位置から外す"
                title="この位置から外す"
                onClick={(e) => {
                  e.stopPropagation();
                  onDetachImage(segment.id);
                }}
              >
                <CloseIcon />
              </button>
            </figure>
          );
        }
        return (
          <textarea
            key={`text-${index}`}
            ref={(el) => {
              areaRefs.current[index] = el;
            }}
            className="manuscript"
            data-grow={index === lastTextIndex ? '1' : '0'}
            value={segment.lines.join('\n')}
            placeholder={index === 0 ? placeholder : undefined}
            spellCheck={false}
            onFocus={() => {
              lastIndex.current = index;
            }}
            onChange={(e) => {
              lastIndex.current = index;
              replaceSegment(index, e.target.value.split('\n'));
            }}
          />
        );
      })}
    </div>
  );
});

export default MarkupEditor;
