/**
 * 書棚。取り込んだ本を並べ、選ぶと朗読の画面へ進む。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cover from '../components/Cover';
import { keepStorage, listBooks, saveBook, type VoiceBook } from '../db';
import { readVoiceFiles, takeSharedFiles } from '../import';

export default function Library() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<VoiceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
    } catch {
      setErrors(['書棚を開けませんでした（ブラウザの保存が使えない設定かもしれません）']);
    } finally {
      setLoading(false);
    }
  }, []);

  const accept = useCallback(
    async (files: FileList | File[]) => {
      const { books: added, errors: failed } = await readVoiceFiles(files);
      for (const book of added) {
        try {
          await saveBook(book);
        } catch {
          failed.push(`${book.title} を保存できませんでした`);
        }
      }
      setErrors(failed);
      await refresh();
      // 1冊だけ入れたときは、そのまま朗読の画面へ
      if (added.length === 1 && failed.length === 0) navigate(`/b/${added[0].id}`);
    },
    [navigate, refresh]
  );

  useEffect(() => {
    refresh();
    keepStorage();
    // 他のアプリから「共有」で送られてきた原稿を拾う
    takeSharedFiles().then((files) => {
      if (files.length > 0) accept(files);
    });
  }, [refresh, accept]);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer?.files?.length) accept(e.dataTransfer.files);
      }}
    >
      <header className="bar">
        <h1>語り部</h1>
        <button className="icon-btn" onClick={() => fileInput.current?.click()}>
          本を入れる
        </button>
        <button className="icon-btn" onClick={() => navigate('/settings')}>
          設定
        </button>
      </header>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        /*
         * 種類でしぼり込まない。しぼると、端末によってはファイルアプリ自体が
         * 選択肢から消えてしまい、本を選べなくなる。選ばれたあとに
         * 「文字として読めるか」で判断する（src/read/import.ts）。
         */
        onChange={(e) => {
          if (e.target.files?.length) accept(e.target.files);
          e.target.value = '';
        }}
      />

      {errors.length > 0 && (
        <div className="banner warn">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      )}

      {loading ? null : books.length === 0 ? (
        <div className="card empty">
          <h2>本がまだありません</h2>
          <p className="note">
            手元の <b>.md</b> や <b>.txt</b> のファイルを入れると、端末の中だけで
            読み上げます。通信は一切行いません。
          </p>
          <div className={`drop${over ? ' over' : ''}`}>
            ここにファイルを落とすか、上の「本を入れる」から選んでください
          </div>
        </div>
      ) : (
        <div className="shelf">
          {books.map((book) => {
            const ratio = book.position?.ratio ?? 0;
            return (
              <button
                key={book.id}
                className="book"
                onClick={() => navigate(`/b/${book.id}`)}
              >
                <Cover title={book.title} author={book.author} seed={book.seed} />
                <span className="book-meta">
                  <span className="book-title">{book.title}</span>
                  {book.chars.toLocaleString('ja-JP')}字
                  {ratio > 0 && ` ・ ${Math.round(ratio * 100)}%`}
                  <span className="progress">
                    <i style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {books.length > 0 && (
        <div className={`drop${over ? ' over' : ''}`}>
          ファイルをここに落としても取り込めます
        </div>
      )}
    </div>
  );
}
