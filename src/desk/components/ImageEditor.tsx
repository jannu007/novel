import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_EDIT,
  FULL_CROP,
  clampCrop,
  cropWithRatio,
  filterCss,
  isDefaultEdit,
  renderEdited,
  renderOriented,
  type CropRect,
  type ImageEdit,
} from '../imageEdit';
import { prepareImage, type WorkImage } from '../images';

/**
 * 挿絵の修正画面。
 *
 * 元の画像は残したまま「どう直したか」だけを持ち回るので、
 * 保存したあとでも切り抜き直したり、元に戻したりできる。
 */

const RATIOS: { label: string; value: number | null }[] = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
];

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface Props {
  image: WorkImage;
  onSave: (next: {
    blob: Blob;
    original: Blob;
    edit: ImageEdit;
    width: number;
    height: number;
    mime: string;
  }) => Promise<void>;
  onClose: () => void;
}

export default function ImageEditor({ image, onSave, onClose }: Props) {
  // 以前に修正していなければ、いま表示している画像が元の画像になる
  const [source, setSource] = useState<Blob>(image.original ?? image.blob);
  const [mime, setMime] = useState(image.mime);
  const [edit, setEdit] = useState<ImageEdit>(image.edit ?? DEFAULT_EDIT);
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; crop: CropRect } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // 向きを直したプレビューを作る（切り抜き枠はこの上に重ねる）
  useEffect(() => {
    let revoked = false;
    let url = '';
    renderOriented(source, edit, mime)
      .then((result) => {
        if (revoked) return;
        url = URL.createObjectURL(result.blob);
        setPreview({ url, w: result.width, h: result.height });
      })
      .catch(() => setPreview(null));
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, mime, edit.rotate, edit.flipH]);

  const setCrop = useCallback((crop: CropRect) => {
    setEdit((prev) => ({ ...prev, crop: clampCrop(crop) }));
  }, []);

  function onPointerDown(e: React.PointerEvent, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, crop: edit.crop };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const c = drag.crop;

    if (drag.mode === 'move') {
      setCrop({ ...c, x: c.x + dx, y: c.y + dy });
      return;
    }
    // 角をつまんで大きさを変える。掴んでいない側の角は動かさない。
    let { x, y, w, h } = c;
    if (drag.mode === 'nw') {
      x = c.x + dx;
      y = c.y + dy;
      w = c.w - dx;
      h = c.h - dy;
    } else if (drag.mode === 'ne') {
      y = c.y + dy;
      w = c.w + dx;
      h = c.h - dy;
    } else if (drag.mode === 'sw') {
      x = c.x + dx;
      w = c.w - dx;
      h = c.h + dy;
    } else {
      w = c.w + dx;
      h = c.h + dy;
    }
    if (w < 0.05) {
      w = 0.05;
      if (drag.mode === 'nw' || drag.mode === 'sw') x = c.x + c.w - 0.05;
    }
    if (h < 0.05) {
      h = 0.05;
      if (drag.mode === 'nw' || drag.mode === 'ne') y = c.y + c.h - 0.05;
    }
    setCrop({ x, y, w, h });
  }

  function endDrag() {
    dragRef.current = null;
  }

  function rotate(step: 90 | -90) {
    setEdit((prev) => ({
      ...prev,
      rotate: (prev.rotate + step + 360) % 360,
      // 回転すると縦横が入れ替わるので、切り抜きは全体に戻す
      crop: FULL_CROP,
    }));
  }

  async function replaceFile(file: File) {
    setBusy(true);
    try {
      const prepared = await prepareImage(file);
      setSource(prepared.blob);
      setMime(prepared.mime);
      setEdit(DEFAULT_EDIT);
    } catch {
      alert('この画像は読み込めませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const result = await renderEdited(source, edit, mime);
      await onSave({
        blob: result.blob,
        original: source,
        edit,
        width: result.width,
        height: result.height,
        mime,
      });
      onClose();
    } catch {
      alert('保存できませんでした。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  const crop = edit.crop;

  return (
    <div className="img-edit">
      <div
        className="crop-stage"
        ref={stageRef}
        // 高さを詰めるときは幅も一緒に詰める。画像の周りに余白ができると、
        // 切り抜き枠の位置（割合で置いている）とずれてしまうため。
        style={
          preview
            ? {
                aspectRatio: `${preview.w} / ${preview.h}`,
                maxWidth: `calc(46svh * ${preview.w} / ${preview.h})`,
              }
            : undefined
        }
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {preview ? (
          <>
            <img src={preview.url} alt="" style={{ filter: filterCss(edit) }} />
            <div className="crop-shade" />
            <div
              className="crop-rect"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
              }}
              onPointerDown={(e) => onPointerDown(e, 'move')}
            >
              <div className="crop-window-wrap">
                <img
                  className="crop-window"
                  src={preview.url}
                  alt=""
                  style={{
                    filter: filterCss(edit),
                    width: `${(1 / crop.w) * 100}%`,
                    height: `${(1 / crop.h) * 100}%`,
                    left: `${(-crop.x / crop.w) * 100}%`,
                    top: `${(-crop.y / crop.h) * 100}%`,
                  }}
                />
              </div>
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <span
                  key={corner}
                  className={`crop-handle ${corner}`}
                  onPointerDown={(e) => onPointerDown(e, corner)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="muted" style={{ padding: 30, textAlign: 'center' }}>
            読み込み中…
          </div>
        )}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        向き
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => rotate(-90)}>
          ↺ 左に回転
        </button>
        <button className="btn btn-sm" onClick={() => rotate(90)}>
          ↻ 右に回転
        </button>
        <button
          className={`btn btn-sm ${edit.flipH ? 'btn-seal' : ''}`}
          onClick={() => setEdit((p) => ({ ...p, flipH: !p.flipH }))}
        >
          左右反転
        </button>
      </div>

      <div className="section-title">切り抜き</div>
      <div className="row">
        {RATIOS.map((r) => (
          <button
            key={r.label}
            className="btn btn-sm"
            onClick={() =>
              setCrop(
                preview ? cropWithRatio(r.value, preview.w, preview.h) : FULL_CROP
              )
            }
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        枠の中をドラッグで移動、四隅をドラッグで大きさを変えられます。
      </p>

      <div className="section-title">明るさ・色</div>
      <Slider
        label="明るさ"
        value={edit.brightness}
        onChange={(v) => setEdit((p) => ({ ...p, brightness: v }))}
      />
      <Slider
        label="コントラスト"
        value={edit.contrast}
        onChange={(v) => setEdit((p) => ({ ...p, contrast: v }))}
      />
      <Slider
        label="あざやかさ"
        value={edit.saturate}
        min={0}
        max={2}
        onChange={(v) => setEdit((p) => ({ ...p, saturate: v }))}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void replaceFile(file);
          e.target.value = '';
        }}
      />

      <div className="section-title">そのほか</div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          別の画像に差し替え
        </button>
        <button
          className="btn btn-sm"
          disabled={isDefaultEdit(edit)}
          onClick={() => setEdit(DEFAULT_EDIT)}
        >
          修正をやめて元に戻す
        </button>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn btn-seal" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : 'この内容で保存'}
        </button>
        <button className="btn btn-quiet" disabled={busy} onClick={onClose}>
          やめる
        </button>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min = 0.5,
  max = 1.5,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.02}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b>{Math.round(value * 100)}%</b>
    </label>
  );
}
