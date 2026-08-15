import { useCallback, useEffect, useRef, useState } from 'react';
import { readDroppedFiles } from '../assets';
import { chromeIntentUrl, isAndroid, isInAppBrowser, isStandalone } from '../browser';

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
  const [pickFailed, setPickFailed] = useState(false);
  const [inApp] = useState(isInAppBrowser);

  /** ファイル選択を開いたか（何も選ばずに戻ってきたのを見つけるため）。 */
  const picking = useRef(false);
  const picked = useRef(false);

  const markPicking = useCallback(() => {
    setPickFailed(false);
    picking.current = true;
    picked.current = false;
  }, []);

  // 選択画面から何も選ばずに戻ってきたら、別の入れ方を出す
  useEffect(() => {
    const onFocus = () => {
      if (!picking.current) return;
      picking.current = false;
      window.setTimeout(() => {
        if (!picked.current) setPickFailed(true);
      }, 900);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const take = useCallback(
    async (list: FileList | File[] | null) => {
      const files = list ? [...list] : [];
      if (files.length === 0) return;
      picked.current = true;
      setPickFailed(false);

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

  return (
    <>
      {inApp && (
        <div className="notice">
          <span aria-hidden="true">⚑</span>
          <div>
            <b>アプリ内のブラウザで開いています。</b>
            <span>
              この画面ではファイルを選べないことがあります（候補にカメラしか出ない場合）。
              下の「貼り付ける」なら確実に使えます。
            </span>
            {isAndroid() && (
              <div className="btn-row" style={{ marginTop: 8 }}>
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
          Markdownファイルを選ぶか、下の欄に貼り付けてください。見出しから章と目次が組まれ、
          内容に合った表紙と挿絵がその場で描かれます。
        </p>

        {/*
          ファイル選択の入力欄。スマートフォンでは端末ごとの差が大きく、
          次の形にしないとファイルアプリが候補に出ないことがある。

          - **原稿と画像の入力欄を分ける。** ひとつの欄で `image/*` も受け付けると、
            Androidの選択画面が「カメラ」「写真」だけになる。
          - **`multiple` を付けない。** 複数選択を求めると、それに対応しない
            ファイルアプリが候補から外される（Samsungの「マイファイル」など）。
          - **押すのは <label> から。** 利用者が入力欄そのものを押したことになる
            （JavaScriptから開くと、はじかれる端末がある）。

          それでも選べない端末のために、条件を変えた欄も置いてある。
        */}
        <label
          className={`dropzone${over ? ' over' : ''}`}
          htmlFor="md-pick"
          onClick={markPicking}
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
          <label className="btn ghost" htmlFor="md-pick-multi" onClick={markPicking}>
            まとめて選ぶ
          </label>
          <label className="btn ghost" htmlFor="md-pick-image" onClick={markPicking}>
            挿絵の画像を足す
          </label>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          画像も入れておくと、本文の <code>![](ファイル名)</code> がその画像になります。
          複数の原稿は、ファイル名の順につなぎます。
        </p>

        {note && <div className="notice info">{note}</div>}

        {/*
          選択画面から何も選ばずに戻ってきたとき。端末によっては候補にカメラしか出ず、
          そもそも選べないので、その場で別の道を出す。
        */}
        {pickFailed && (
          <div className="notice">
            <span aria-hidden="true">⚑</span>
            <div>
              <b>ファイルを選べましたか？</b>
              <span>
                候補に「カメラ」しか出ないのは、端末のファイルアプリがこの求めに応じていないためで、
                製本所からは変えられません。次のどれかでも原稿を渡せます。
              </span>
              {isStandalone() && (
                <span>
                  <b>おすすめ：</b>端末の「マイファイル」で .md を長押しして
                  <b>共有</b>や<b>コピー</b>を選び、下の欄に貼り付けてください。
                </span>
              )}
              <div className="btn-row" style={{ marginTop: 10 }}>
                <label className="btn" htmlFor="md-pick-plain" onClick={markPicking}>
                  種類を指定せずに選び直す
                </label>
                <label className="btn" htmlFor="md-pick-multi" onClick={markPicking}>
                  まとめて選ぶ
                </label>
                {isAndroid() && !isStandalone() && (
                  <a className="btn" href={chromeIntentUrl()}>
                    Chromeで開く
                  </a>
                )}
                <button className="btn ghost" onClick={() => setPickFailed(false)}>
                  閉じる
                </button>
              </div>
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
