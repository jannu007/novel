/**
 * 書棚。取り込んだ本を並べ、選ぶと朗読の画面へ進む。
 *
 * ■ ファイルを選べないことへの備え
 * Androidでは、入力欄の書き方しだいで選択画面に**ファイルアプリが出てこず、
 * 「カメラ」と「写真と動画」だけ**になることがある。同じ端末で確実に動く条件が
 * 「栞」（/read/）と「製本所」（/md/）で分かっているので、ここも同じ形にそろえた。
 *
 * - **種類（accept）を、よく知られたものだけ短く指定する。** 指定しない、または
 *   見慣れない拡張子を混ぜると、端末が「なんでも」の求めとみなして
 *   カメラと写真しか出さないことがある。
 * - **`multiple` を付けない。** 複数選択を求めると、それに対応しないファイルアプリが
 *   候補から外される（Samsungの「マイファイル」など）。まとめて選ぶ道は別に置く。
 * - **押すのは `<label>` から。** 利用者が入力欄そのものを押した形にする
 *   （JavaScriptから開くと、はじかれる端末がある）。
 * - **`hidden` で消さない。** 見えないだけの形にしておく。消した入力欄を
 *   プログラムから押すと、候補が減ることがある。
 *
 * それでも出ない端末のために、条件を変えた入力欄と、選択画面を通らない入れ方
 * （共有・「このアプリで開く」）を「ほかの入れ方」にまとめてある。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cover from '../components/Cover';
import InstallBar from '../components/InstallBar';
import { chromeIntentUrl, copyPageUrl, isAndroid, isInAppBrowser } from '../browser';
import { keepStorage, listBooks, saveBook, type VoiceBook } from '../db';
import { readVoiceFiles, takeSharedFiles } from '../import';

/**
 * ファイル選択の種類。「栞」とまったく同じにしてある。
 * 同じ端末で栞は選べていたので、違いを作らない。
 */
const TEXT_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain';

export default function Library() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<VoiceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [howto, setHowto] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inApp] = useState(isInAppBrowser);

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

  /** どの入力欄から選ばれても、同じように取り込む。 */
  const onPicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) accept(e.target.files);
      // 同じファイルをもう一度選べるように、選び終わったら空にする
      e.target.value = '';
    },
    [accept]
  );

  useEffect(() => {
    refresh();
    keepStorage();
    // 他のアプリから「共有」で送られてきた原稿を拾う
    takeSharedFiles().then((files) => {
      if (files.length > 0) accept(files);
    });
  }, [refresh, accept]);

  /*
   * OSの「このアプリで開く」から渡された原稿を受け取る（対応するブラウザのみ）。
   * 選択画面を通らないので、候補にカメラしか出ない端末でも本を入れられる。
   */
  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue?.setConsumer) return;
    queue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files: File[] = [];
      for (const handle of params.files) files.push(await handle.getFile());
      await accept(files);
    });
  }, [accept]);

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
        <label className="icon-btn" htmlFor="kataribe-pick">
          本を入れる
        </label>
        <button className="icon-btn" onClick={() => navigate('/settings')}>
          設定
        </button>
      </header>

      {/*
        入力欄は3つ置いてある。ふだん使うのは1つめで、残りは
        「候補にカメラしか出ない」ときに条件を変えて試すためのもの。
        どれも hidden にはせず、見えないだけの形（.file-input）にしておく。
      */}
      <input
        id="kataribe-pick"
        type="file"
        accept={TEXT_ACCEPT}
        className="file-input"
        onChange={onPicked}
      />
      <input
        id="kataribe-pick-multi"
        type="file"
        multiple
        accept={TEXT_ACCEPT}
        className="file-input"
        onChange={onPicked}
      />
      <input id="kataribe-pick-plain" type="file" className="file-input" onChange={onPicked} />

      <InstallBar />

      {errors.length > 0 && (
        <div className="banner warn">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      )}

      {/*
        アプリ内ブラウザ（LINEやメールの中）では、選択のしくみを親アプリが
        用意しているため、候補がカメラと写真だけになることがある。
        ページ側では変えられないので、気づけるように知らせておく。
      */}
      {inApp && (
        <div className="banner warn">
          <b>アプリの中のブラウザで開いています。</b>
          この画面では、ファイルを選ぶ候補に「カメラ」しか出ないことがあります。
          ふつうのブラウザで開き直すと選べるようになります。
          <div className="pick-actions">
            {isAndroid() && (
              <a className="btn primary" href={chromeIntentUrl()}>
                Chromeで開く
              </a>
            )}
            <button className="btn" onClick={async () => setCopied(await copyPageUrl())}>
              {copied ? 'コピーしました' : 'リンクをコピー'}
            </button>
          </div>
        </div>
      )}

      {loading ? null : books.length === 0 ? (
        <div className="card empty">
          <h2>本がまだありません</h2>
          <p className="note">
            手元の <b>.md</b> や <b>.txt</b> のファイルを入れると、端末の中だけで
            読み上げます。通信は一切行いません。
          </p>
          <label className={`drop${over ? ' over' : ''}`} htmlFor="kataribe-pick">
            ここにファイルを落とすか、ここを押して選んでください
          </label>
          <div className="pick-actions">
            <label className="btn primary" htmlFor="kataribe-pick">
              ファイルを選ぶ
            </label>
            <button className="btn" onClick={() => setHowto((v) => !v)}>
              {howto ? '閉じる' : 'ほかの入れ方'}
            </button>
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
        <>
          <label className={`drop${over ? ' over' : ''}`} htmlFor="kataribe-pick">
            ここを押してファイルを選ぶ（落としても取り込めます）
          </label>
          <div className="pick-actions">
            <button className="btn" onClick={() => setHowto((v) => !v)}>
              {howto ? '閉じる' : 'ほかの入れ方'}
            </button>
          </div>
        </>
      )}

      {/*
        選択画面にファイルアプリが出てこないときのための道。
        端末ごとに効く条件が違うので、順に試せるように並べておく。
      */}
      {howto && (
        <div className="card howto">
          <h2>選ぶ画面にファイルが出てこないとき</h2>
          <ul className="note">
            <li>
              <b>条件を変えて選ぶ。</b>
              端末によって、出てくる候補が変わります。
              <div className="pick-actions">
                <label className="btn" htmlFor="kataribe-pick-plain">
                  種類を指定せずに選ぶ
                </label>
                <label className="btn" htmlFor="kataribe-pick-multi">
                  まとめて選ぶ
                </label>
              </div>
            </li>
            <li>
              <b>ファイルアプリから送る（もっとも確実）。</b>
              端末の「マイファイル」や「ファイル」で .md や .txt を長押しし、
              <b>共有</b>から<b>語り部</b>を選びます。選ぶ画面を通らないので、
              候補にカメラしか出ない端末でも入れられます
              （アプリとして入れてあるときに使えます）。
            </li>
            <li>
              <b>「このアプリで開く」から開く。</b>
              アプリとして入れてあると、ファイルを押したときの開き先に語り部が出ます。
            </li>
            <li>
              <b>ふつうのブラウザで開き直す。</b>
              LINEやメールの中で開いていると、候補がカメラと写真だけになります。
              <div className="pick-actions">
                {isAndroid() && (
                  <a className="btn" href={chromeIntentUrl()}>
                    Chromeで開く
                  </a>
                )}
                <button className="btn" onClick={async () => setCopied(await copyPageUrl())}>
                  {copied ? 'コピーしました' : 'リンクをコピー'}
                </button>
              </div>
            </li>
            <li>
              <b>パソコンでは。</b>
              この画面にファイルをドラッグ＆ドロップできます。
            </li>
          </ul>
          <p className="note">
            取り込めるのは文章のファイルです（.md・.txt など。拡張子がなくても、
            文字として読めれば取り込めます）。
          </p>
        </div>
      )}
    </div>
  );
}

interface LaunchParams {
  files?: FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
