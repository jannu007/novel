import { useCallback, useState } from 'react';
import { parseEpub, revokeParsedBook, type ParsedBook } from './epub';
import { applyTheme, readTheme, THEME_LABEL, type ThemeMode } from './store';
import ImportPanel from './panels/ImportPanel';
import ProductPreview, { type PreviewSettings } from './panels/ProductPreview';
import ReaderModal from './panels/ReaderModal';
import SecurityPanel from './panels/SecurityPanel';
import InstallBar from './components/InstallBar';

type TabId = 'import' | 'preview' | 'safety';

const TABS: { id: TabId; label: string; needsBook: boolean }[] = [
  { id: 'import', label: '取り込む', needsBook: false },
  { id: 'preview', label: '商品ページ下見', needsBook: true },
  { id: 'safety', label: '安全性', needsBook: false },
];

const THEME_ORDER: ThemeMode[] = ['auto', 'light', 'dark'];

const DEFAULT_SETTINGS: PreviewSettings = {
  price: 500,
  rating: 0,
  reviewCount: 0,
  unlimited: false,
  description: '',
};

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [tab, setTab] = useState<TabId>('import');
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PreviewSettings>(DEFAULT_SETTINGS);
  const [readerChapter, setReaderChapter] = useState<number | null>(null);

  const changeTheme = (mode: ThemeMode) => {
    setTheme(mode);
    applyTheme(mode);
  };

  const clearBook = useCallback(() => {
    setBook((prev) => {
      if (prev) revokeParsedBook(prev);
      return null;
    });
    setSettings(DEFAULT_SETTINGS);
    setReaderChapter(null);
    setError(null);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const parsed = await parseEpub(file);
        setBook((prev) => {
          if (prev) revokeParsedBook(prev);
          return parsed;
        });
        setSettings({ ...DEFAULT_SETTINGS, description: parsed.description });
        setTab('preview');
      } catch (e) {
        setError(e instanceof Error ? e.message : '読み込み中に問題が起きました。');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          検品所
          <small>出す前に、売り場での見え方を確かめる</small>
        </div>
        <div className="spacer" />
        <button
          className="btn ghost"
          style={{ minHeight: 36, padding: '6px 12px', fontSize: 12.5 }}
          onClick={() => changeTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length])}
          title="配色を変える"
        >
          {THEME_LABEL[theme]}
        </button>
      </header>

      <InstallBar />

      <nav className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            className="tab"
            role="tab"
            aria-selected={tab === item.id}
            disabled={item.needsBook && !book}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'import' && <ImportPanel onFile={(f) => void handleFile(f)} loading={loading} error={error} />}

        {tab === 'preview' &&
          (book ? (
            <ProductPreview
              book={book}
              settings={settings}
              onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              onOpenReader={setReaderChapter}
              onReset={clearBook}
            />
          ) : (
            <div className="empty-state">EPUBを読み込むと、ここに商品ページの下見が表示されます。</div>
          ))}

        {tab === 'safety' && <SecurityPanel />}
      </main>

      <p className="disclaimer">検品所は非公式の下見ツールです。Amazon・KDPとは無関係で、通信・保存は一切行いません。</p>

      <footer className="footer">完全無料・通信なし・保存なし。作ったものの権利はすべてあなたのものです。</footer>

      {book && readerChapter !== null && (
        <ReaderModal
          book={book}
          chapterIndex={readerChapter}
          onChapterChange={setReaderChapter}
          onClose={() => setReaderChapter(null)}
        />
      )}
    </div>
  );
}
