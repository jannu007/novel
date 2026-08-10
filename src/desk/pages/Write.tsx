import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWork } from '../useWork';
import { AppBar, TabBar, Sheet, NotFound } from '../components/Chrome';
import {
  ListIcon,
  ExpandIcon,
  ShrinkIcon,
  PlusIcon,
  TrashIcon,
  ImageIcon,
  TategakiIcon,
  YokogakiIcon,
} from '../components/Icons';
import MarkupEditor, {
  type MarkupEditorHandle,
  type EditorImage,
} from '../components/MarkupEditor';
import ImageEditor from '../components/ImageEditor';
import { countChars, countNovelChars, todayStr } from '../../lib/textStats';
import { listImageIds, removeImageFromContent } from '../../lib/blockContent';
import { figureScale } from '../imageEdit';
import {
  listImages,
  saveImage,
  deleteImage,
  prepareImage,
  type WorkImage,
} from '../images';
import type { Chapter } from '../../types';

const VERTICAL_KEY = 'fuzukue:vertical';

export default function Write() {
  const { id } = useParams();
  const { work, update, saveState } = useWork(id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showChapters, setShowChapters] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [focus, setFocus] = useState(false);
  const [vertical, setVertical] = useState(
    () => localStorage.getItem(VERTICAL_KEY) !== 'no'
  );
  const [images, setImages] = useState<WorkImage[]>([]);
  const [busyImage, setBusyImage] = useState(false);
  /** 修正中の画像 */
  const [editingImage, setEditingImage] = useState<WorkImage | null>(null);
  /** 挿絵一覧から修正画面を開いたか（閉じたときの戻り先を決める） */
  const [cameFromList, setCameFromList] = useState(false);
  const editorRef = useRef<MarkupEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const baselineDone = useRef(false);

  const chapters = useMemo(
    () => (work ? [...work.chapters].sort((a, b) => a.order - b.order) : []),
    [work]
  );

  useEffect(() => {
    if (!activeId && chapters.length > 0) setActiveId(chapters[0].id);
  }, [chapters, activeId]);

  useEffect(() => {
    localStorage.setItem(VERTICAL_KEY, vertical ? 'yes' : 'no');
  }, [vertical]);

  const refreshImages = useCallback(async () => {
    if (!id) return;
    setImages(await listImages(id));
  }, [id]);

  // 本文に表示するための一時URL。画像が入れ替わるたびに作り直して解放する。
  const [imageViews, setImageViews] = useState<Map<string, EditorImage>>(new Map());
  useEffect(() => {
    const map = new Map<string, EditorImage>();
    const urls: string[] = [];
    for (const image of images) {
      const url = URL.createObjectURL(image.blob);
      urls.push(url);
      map.set(image.id, {
        url,
        caption: image.caption,
        scale: figureScale(image.size),
      });
    }
    setImageViews(map);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [images]);

  useEffect(() => {
    void refreshImages();
  }, [refreshImages]);

  // 「今日書いた分」の基準を、日付が変わったら取り直す
  useEffect(() => {
    if (!work || baselineDone.current) return;
    baselineDone.current = true;
    const today = todayStr();
    if (work.progressBaseline?.date !== today) {
      const total = countNovelChars(work.chapters);
      update((w) => ({ ...w, progressBaseline: { date: today, chars: total } }));
    }
  }, [work, update]);

  useEffect(() => {
    document.body.style.overflow = focus ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [focus]);

  if (work === undefined) return <div className="body muted">読み込み中…</div>;
  if (work === null) return <NotFound />;

  const active = chapters.find((c) => c.id === activeId) ?? null;
  const total = countNovelChars(work.chapters);
  const today = Math.max(0, total - (work.progressBaseline?.chars ?? 0));
  const dailyTarget = work.goal?.dailyWordTarget || 1000;
  const usedImageIds = new Set(work.chapters.flatMap((c) => listImageIds(c.content)));

  function patch(chapterId: string, part: Partial<Chapter>) {
    update((w) => ({
      ...w,
      chapters: w.chapters.map((c) =>
        c.id === chapterId ? { ...c, ...part, updatedAt: Date.now() } : c
      ),
    }));
  }

  function addChapter() {
    const now = Date.now();
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      title: `第${chapters.length + 1}章`,
      content: '',
      order: chapters.length,
      memo: '',
      createdAt: now,
      updatedAt: now,
    };
    update((w) => ({ ...w, chapters: [...w.chapters, chapter] }));
    setActiveId(chapter.id);
    setShowChapters(false);
  }

  function removeChapter(chapterId: string) {
    if (chapters.length <= 1) {
      alert('最後の章は削除できません。');
      return;
    }
    const target = chapters.find((c) => c.id === chapterId);
    if (!confirm(`「${target?.title || '無題'}」を削除します。`)) return;
    const rest = chapters.filter((c) => c.id !== chapterId).map((c, i) => ({ ...c, order: i }));
    update((w) => ({ ...w, chapters: rest }));
    if (activeId === chapterId) setActiveId(rest[0]?.id ?? null);
  }

  function moveChapter(chapterId: string, dir: -1 | 1) {
    const i = chapters.findIndex((c) => c.id === chapterId);
    const j = i + dir;
    if (j < 0 || j >= chapters.length) return;
    const next = [...chapters];
    [next[i], next[j]] = [next[j], next[i]];
    update((w) => ({ ...w, chapters: next.map((c, k) => ({ ...c, order: k })) }));
  }

  function insertImageAt(imageId: string) {
    editorRef.current?.insertImage(imageId);
    setShowImages(false);
  }

  async function handleFile(file: File) {
    if (!id) return;
    setBusyImage(true);
    try {
      const prepared = await prepareImage(file);
      const image: WorkImage = {
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 8),
        workId: id,
        mime: prepared.mime,
        width: prepared.width,
        height: prepared.height,
        caption: '',
        blob: prepared.blob,
        createdAt: Date.now(),
      };
      await saveImage(image);
      await refreshImages();
      insertImageAt(image.id);
    } catch {
      alert('この画像は読み込めませんでした。別の画像をお試しください。');
    } finally {
      setBusyImage(false);
    }
  }

  async function removeImage(image: WorkImage) {
    if (!confirm('この画像を削除します。本文に入れた箇所も取り除かれます。')) return;
    await deleteImage(image.workId, image.id);
    update((w) => ({
      ...w,
      chapters: w.chapters.map((c) => {
        const next = removeImageFromContent(c.content, image.id);
        return next === c.content ? c : { ...c, content: next, updatedAt: Date.now() };
      }),
    }));
    await refreshImages();
  }

  async function setCaption(image: WorkImage, caption: string) {
    setImages((prev) => prev.map((i) => (i.id === image.id ? { ...i, caption } : i)));
    await saveImage({ ...image, caption });
  }

  /** 修正画面の結果を保存する。IDは変えないので、本文の差し込み位置はそのまま。 */
  async function saveEditedImage(
    image: WorkImage,
    next: {
      blob: Blob;
      original: Blob;
      edit: typeof image.edit;
      width: number;
      height: number;
      mime: string;
    }
  ) {
    await saveImage({ ...image, ...next });
    await refreshImages();
  }

  /** 本文の挿絵を押したときに、その画像の修正画面を開く。 */
  function openImageEditor(imageId: string) {
    const target = images.find((i) => i.id === imageId);
    if (!target) return;
    setShowImages(false);
    setCameFromList(false);
    setEditingImage(target);
  }

  /** 修正を終えたら、開く前の画面に戻る。 */
  function closeImageEditor() {
    setEditingImage(null);
    setShowImages(cameFromList);
  }

  /** 挿絵をこの位置から外す（画像そのものは残しておく）。 */
  function detachImage(imageId: string) {
    if (!active) return;
    patch(active.id, { content: removeImageFromContent(active.content, imageId) });
  }

  const editor = active ? (
    <MarkupEditor
      ref={editorRef}
      content={active.content}
      vertical={vertical}
      images={imageViews}
      placeholder="ここから書きはじめましょう。"
      onChange={(next) => patch(active.id, { content: next })}
      onDetachImage={detachImage}
      onEditImage={openImageEditor}
    />
  ) : null;

  const tools = (
    <div className="write-tools">
      <button
        className="icon-btn"
        onClick={() => setVertical((v) => !v)}
        aria-label={vertical ? '横書きにする' : '縦書きにする'}
        title={vertical ? '横書きにする' : '縦書きにする'}
      >
        {vertical ? <YokogakiIcon /> : <TategakiIcon />}
      </button>
      <button className="btn btn-sm" onClick={() => editorRef.current?.insertRuby()}>
        ルビ
      </button>
      <button className="btn btn-sm" onClick={() => editorRef.current?.insertBoten()}>
        傍点
      </button>
      <button className="btn btn-sm" onClick={() => setShowImages(true)}>
        画像
      </button>
      <button className="btn btn-sm" onClick={() => setShowMemo(true)}>
        メモ
      </button>
      <button
        className="icon-btn"
        onClick={() => setFocus((f) => !f)}
        aria-label={focus ? '集中モードを終える' : '集中モード'}
      >
        {focus ? <ShrinkIcon /> : <ExpandIcon />}
      </button>
      <span className="count">
        {countChars(active?.content ?? '').toLocaleString()}字 ／ 今日
        {today.toLocaleString()}/{dailyTarget.toLocaleString()}
      </span>
    </div>
  );

  const imagePicker = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void handleFile(file);
        e.target.value = '';
      }}
    />
  );

  if (focus) {
    return (
      <div className="focus-mode">
        {editor}
        {tools}
        {imagePicker}
      </div>
    );
  }

  return (
    <div className="screen fill">
      <AppBar
        title={active?.title || '無題の章'}
        sub={`${work.title || '無題'}・${saveState === 'saving' ? '保存中…' : '保存済み'}`}
        back="/"
        actions={
          <button
            className="icon-btn"
            onClick={() => setShowChapters(true)}
            aria-label="章の一覧"
          >
            <ListIcon />
          </button>
        }
      />

      <div className="body flush write-area">
        {active ? (
          <>
            {editor}
            {tools}
          </>
        ) : (
          <div className="empty">
            <span className="mark">章</span>
            章がありません。
          </div>
        )}
      </div>

      {imagePicker}

      {showChapters && (
        <Sheet title="章の一覧" onClose={() => setShowChapters(false)}>
          <ul className="chapter-list">
            {chapters.map((c, i) => (
              <li key={c.id} className={`chapter-row ${c.id === activeId ? 'on' : ''}`}>
                <button
                  className="pick"
                  onClick={() => {
                    setActiveId(c.id);
                    setShowChapters(false);
                  }}
                >
                  <b>{c.title || '(無題)'}</b>
                  <span>{countChars(c.content).toLocaleString()}字</span>
                </button>
                <button
                  className="icon-btn"
                  disabled={i === 0}
                  onClick={() => moveChapter(c.id, -1)}
                  aria-label="上へ"
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  disabled={i === chapters.length - 1}
                  onClick={() => moveChapter(c.id, 1)}
                  aria-label="下へ"
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  onClick={() => removeChapter(c.id)}
                  aria-label="削除"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn btn-wide" style={{ marginTop: 12 }} onClick={addChapter}>
            <PlusIcon />
            章を追加
          </button>

          {active && (
            <>
              <div className="section-title">この章の題</div>
              <input
                className="input"
                value={active.title}
                onChange={(e) => patch(active.id, { title: e.target.value })}
                placeholder="章のタイトル"
              />
            </>
          )}
        </Sheet>
      )}

      {showImages && (
        <Sheet title="挿絵" onClose={() => setShowImages(false)}>
          <p className="muted" style={{ marginTop: 0 }}>
            画像はこの端末の中だけに保存され、本文には
            <span className="figure-chip">［画像:…］</span>
            という目印だけが入ります。書き出したEPUB・Wordには画像が組み込まれます。
          </p>
          <button
            className="btn btn-seal btn-wide"
            disabled={busyImage}
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon />
            {busyImage ? '取り込み中…' : '画像を選んで挿入'}
          </button>

          {images.length > 0 && (
            <>
              <div className="section-title">この作品の画像</div>
              <div className="image-grid">
                {images.map((image) => (
                  <ImageCard
                    key={image.id}
                    image={image}
                    used={usedImageIds.has(image.id)}
                    onInsert={() => insertImageAt(image.id)}
                    onEdit={() => {
                      // シートが重ならないよう、一覧はいったん閉じる
                      setShowImages(false);
                      setCameFromList(true);
                      setEditingImage(image);
                    }}
                    onDelete={() => void removeImage(image)}
                    onCaption={(caption) => void setCaption(image, caption)}
                  />
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}

      {editingImage && (
        <Sheet title="画像を修正" onClose={closeImageEditor}>
          <ImageEditor
            image={editingImage}
            onSave={(next) => saveEditedImage(editingImage, next)}
            onClose={closeImageEditor}
          />
        </Sheet>
      )}

      {showMemo && active && (
        <Sheet title="この章のメモ" onClose={() => setShowMemo(false)}>
          <p className="muted" style={{ marginTop: 0 }}>
            伏線や次に書くことなど。本文には書き出されません。
          </p>
          <textarea
            className="area"
            rows={7}
            value={active.memo}
            onChange={(e) => patch(active.id, { memo: e.target.value })}
            placeholder="例：ここで指輪の伏線を張る"
          />
        </Sheet>
      )}

      <TabBar workId={work.id} />
    </div>
  );
}

function ImageCard({
  image,
  used,
  onInsert,
  onEdit,
  onDelete,
  onCaption,
}: {
  image: WorkImage;
  used: boolean;
  onInsert: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCaption: (caption: string) => void;
}) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(image.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.blob]);

  return (
    <div className="image-card">
      {url && <img className="thumb" src={url} alt={image.caption || '挿絵'} />}
      <div className="body">
        <input
          className="input"
          style={{ fontSize: 13, padding: '6px 8px' }}
          value={image.caption}
          placeholder="キャプション（任意）"
          onChange={(e) => onCaption(e.target.value)}
        />
        <span className={`used ${used ? 'on' : ''}`}>
          {used ? '本文に入っています' : '未使用'}
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={onInsert}>
            挿入
          </button>
          <button className="btn btn-sm" onClick={onEdit}>
            修正
          </button>
          <button className="btn btn-sm btn-quiet btn-danger" onClick={onDelete}>
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
