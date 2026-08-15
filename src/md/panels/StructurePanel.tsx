import type { Book, BookMeta, BookOptions, SplitMode } from '../book';

interface Props {
  book: Book;
  options: BookOptions;
  onOptions: (next: BookOptions) => void;
  meta: Partial<BookMeta>;
  onMeta: (next: Partial<BookMeta>) => void;
}

const SPLIT_LABEL: { value: SplitMode; label: string }[] = [
  { value: 'auto', label: 'おまかせ' },
  { value: 1, label: '# で分ける' },
  { value: 2, label: '## で分ける' },
  { value: 3, label: '### で分ける' },
  { value: 'none', label: '分けない' },
];

export default function StructurePanel({ book, options, onOptions, meta, onMeta }: Props) {
  const { stats } = book;
  const set = (patch: Partial<BookOptions>) => onOptions({ ...options, ...patch });
  const setMeta = (patch: Partial<BookMeta>) => onMeta({ ...meta, ...patch });

  return (
    <>
      <div className="card">
        <h2>本のかたち</h2>
        <div className="stats">
          <div className="stat">
            <b>{stats.chapters}</b>
            <span>章</span>
          </div>
          <div className="stat">
            <b>{stats.chars.toLocaleString()}</b>
            <span>文字</span>
          </div>
          <div className="stat">
            <b>{stats.internalLinks}</b>
            <span>本の中のリンク</span>
          </div>
          <div className="stat">
            <b>{stats.externalLinks}</b>
            <span>外部リンク</span>
          </div>
          <div className="stat">
            <b>{stats.footnotes}</b>
            <span>脚注</span>
          </div>
          <div className="stat">
            <b>{stats.images}</b>
            <span>本文中の画像</span>
          </div>
        </div>
      </div>

      {book.warnings.length > 0 && (
        <div className="card">
          <h2>読み込みのお知らせ</h2>
          {book.warnings.map((warning) => (
            <div className="notice" key={warning.kind}>
              <span aria-hidden="true">⚑</span>
              <div>
                <b>{warning.message}</b>
                {warning.detail && <span>{warning.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>章の分け方</h2>
        <p className="hint">
          原稿の見出しの使い方から自動で決めています。思ったところで切れていなければ、ここで変えてください。
        </p>
        <div className="chips">
          {SPLIT_LABEL.map((item) => (
            <button
              key={String(item.value)}
              className="chip"
              aria-pressed={options.splitMode === item.value}
              onClick={() => set({ splitMode: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="switch">
            <input
              type="checkbox"
              checked={options.lineAsParagraph}
              onChange={(e) => set({ lineAsParagraph: e.target.checked })}
            />
            <span className="label">
              <b>改行ごとに段落にする</b>
              <span>小説の原稿向け。切ると、空行までをひとつの段落にまとめます。</span>
            </span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={options.vertical}
              onChange={(e) => set({ vertical: e.target.checked })}
            />
            <span className="label">
              <b>縦書きで組む</b>
              <span>右綴じ・縦組み。実用書や技術書なら切って横書きに。</span>
            </span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={options.illustrations}
              onChange={(e) => set({ illustrations: e.target.checked })}
            />
            <span className="label">
              <b>章の扉に挿絵を入れる</b>
              <span>各章の内容から情景を見立てて描きます。</span>
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>書誌</h2>
        <p className="hint">
          原稿の先頭にYAML（<code>title:</code> や <code>author:</code>）があれば読み取っています。ここでの変更が優先されます。
        </p>
        <div className="grid2">
          <label className="field">
            <span>題名</span>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              value={meta.title ?? book.meta.title}
              onChange={(e) => setMeta({ title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>著者名</span>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              value={meta.author ?? book.meta.author}
              onChange={(e) => setMeta({ author: e.target.value })}
              placeholder="ペンネームでも構いません"
            />
          </label>
          <label className="field">
            <span>副題（任意）</span>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              value={meta.subtitle ?? book.meta.subtitle}
              onChange={(e) => setMeta({ subtitle: e.target.value })}
            />
          </label>
          <label className="field">
            <span>ジャンル（任意）</span>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              value={meta.genre ?? book.meta.genre}
              onChange={(e) => setMeta({ genre: e.target.value })}
              placeholder="ファンタジー・恋愛 など"
            />
          </label>
        </div>
        <label className="field">
          <span>紹介文（任意・EPUBの説明に入ります）</span>
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            value={meta.description ?? book.meta.description}
            onChange={(e) => setMeta({ description: e.target.value })}
          />
        </label>
      </div>

      <div className="card">
        <h2>目次</h2>
        <p className="hint">この並びがそのままEPUBの目次・Kindleの章送り・Wordの見出しになります。</p>
        <ol className="chapter-list">
          {book.chapters.map((chapter, i) => (
            <li key={chapter.id}>
              <span className="no">{i + 1}</span>
              <span className="title">
                {chapter.title}
                {chapter.headings.length > 0 && (
                  <span className="sub">
                    {chapter.headings
                      .filter((h) => h.anchor !== chapter.anchor)
                      .slice(0, 4)
                      .map((h) => h.text)
                      .join(' ・ ')}
                  </span>
                )}
              </span>
              <span className="count">{chapter.chars.toLocaleString()}字</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
