/**
 * 本棚。
 * 手元の Markdown を取り込み、表紙の並んだ棚から読み始める。
 * ファイルを選ぶ・画面に落とす・文章を貼り付ける、の3通りで本を増やせる。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cover from '../components/Cover';
import { useBookCover } from '../useBookCover';
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
import { clearCovers, deleteCover } from '../cover';
import { downloadSource, makeBook, readBookFiles, takeSharedFiles } from '../import';
import { readingMinutes } from '../book';
import { SAMPLE_BOOK, SAMPLE_FILE_NAME } from '../sample';
import {
  chromeIntentUrl,
  copyPageUrl,
  countExternalRequests,
  isAndroid,
  isInAppBrowser,
  refreshApp,
} from '../browser';

const SEEDED_KEY = 'shiori:seeded';
const NOTICE_KEY = 'shiori:inapp-notice-closed';

export default function Library() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<BookRecord[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [sheet, setSheet] = useState<
    null | 'paste' | 'about' | 'manage' | 'install' | 'howto'
  >(null);
  const { canInstall, promptInstall } = useInstallPrompt();
  const [pasted, setPasted] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');
  const [copied, setCopied] = useState(false);
  const [inApp] = useState(isInAppBrowser);
  const [noticeClosed, setNoticeClosed] = useState(
    () => localStorage.getItem(NOTICE_KEY) === '1'
  );
  const [clipboardFailed, setClipboardFailed] = useState(false);
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

  /** どの入力欄から選ばれても、同じように取り込む。 */
  const onPicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles]
  );

  // 他のアプリから「共有」で送られてきたファイルを拾う
  useEffect(() => {
    takeSharedFiles().then((files) => {
      if (files.length > 0) addFiles(files);
    });
  }, [addFiles]);

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
    await deleteCover(book.id);
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
        <label className="btn btn-primary" htmlFor="shiori-pick">
          <PlusIcon />
          本を追加
        </label>
      </header>

      {/*
        ファイル選択の入力欄。ここは端末ごとの差が大きく、次の形が確実だった。

        - **種類（accept）を指定する。** 指定しないと、Androidの選択画面に
          ファイルアプリが出てこず「カメラ」だけになることがある。
        - **`multiple` を付けない。** 複数選択を求めると、それに対応しない
          ファイルアプリが候補から外される（Samsungの「マイファイル」など）。
        - **押すのは <label> から。** 利用者が入力欄そのものを押したことになる。

        まとめて選びたいとき・それでも出ないときのために、
        条件を変えた入力欄も置いてあり、案内から選べるようにしている。
      */}
      <input
        id="shiori-pick"
        ref={fileInput}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="file-input"
        onChange={onPicked}
      />
      <input
        id="shiori-pick-plain"
        type="file"
        className="file-input"
        onChange={onPicked}
      />
      <input
        id="shiori-pick-multi"
        type="file"
        multiple
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="file-input"
        onChange={onPicked}
      />

      {/*
        アプリ内ブラウザでは、ファイル選択の候補がカメラと写真だけになることがある
        （選択のしくみを親アプリが用意しているため、ページ側では変えられない）。
        気づけるように知らせ、ふつうのブラウザで開き直す道を出しておく。
      */}
      {inApp && !noticeClosed && (
        <div className="notice">
          <p>
            <strong>アプリ内のブラウザで開いています。</strong>
            この画面ではファイルを選べないことがあります（候補にカメラしか出ない場合）。
            ふつうのブラウザで開き直すと選べるようになります。
          </p>
          <div className="notice-actions">
            {isAndroid() && (
              <a className="btn btn-sm btn-primary" href={chromeIntentUrl()}>
                Chromeで開く
              </a>
            )}
            <button
              className="btn btn-sm"
              onClick={async () => {
                setCopied(await copyPageUrl());
              }}
            >
              {copied ? 'コピーしました' : 'リンクをコピー'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSheet('howto')}>
              ほかの入れ方
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setNoticeClosed(true);
                try {
                  localStorage.setItem(NOTICE_KEY, '1');
                } catch {
                  /* 覚えられなくても閉じられればよい */
                }
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

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
            スマートフォンでは「ファイル」アプリから選べます。
            <br />
            文章を貼り付けて1冊にすることもできます。
          </p>
          <label className="dropzone" htmlFor="shiori-pick">
            <strong>ここに .md / .txt をドロップ、またはタップして選択</strong>
            <span>端末の中だけで読み取ります。どこにも送信しません。</span>
          </label>
          <div className="empty-actions">
            <label className="btn btn-primary" htmlFor="shiori-pick">
              <PlusIcon />
              ファイルを選ぶ
            </label>
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
                  <ShelfCover book={book} />
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

          {/*
            見えている領域そのものを押してもらう入り口。
            画面から消した入力欄をプログラムから押すのに比べ、
            Androidで本来の選択画面が出やすい。
          */}
          <label className="dropzone" htmlFor="shiori-pick">
            <strong>ここに .md / .txt をドロップ、またはタップして選択</strong>
            <span>端末の中だけで読み取ります。どこにも送信しません。</span>
          </label>

          <div className="lib-foot">
            <button className="btn btn-ghost" onClick={() => setSheet('paste')}>
              <PasteIcon />
              貼り付けて作る
            </button>
            <button className="btn btn-ghost" onClick={() => setSheet('howto')}>
              本の入れ方
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
          {/* いま動いている版。古い版が残っていないかを、開かずに確かめられる。 */}
          <p className="lib-version">版 {__BUILD_ID__}</p>
        </>
      )}

      <div className="drop-hint" aria-hidden={!dropping}>
        ここに落として取り込む
      </div>

      {/* ---- 貼り付けて作る ---- */}
      <Sheet
        open={sheet === 'paste'}
        title="貼り付けて1冊にする"
        onClose={() => setSheet(null)}
        // キーボードが出ても押せるよう、決定ボタンは下端に固定して置く
        footer={
          <button
            className="btn btn-primary"
            disabled={pasted.trim() === ''}
            onClick={async () => {
              // 題名が空なら、貼り付けた文章の最初の見出しを題名にする
              const heading = /^[ \t]{0,3}#{1,6}[ \t]+(.+)$/m.exec(pasted)?.[1]?.trim();
              const name = `${pastedTitle.trim() || heading || '貼り付けた文章'}.md`;
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
        }
      >
        <input
          className="input"
          placeholder="題名（省略できます）"
          value={pastedTitle}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          onChange={(e) => setPastedTitle(e.target.value)}
        />
        <p className="muted small paste-hint">
          題名を空のままにすると、本文の見出しから決めます。
        </p>
        <div className="notice-actions">
          <button
            className="btn btn-sm"
            onClick={async () => {
              setClipboardFailed(false);
              try {
                const text = await navigator.clipboard.readText();
                if (text) setPasted((prev) => prev + text);
                else setClipboardFailed(true);
              } catch {
                setClipboardFailed(true);
              }
            }}
          >
            <PasteIcon />
            クリップボードから入れる
          </button>
          {pasted !== '' && (
            <button className="btn btn-sm btn-ghost" onClick={() => setPasted('')}>
              消す
            </button>
          )}
        </div>
        {clipboardFailed && (
          <p className="muted small">
            クリップボードから読み取れませんでした。下の欄を長押しして「貼り付け」を選んでください。
          </p>
        )}
        {/*
          spellCheck={false} は見た目のためではなく、安全のための指定。
          ブラウザの「高度なスペルチェック」は、入力欄の文字を
          そのままメーカーのサーバーへ送って調べるしくみで、これは
          ブラウザ自身の機能なのでCSPでは止められない。この欄には
          本1冊ぶんの原稿が入りうるので、対象から外しておく。
          autoComplete も同じ理由（入力履歴として端末に残さない）。
        */}
        <textarea
          className="input textarea"
          placeholder="Markdown を貼り付けてください"
          value={pasted}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          onChange={(e) => setPasted(e.target.value)}
        />
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
        <p className="muted small">版：{__BUILD_ID__}</p>
        <p>
          直したはずのものが直っていないときは、古い版が端末に残っていることがあります。
          下のボタンで、アプリの控えを捨てて最新の版を取り直せます
          （本棚の中身はそのまま残ります）。
        </p>
        <button className="btn" onClick={() => refreshApp()}>
          最新の版にする
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!confirm('本棚のすべての本を削除します。よろしいですか？')) return;
            await clearLibrary();
            await clearCovers();
            await refresh();
            setSheet(null);
          }}
        >
          <TrashIcon />
          すべての本を削除する
        </button>
      </Sheet>

      {/* ---- 本の入れ方 ---- */}
      <Sheet open={sheet === 'howto'} title="本の入れ方" onClose={() => setSheet(null)}>
        <ul className="about">
          <li>
            <strong>ファイルを選ぶ</strong>
            <br />
            上の「本を追加」から選びます。まとめて選ぶこともできます。
          </li>
          <li>
            <strong>選ぶ画面にカメラしか出ないとき</strong>
            <br />
            LINEやメールなどの<strong>アプリの中で開いている</strong>と、そのアプリが
            用意した選択画面になり、カメラと写真しか出ないことがあります。
            ふつうのブラウザ（Chrome・Safariなど）で開き直すと選べるようになります。
            <br />
            <span className="notice-actions">
              {isAndroid() && (
                <a className="btn btn-sm btn-primary" href={chromeIntentUrl()}>
                  Chromeで開く
                </a>
              )}
              <button
                className="btn btn-sm"
                onClick={async () => {
                  setCopied(await copyPageUrl());
                }}
              >
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </button>
            </span>
          </li>
          <li>
            <strong>ファイルアプリから送る（もっとも確実）</strong>
            <br />
            端末の「マイファイル」や「ファイル」で .md を長押しし、
            <strong>共有</strong>から<strong>栞</strong>を選びます。選ぶ画面を通らないので、
            候補にカメラしか出ない端末でも入れられます。
            <br />
            アプリとして入れてあるときに使えます（入れていない場合は、
            先に「アプリとして入れる」をお試しください）。
          </li>
          <li>
            <strong>選ぶ画面の出方を変えてみる</strong>
            <br />
            候補にカメラしか出ないときは、条件を変えると出てくることがあります。
            <br />
            <span className="notice-actions">
              <label className="btn btn-sm" htmlFor="shiori-pick-plain">
                種類を指定せずに選ぶ
              </label>
              <label className="btn btn-sm" htmlFor="shiori-pick-multi">
                まとめて選ぶ
              </label>
            </span>
          </li>
          <li>
            <strong>貼り付ける</strong>
            <br />
            文章をコピーして「貼り付けて作る」に貼れば、それだけで1冊になります。
          </li>
          <li>
            <strong>パソコンでは</strong>
            <br />
            本棚の画面にファイルをドラッグ＆ドロップできます。
          </li>
        </ul>
        <p className="muted">
          取り込めるのは文章のファイルです（.md・.txt など。拡張子がなくても、
          文字として読めれば取り込めます）。
        </p>
      </Sheet>

      {/* ---- インストールの案内 ---- */}
      <Sheet open={sheet === 'install'} title="アプリとして入れる" onClose={() => setSheet(null)}>
        <p>
          栞はホーム画面やデスクトップに入れて、ふつうのアプリと同じように使えます。
          入れておくと、アドレスバーのない全画面で開き、電波がなくても本棚を開けます。
        </p>
        {isAndroid() && (
          <div className="notice">
            <p>
              <strong>ダウンロードは始まるのに入らないときは。</strong>
              LINEやメールなどの<strong>アプリの中で開いた画面からは、入れられない</strong>
              ことがあります（端末がインストールを止めるため）。
              先にChromeで開き直してから、あらためて入れてください。
            </p>
            <div className="notice-actions">
              <a className="btn btn-sm btn-primary" href={chromeIntentUrl()}>
                Chromeで開く
              </a>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  setCopied(await copyPageUrl());
                }}
              >
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </button>
            </div>
          </div>
        )}
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
        <div className="notice">
          <p>
            <strong>この画面を開いてから、外部への通信は {countExternalRequests()} 件です。</strong>
            <br />
            ブラウザ自身が記録している読み込みの一覧から、栞のサイト以外へ行ったものを
            数えています。栞は通信を行わないので、ここは 0 のままになります。
          </p>
        </div>
        <p className="muted">
          <strong>機内モードでも使えます。</strong>
          一度開いたあとは、通信を切ったままで本の取り込みも読書もできます。
          外に出ていないことを確かめたいときは、機内モードにしてお使いください。
        </p>
        <ul className="about">
          <li>
            <strong>送る手段そのものがありません。</strong>
            本文を外へ送るには、ブラウザの通信のしくみ（fetch・XMLHttpRequest・
            WebSocket・sendBeacon・EventSource）を使うほかありません。栞は
            <code>connect-src 'none'</code> を宣言しているので、それらは
            <strong>ブラウザに止められて動きません</strong>。仮に誰かが送る処理を
            書き足しても、その一行は動かないということです。
          </li>
          <li>
            <strong>送る道具そのものを取り上げています。</strong>
            上のCSPが効かない場所（一部のアプリ内ブラウザなど）でも困らないよう、
            起動した瞬間に <code>fetch</code> などの道具を、あとから戻せない形で
            使えなくしています。道具が無ければ、そもそも送れません。
          </li>
          <li>
            <strong>ブラウザの翻訳機能を止めています。</strong>
            「このページを翻訳しますか？」は、<strong>ページの文字を翻訳会社のサーバーへ
            送って</strong>行われます。ブラウザ自身の機能なので上の禁止では止まりません。
            そこで、このページを翻訳の対象にしない宣言をしています。
          </li>
          <li>
            <strong>入力欄のスペルチェックを切っています。</strong>
            ブラウザの「高度なスペルチェック」は、入力した文字を
            <strong>メーカーのサーバーへ送って</strong>調べます。貼り付け欄には本1冊ぶんの
            原稿が入りうるので、対象から外してあります（探した言葉も同じです）。
          </li>
          <li>
            <strong>本の題名も外に出しません。</strong>
            画面の題名（タブの名前）には本の題名を入れていません。閲覧履歴や
            アプリ切り替え画面、ブラウザの同期に本の題名が残らないようにするためです。
          </li>
          <li>
            <strong>本文をHTMLとして解釈しません。</strong>
            本文に <code>&lt;script&gt;</code> と書かれていても、命令ではなく
            ただの文字として表示します。
          </li>
          <li>
            <strong>リンクは、押しただけでは開きません。</strong>
            本の外を指すリンクを押すと、まず行き先のURLを出して確かめます。
            「それでも開く」を選んだときだけ外に移り、そのときも参照元は渡しません。
            <code>javascript:</code> のような行き先は、そもそも取り除いてあります。
          </li>
          <li>
            <strong>外部の画像を読み込みません。</strong>
            画像は本の中に埋め込まれたものだけを表示します。本文に外部の画像の
            住所が書かれていても、取りに行きません（取りに行くこと自体が、
            相手に「読んでいる」と知らせることになるためです）。
          </li>
          <li>
            <strong>表紙も端末の中で描いています。</strong>
            本の中身から色と模様を決めて、その場で描き起こしています。
            画像生成AIにも素材サイトにも本文を渡しません。
          </li>
          <li>
            <strong>解析に外部の部品を使っていません。</strong>
            Markdownの解釈はこのアプリ自身のコードだけで行っています。
          </li>
          <li>
            <strong>他のページに埋め込まれた状態では開きません。</strong>
            外側のページに操作を横取りされることがないようにしています。
          </li>
          <li>
            <strong>保存はこの端末だけ。</strong>
            アカウントも登録も不要で、完全に無料です。
          </li>
          <li>
            <strong>あとから崩れないようにしています。</strong>
            ここに書いたことが1つでも崩れると、栞は<strong>組み立てに失敗して
            公開されません</strong>。人が気をつけるだけだと、いつか一行足したときに
            静かに破れてしまうためです。
          </li>
          <li>
            <strong>アプリとして入れても、安全のしくみは同じです。</strong>
            ホーム画面から開く見た目になるだけで、動かしているものは変わりません。
            上の「外部への通信」も同じように 0 のままです。
          </li>
        </ul>

        <div className="sheet-sub">
          <p className="muted">
            <strong>ここから先は、アプリでは守れないところです。</strong>
            正直にお伝えします。
          </p>
          <ul className="about">
            <li>
              <strong>あなた自身の操作。</strong>
              リンクを「それでも開く」で開いたときや、元の .md ファイルを
              ご自身で誰かに送ったときは、その分だけ外に出ます。
            </li>
            <li>
              <strong>端末そのもの。</strong>
              画面の写真を撮られる、端末を他人に使われる、端末に入っている別のアプリが
              画面を見ている——といった場合は、栞の側では防げません。端末の画面ロックを
              かけ、心当たりのないアプリを入れないでください。
            </li>
            <li>
              <strong>アプリ内ブラウザ。</strong>
              LINEやメールなどのアプリの中で開いた画面は、そのアプリを通して
              表示されています。<strong>アプリとして入れて</strong>お使いいただくのが
              いちばん確実です。
            </li>
            <li>
              <strong>配信元の記録。</strong>
              栞そのものを読み込むときだけは、置いてある場所（GitHub Pages）に
              接続が残ります。ここで渡るのは「栞を開いた」という事実だけで、
              本の中身も題名も渡りません。アプリとして入れたあとは、
              その接続すら起きなくなります（機内モードでお確かめいただけます）。
            </li>
          </ul>
        </div>
      </Sheet>
    </div>
  );
}

/** 本棚に並べる1冊ぶんの表紙（中身から描いた絵ができ次第、差し替わる）。 */
function ShelfCover({ book }: { book: BookRecord }) {
  const imageUrl = useBookCover(book);
  return (
    <Cover
      title={book.title}
      author={book.author}
      seed={book.seed}
      progress={progressOf(book)}
      imageUrl={imageUrl}
    />
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
