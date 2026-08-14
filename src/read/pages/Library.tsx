/**
 * 本棚。
 * 手元の Markdown を取り込み、表紙の並んだ棚から読み始める。
 * ファイルを選ぶ・画面に落とす・文章を貼り付ける、の3通りで本を増やせる。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cover from '../components/Cover';
import Sheet from '../components/Sheet';
import {
  DownloadIcon,
  InstallIcon,
  PasteIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
} from '../components/Icons';
import { useInstallPrompt } from '../../lib/useInstallPrompt';
import { clearLibrary, deleteBook, listBooks, saveBook, type BookRecord } from '../db';
import { downloadSource, makeBook, readBookFiles } from '../import';
import { readingMinutes } from '../book';
import { SAMPLE_BOOK, SAMPLE_FILE_NAME } from '../sample';

const SEEDED_KEY = 'shiori:seeded';

export default function Library() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<BookRecord[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [sheet, setSheet] = useState<null | 'paste' | 'about' | 'manage' | 'install'>(null);
  const { canInstall, promptInstall } = useInstallPrompt();
  const [pasted, setPasted] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setBooks(await listBooks());
  }, []);

  useEffect(() => {
    // はじめて開いたときだけ「使い方の本」を入れておく
    (async () => {
      const existing = await listBooks();
      if (existing.length === 0 && localStorage.getItem(SEEDED_KEY) !== '1') {
        try {
          localStorage.setItem(SEEDED_KEY, '1');
        } catch {
          /* 保存できなくても続行する */
        }
        const sample = makeBook(SAMPLE_BOOK, SAMPLE_FILE_NAME);
        await saveBook(sample);
        setBooks([sample]);
        return;
      }
      setBooks(existing);
    })();
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const { books: added, errors: failed } = await readBookFiles(files);
      for (const book of added) await saveBook(book);
      setErrors(failed);
      await refresh();
      if (added.length === 1 && failed.length === 0) navigate(`/b/${added[0].id}`);
    },
    [navigate, refresh]
  );

  // OSから「このアプリで開く」を選んだときに受け取る（対応しているブラウザのみ）
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue?.setConsumer) return;
    queue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files: File[] = [];
      for (const handle of params.files) files.push(await handle.getFile());
      await addFiles(files);
    });
  }, [addFiles]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const remove = async (book: BookRecord) => {
    if (!confirm(`「${book.title}」を本棚から削除します。よろしいですか？`)) return;
    await deleteBook(book.id);
    await refresh();
  };

  return (
    <div
      className={`library${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <header className="lib-bar">
        <div className="lib-brand">
          <span className="lib-mark" aria-hidden>
            栞
          </span>
          <div>
            <strong>栞</strong>
            <small>Markdownを本のように読む</small>
          </div>
        </div>
        <div className="spacer" />
        {canInstall && !isStandalone() && (
          <button className="btn btn-sm lib-install" onClick={promptInstall}>
            <InstallIcon />
            インストール
          </button>
        )}
        <button className="icon-btn" onClick={() => setSheet('about')} aria-label="安全のしくみ">
          <ShieldIcon />
        </button>
        <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
          <PlusIcon />
          本を追加
        </button>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {errors.length > 0 && (
        <div className="alert">
          {errors.map((message, i) => (
            <p key={i}>{message}</p>
          ))}
          <button className="btn btn-sm" onClick={() => setErrors([])}>
            閉じる
          </button>
        </div>
      )}

      {books === null && <p className="muted lib-pad">読み込み中…</p>}

      {books !== null && books.length === 0 && (
        <div className="empty">
          <p className="empty-title">本棚はまだ空です</p>
          <p className="muted">
            .md ファイルを選ぶか、この画面にドラッグしてください。
            <br />
            文章を貼り付けて1冊にすることもできます。
          </p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <PlusIcon />
              ファイルを選ぶ
            </button>
            <button className="btn" onClick={() => setSheet('paste')}>
              <PasteIcon />
              貼り付けて作る
            </button>
            {!isStandalone() && (
              <button className="btn" onClick={() => setSheet('install')}>
                <InstallIcon />
                アプリとして入れる
              </button>
            )}
          </div>
        </div>
      )}

      {books !== null && books.length > 0 && (
        <>
          <div className="shelf">
            {books.map((book) => (
              <article className="shelf-item" key={book.id}>
                <button className="shelf-open" onClick={() => navigate(`/b/${book.id}`)}>
                  <Cover
                    title={book.title}
                    author={book.author}
                    seed={book.seed}
                    progress={progressOf(book)}
                  />
                </button>
                <div className="shelf-meta">
                  <strong>{book.title}</strong>
                  {book.author && <span className="muted">{book.author}</span>}
                  <span className="muted small">
                    {book.chars.toLocaleString()}字・約{readingMinutes(book.chars)}分
                    {book.position ? '・読みかけ' : ''}
                  </span>
                </div>
                <div className="shelf-actions">
                  <button
                    className="icon-btn sm"
                    onClick={() => downloadSource(book)}
                    aria-label="元のファイルを保存"
                    title="元のファイルを保存"
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    className="icon-btn sm"
                    onClick={() => remove(book)}
                    aria-label="本棚から削除"
                    title="本棚から削除"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="lib-foot">
            <button className="btn btn-ghost" onClick={() => setSheet('paste')}>
              <PasteIcon />
              貼り付けて作る
            </button>
            {!isStandalone() && (
              <button className="btn btn-ghost" onClick={() => setSheet('install')}>
                <InstallIcon />
                アプリとして入れる
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setSheet('manage')}>
              保存データ
            </button>
          </div>
        </>
      )}

      <div className="drop-hint" aria-hidden={!dropping}>
        ここに落として取り込む
      </div>

      {/* ---- 貼り付けて作る ---- */}
      <Sheet open={sheet === 'paste'} title="貼り付けて1冊にする" onClose={() => setSheet(null)}>
        <input
          className="input"
          placeholder="題名（省略すると本文の見出しから決めます）"
          value={pastedTitle}
          onChange={(e) => setPastedTitle(e.target.value)}
        />
        <textarea
          className="input textarea"
          placeholder="Markdown を貼り付けてください"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <button
          className="btn btn-primary"
          disabled={pasted.trim() === ''}
          onClick={async () => {
            const name = `${pastedTitle.trim() || '貼り付けた文章'}.md`;
            const book = makeBook(pasted, name);
            await saveBook(book);
            setPasted('');
            setPastedTitle('');
            setSheet(null);
            await refresh();
            navigate(`/b/${book.id}`);
          }}
        >
          本にする
        </button>
      </Sheet>

      {/* ---- 保存データ ---- */}
      <Sheet open={sheet === 'manage'} title="保存データ" onClose={() => setSheet(null)}>
        <p>
          本はこの端末のブラウザの中（IndexedDB）だけに保存されています。
          ブラウザのデータを消すと本棚も空になります。
        </p>
        <p className="muted">
          元のファイルは各本の保存ボタンからいつでも取り出せます。
        </p>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!confirm('本棚のすべての本を削除します。よろしいですか？')) return;
            await clearLibrary();
            await refresh();
            setSheet(null);
          }}
        >
          <TrashIcon />
          すべての本を削除する
        </button>
      </Sheet>

      {/* ---- インストールの案内 ---- */}
      <Sheet open={sheet === 'install'} title="アプリとして入れる" onClose={() => setSheet(null)}>
        <p>
          栞はホーム画面やデスクトップに入れて、ふつうのアプリと同じように使えます。
          入れておくと、アドレスバーのない全画面で開き、電波がなくても本棚を開けます。
        </p>
        {canInstall && (
          <button className="btn btn-primary" onClick={promptInstall}>
            <InstallIcon />
            この端末に入れる
          </button>
        )}
        <ul className="about">
          <li>
            <strong>iPhone・iPad（Safari）</strong>
            <br />
            下の「共有」ボタン（□に↑）→「ホーム画面に追加」→「追加」
          </li>
          <li>
            <strong>Android（Chrome）</strong>
            <br />
            右上のメニュー（⋮）→「アプリをインストール」または「ホーム画面に追加」
          </li>
          <li>
            <strong>パソコン（Chrome・Edge）</strong>
            <br />
            アドレスバー右端のインストールアイコン、またはメニューから「アプリとしてインストール」
          </li>
        </ul>
        <p className="muted">
          インストール後は、端末のファイル一覧で .md を選んだときの「アプリで開く」に
          栞が並びます（対応しているブラウザのみ）。
        </p>
      </Sheet>

      {/* ---- 安全のしくみ ---- */}
      <Sheet open={sheet === 'about'} title="安全のしくみ" onClose={() => setSheet(null)}>
        <ul className="about">
          <li>
            <strong>通信しません。</strong>
            読み込んだ本文が外に出ることはありません。ブラウザ側にも
            「外部への通信を禁止する」設定（CSP）を宣言しています。
          </li>
          <li>
            <strong>本文をHTMLとして解釈しません。</strong>
            本文に <code>&lt;script&gt;</code> と書かれていても、命令ではなく
            ただの文字として表示します。
          </li>
          <li>
            <strong>危ないリンクを開きません。</strong>
            <code>javascript:</code> のような行き先は取り除き、外部リンクは
            新しいタブで、参照元を渡さずに開きます。
          </li>
          <li>
            <strong>外部の画像を読み込みません。</strong>
            画像は本の中に埋め込まれたものだけを表示します。
          </li>
          <li>
            <strong>解析に外部の部品を使っていません。</strong>
            Markdownの解釈はこのアプリ自身のコードだけで行っています。
          </li>
          <li>
            <strong>保存はこの端末だけ。</strong>
            アカウントも登録も不要で、完全に無料です。
          </li>
        </ul>
      </Sheet>
    </div>
  );
}

/** すでにアプリとして開いているか（インストール済みなら案内を出さない）。 */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** 表紙に細く出す「どこまで読んだか」。 */
function progressOf(book: BookRecord): number {
  return book.position?.ratio ?? 0;
}

interface LaunchParams {
  files?: FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
