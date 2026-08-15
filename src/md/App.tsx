import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeScene } from './analyze';
import { renderCover } from './artwork';
import { buildBook, DEFAULT_OPTIONS, type BookMeta, type BookOptions } from './book';
import { blocksToText, parseMarkdown } from './markdown';
import { readDroppedFiles, takeSharedFiles, type PreparedImage } from './assets';
import {
  applyTheme,
  clearDraft,
  isKeeping,
  loadDraft,
  readTheme,
  saveDraft,
  setKeeping,
  THEME_LABEL,
  type ThemeMode,
} from './store';
import ImportPanel from './panels/ImportPanel';
import StructurePanel from './panels/StructurePanel';
import DesignPanel from './panels/DesignPanel';
import ReadPanel from './panels/ReadPanel';
import ExportPanel from './panels/ExportPanel';
import SecurityPanel from './panels/SecurityPanel';
import PrintRoot from './PrintRoot';

type TabId = 'import' | 'structure' | 'design' | 'read' | 'export' | 'safety';

const TABS: { id: TabId; label: string; needsBook: boolean }[] = [
  { id: 'import', label: '取り込む', needsBook: false },
  { id: 'structure', label: '本のかたち', needsBook: true },
  { id: 'design', label: '装丁', needsBook: true },
  { id: 'read', label: '読んでみる', needsBook: true },
  { id: 'export', label: '書き出す', needsBook: true },
  { id: 'safety', label: '安全性', needsBook: false },
];

const THEME_ORDER: ThemeMode[] = ['auto', 'light', 'dark'];

export default function App() {
  const [source, setSource] = useState('');
  const [assets, setAssets] = useState<Map<string, string>>(() => new Map());
  const [options, setOptions] = useState<BookOptions>(DEFAULT_OPTIONS);
  const [meta, setMeta] = useState<Partial<BookMeta>>({});
  const [coverLayout, setCoverLayout] = useState(0);
  const [userCover, setUserCover] = useState<PreparedImage | null>(null);
  const [tab, setTab] = useState<TabId>('import');
  const [theme, setTheme] = useState<ThemeMode>(readTheme);

  const [keeping, setKeepingState] = useState(isKeeping);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  const [printing, setPrinting] = useState(false);
  const [printCover, setPrintCover] = useState<string | null>(null);
  const loaded = useRef(false);

  // 端末に保存する設定なら、前回の続きを読み出す
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      const draft = await loadDraft();
      if (!draft) return;
      setHasDraft(true);
      setSavedAt(draft.savedAt);
      if (!isKeeping()) return;
      setSource(draft.source);
      setOptions(draft.options);
      setMeta(draft.meta);
      setCoverLayout(draft.coverLayout);
      if (draft.source.trim()) setTab('structure');
    })();
  }, []);

  const doc = useMemo(
    () => (source.trim() ? parseMarkdown(source, { assets }) : null),
    [source, assets]
  );
  const book = useMemo(() => (doc ? buildBook(doc, options, meta) : null), [doc, options, meta]);

  const chapterTexts = useMemo(
    () => book?.chapters.map((chapter) => blocksToText(chapter.blocks)) ?? [],
    [book]
  );
  const artSeed = meta.artSeed ?? 0;

  const bookProfile = useMemo(() => {
    if (!book) return null;
    return analyzeScene(
      chapterTexts.join('\n').slice(0, 120_000),
      `${book.meta.title} ${book.meta.genre} ${book.meta.subtitle}`,
      artSeed
    );
  }, [book, chapterTexts, artSeed]);

  const chapterProfiles = useMemo(() => {
    if (!book) return [];
    return book.chapters.map((chapter, i) =>
      analyzeScene(chapterTexts[i] ?? '', `${book.meta.title} ${chapter.title}`, artSeed)
    );
  }, [book, chapterTexts, artSeed]);

  // 保存する設定のときだけ、手を止めたころに書き込む
  useEffect(() => {
    if (!keeping || !source.trim()) return;
    const timer = setTimeout(() => {
      void saveDraft({ source, options, meta, coverLayout }).then(() => {
        setSavedAt(Date.now());
        setHasDraft(true);
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [keeping, source, options, meta, coverLayout]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [printing]);

  const startPrint = useCallback(async () => {
    if (!book || !bookProfile) return;
    if (userCover) {
      setPrintCover(userCover.dataUrl);
    } else {
      const cover = await renderCover(
        {
          title: book.meta.title,
          subtitle: book.meta.subtitle,
          author: book.meta.author,
          profile: bookProfile,
          layout: coverLayout,
          variation: artSeed,
        },
        800,
        1280
      );
      setPrintCover(cover.dataUrl);
    }
    setPrinting(true);
  }, [book, bookProfile, userCover, coverLayout, artSeed]);

  const handleFiles = useCallback(
    (text: string, nextAssets: Map<string, string>) => {
      setAssets((prev) => new Map([...prev, ...nextAssets]));
      if (text) setSource((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
    },
    []
  );

  /** 外から渡されたファイル（共有・「このアプリで開く」）を取り込む。 */
  const acceptFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const loaded = await readDroppedFiles(files);
      handleFiles(loaded.text, loaded.assets);
      if (loaded.text) setTab('structure');
    },
    [handleFiles]
  );

  // 他のアプリから「共有」で送られてきた原稿を受け取る
  useEffect(() => {
    void takeSharedFiles().then(acceptFiles);
  }, [acceptFiles]);

  // OSから「このアプリで開く」を選んだときに受け取る（対応しているブラウザのみ）
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue?.setConsumer) return;
    queue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files: File[] = [];
      for (const handle of params.files) files.push(await handle.getFile());
      await acceptFiles(files);
    });
  }, [acceptFiles]);

  const ready = Boolean(book);

  return (
    <>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            製本所
            <small>Markdownを、売れる本のかたちに</small>
          </div>
          <div className="spacer" />
          <button
            className="btn ghost"
            style={{ minHeight: 36, padding: '6px 12px', fontSize: 12.5 }}
            onClick={() => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length])}
            title="配色を変える"
          >
            {THEME_LABEL[theme]}
          </button>
        </header>

        <nav className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              className="tab"
              role="tab"
              aria-selected={tab === item.id}
              disabled={item.needsBook && !ready}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main>
          {tab === 'import' && (
            <ImportPanel
              onSource={setSource}
              onFiles={handleFiles}
              onDone={() => setTab('structure')}
              ready={ready}
            />
          )}

          {tab === 'structure' && book && (
            <StructurePanel
              book={book}
              options={options}
              onOptions={setOptions}
              meta={meta}
              onMeta={setMeta}
            />
          )}

          {tab === 'design' && book && bookProfile && (
            <DesignPanel
              book={book}
              bookProfile={bookProfile}
              chapterProfiles={chapterProfiles}
              coverLayout={coverLayout}
              onCoverLayout={setCoverLayout}
              artSeed={artSeed}
              onArtSeed={(next) => setMeta((prev) => ({ ...prev, artSeed: next }))}
              userCover={userCover}
              onUserCover={setUserCover}
            />
          )}

          {tab === 'read' && book && <ReadPanel book={book} />}

          {tab === 'export' && book && bookProfile && (
            <ExportPanel
              book={book}
              bookProfile={bookProfile}
              chapterProfiles={chapterProfiles}
              coverLayout={coverLayout}
              artSeed={artSeed}
              userCover={userCover}
              onPrint={() => void startPrint()}
            />
          )}

          {tab === 'safety' && (
            <SecurityPanel
              keeping={keeping}
              onKeeping={(on) => {
                setKeeping(on);
                setKeepingState(on);
              }}
              onSave={() => {
                void saveDraft({ source, options, meta, coverLayout }).then(() => {
                  setSavedAt(Date.now());
                  setHasDraft(true);
                });
              }}
              onClear={() => {
                void clearDraft().then(() => {
                  setSavedAt(null);
                  setHasDraft(false);
                });
              }}
              savedAt={savedAt}
              hasDraft={hasDraft}
            />
          )}
        </main>

        <footer className="footer">
          製本所 — 完全無料・通信なし・登録なし。原稿はこの端末から出ません。
          <br />
          <a className="link" href="../read/">
            栞
          </a>
          ／
          <a className="link" href="../desk/">
            文机
          </a>
          ／
          <a className="link" href="../">
            小説執筆スタジオ
          </a>
        </footer>
      </div>

      {printing && book && <PrintRoot book={book} coverDataUrl={printCover} />}
    </>
  );
}

/** 「このアプリで開く」で渡されるファイル（対応しているブラウザのみ）。 */
interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
