import { useCallback, useRef, useState } from 'react';
import { readDroppedFiles } from '../assets';
import { chromeIntentUrl, isAndroid, isInAppBrowser, isStandalone } from '../browser';
import { useInstallPrompt } from '../../lib/useInstallPrompt';

interface Props {
  source: string;
  onSource: (text: string) => void;
  onFiles: (text: string, assets: Map<string, string>, names: string[], skipped: string[]) => void;
  onDone: () => void;
  ready: boolean;
}

const SAMPLE = `---
title: 星をひろう夜
author: 佐倉 みなみ
genre: ファンタジー
---

# 星をひろう夜

## 第一章　落ちてきた光

　その夜、海は静かだった。｜波打ち際《なみうちぎわ》に立つと、遠くの灯台がゆっくりと瞬いている。

　わたしは《《たしかに》》見た。空から、ひとつぶの光が落ちてくるのを。

> 星は落ちるものではなく、拾われるものだ。

## 第二章　森へ

　朝の森は湿っていて、木漏れ日が足元で揺れていた[^1]。

- 拾った光を返すこと
- 誰にも言わないこと

　詳しくは[第一章](#第一章　落ちてきた光)に書いたとおりだ。

[^1]: 森の名前は、地図には載っていない。
`;

/**
 * 原稿を選ぶための種類（accept）。
 * ここに `image/*` を混ぜてはいけない。混ぜると、Androidの選択画面が
 * 「カメラ」「写真」だけになり、ファイルアプリが候補から消えてしまう。
 * 画像は別の入力欄（下の md-pick-image）で選ぶ。
 */
const TEXT_ACCEPT = '.md,.markdown,.mdown,.mkd,.mdtext,.txt,.text,text/markdown,text/plain';

export default function ImportPanel({ source, onSource, onFiles, onDone, ready }: Props) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [inApp] = useState(isInAppBrowser);
  const { canInstall, promptInstall } = useInstallPrompt();
  const textarea = useRef<HTMLTextAreaElement>(null);

  const take = useCallback(
    async (list: FileList | File[] | null) => {
      const files = list ? [...list] : [];
      if (files.length === 0) return;

      const loaded = await readDroppedFiles(files);
      if (!loaded.text && loaded.imageCount === 0) {
        setNote(
          loaded.skipped.length > 0
            ? `読み込めませんでした：${loaded.skipped.join('、')}`
            : '読み込めるファイルがありませんでした。'
        );
        return;
      }
      onFiles(loaded.text, loaded.assets, loaded.names, loaded.skipped);

      const parts: string[] = [];
      if (loaded.names.length > 0) parts.push(`原稿${loaded.names.length}件`);
      if (loaded.imageCount > 0) parts.push(`画像${loaded.imageCount}枚`);
      if (loaded.skipped.length > 0) parts.push(`読み飛ばし${loaded.skipped.length}件`);
      setNote(`${parts.join('・')}を読み込みました。続けて選べば、そのうしろに足していきます。`);
    },
    [onFiles]
  );

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    void take(e.target.files);
    e.target.value = '';
  };

  /** 写した文章をそのまま流し込む（ファイルを選べない端末でいちばん確実な道）。 */
  const pasteFromClipboard = async () => {
    setClipboardFailed(false);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setClipboardFailed(true);
        return;
      }
      onSource(source.trim() ? `${source}\n\n${text}` : text);
      setNote('写しておいた文章を入れました。');
    } catch {
      // 端末が読み取りを許していないときは、自分で貼ってもらう
      setClipboardFailed(true);
      textarea.current?.focus();
      textarea.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const focusTextarea = () => {
    textarea.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    textarea.current?.focus();
  };

  return (
    <>
      {inApp && (
        <div className="notice">
          <span aria-hidden="true">⚑</span>
          <div>
            <b>アプリ内のブラウザで開いています。</b>
            <span>
              この画面ではファイルを選べないことがあります。下の「貼り付ける」なら確実に使えます。
            </span>
            {isAndroid() && (
              <div className="btn-row">
                <a className="btn" href={chromeIntentUrl()}>
                  Chromeで開き直す
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2>原稿を渡す</h2>
        <p className="hint">
          いちばん確実なのは<b>貼り付け</b>です。原稿を写して（コピーして）、下のボタンを押してください。
          パソコンやファイルを選べる端末なら、ファイルから読み込むこともできます。
        </p>

        <div className="btn-row">
          <button className="btn primary wide" onClick={pasteFromClipboard}>
            写した文章を貼り付ける
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          押しても入らないときは、
          <button className="linklike" onClick={focusTextarea}>
            下の入力欄
          </button>
          を長押しして「貼り付け」を選んでください。
        </p>
        {clipboardFailed && (
          <div className="notice">
            <span aria-hidden="true">⚑</span>
            <div>
              <b>この端末では、写した文章を自動で読み取れませんでした。</b>
              <span>下の入力欄を長押しして「貼り付け」を選んでください。</span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>ファイルから読み込む</h2>

        {/*
          ファイル選択の入力欄。スマートフォンでは端末ごとの差が大きく、
          次の形にしないとファイルアプリが候補に出ないことがある。

          - **原稿と画像の入力欄を分ける。** ひとつの欄で `image/*` も受け付けると、
            Androidの選択画面が「カメラ」「写真」だけになる。
          - **`multiple` を付けない。** 複数選択を求めると、それに対応しない
            ファイルアプリが候補から外される（Samsungの「マイファイル」など）。
          - **押すのは <label> から。** 利用者が入力欄そのものを押したことになる
            （JavaScriptから開くと、はじかれる端末がある）。

          それでも、選択画面そのものを用意しているのは端末側なので、
          選べないことは起こりうる。そのときのために、貼り付けと
          「共有から渡す」道を上と下に置いてある。
        */}
        <label
          className={`dropzone${over ? ' over' : ''}`}
          htmlFor="md-pick"
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files);
          }}
        >
          <b>原稿のファイルを選ぶ</b>
          <span>.md .markdown .txt（パソコンなら、ここに落とすこともできます）</span>
          <span>1つずつ選んでも、選ぶたびにうしろへ足していきます</span>
        </label>

        <input id="md-pick" type="file" accept={TEXT_ACCEPT} hidden onChange={onPicked} />
        <input id="md-pick-multi" type="file" accept={TEXT_ACCEPT} multiple hidden onChange={onPicked} />
        <input id="md-pick-plain" type="file" hidden onChange={onPicked} />
        <input id="md-pick-image" type="file" accept="image/*" multiple hidden onChange={onPicked} />

        <div className="btn-row" style={{ marginTop: 12 }}>
          <label className="btn ghost" htmlFor="md-pick-multi">
            まとめて選ぶ
          </label>
          <label className="btn ghost" htmlFor="md-pick-plain">
            種類を指定せずに選ぶ
          </label>
          <label className="btn ghost" htmlFor="md-pick-image">
            挿絵の画像を足す
          </label>
        </div>

        <p className="hint" style={{ marginTop: 10 }}>
          画像も入れておくと、本文の <code>![](ファイル名)</code> がその画像になります。
          複数の原稿は、ファイル名の順につなぎます。
        </p>

        {note && <div className="notice info">{note}</div>}
      </div>

      <div className="card">
        <h2>共有から渡す（スマートフォン向け）</h2>
        <p className="hint">
          製本所を<b>アプリとして入れておく</b>と、端末の「マイファイル」やメモ帳から
          <b>共有 → 製本所</b>で原稿をそのまま渡せます。ファイル選択の画面を通らないので、
          どの端末でも確実です。
        </p>
        <ol className="hint" style={{ paddingLeft: '1.3em' }}>
          <li>この画面をアプリとして入れる（下のボタン、またはブラウザのメニューから「ホーム画面に追加」）</li>
          <li>「マイファイル」で .md を長押し →「共有」</li>
          <li>共有先の一覧から<b>製本所</b>を選ぶ</li>
        </ol>
        {canInstall && (
          <div className="btn-row">
            <button className="btn primary" onClick={promptInstall}>
              アプリとして入れる
            </button>
          </div>
        )}
        {isStandalone() && (
          <div className="notice ok">
            <span aria-hidden="true">✓</span>
            <div>
              <b>アプリとして開いています。</b>
              <span>「共有 → 製本所」が使えます。</span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>貼り付ける</h2>
        <p className="hint">
          どの端末でも確実に使える方法です。貼った瞬間から本の形に組み上がります。
          書き換えれば、その場で組み直します。
        </p>
        <textarea
          ref={textarea}
          value={source}
          onChange={(e) => onSource(e.target.value)}
          placeholder={'# 本のタイトル\n\n## 第一章\n\n　本文をここに……'}
          spellCheck={false}
        />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={onDone} disabled={!ready}>
            本にする
          </button>
          <button className="btn ghost" onClick={() => onSource(SAMPLE)}>
            見本を入れてみる
          </button>
          <button className="btn ghost" onClick={() => onSource('')} disabled={!source}>
            消す
          </button>
        </div>
      </div>

      <div className="card">
        <h2>使える書き方</h2>
        <ul className="hint" style={{ paddingLeft: '1.2em' }}>
          <li><b># 見出し</b>：章と目次になります（何段目で章を分けるかは自動判定・変更可）</li>
          <li><b>[表示する文字](#見出し名)</b>：章をまたぐリンクとして本の中でつながります</li>
          <li><b>[^1]</b>：脚注。Kindleではタップで開くポップアップ注になります</li>
          <li><b>｜漢字《かんじ》</b>：ルビ　<b>《《ここ》》</b>：傍点</li>
          <li>箇条書き・引用・表・コード・水平線・YAMLフロントマターにも対応しています</li>
        </ul>
      </div>
    </>
  );
}
