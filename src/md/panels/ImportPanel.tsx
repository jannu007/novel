import { useCallback, useState } from 'react';
import { readDroppedFiles } from '../assets';
import { isStandalone } from '../browser';

interface Props {
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
 * 種類を指定して選ぶときの accept。
 * 端末によってはこれを付けたほうがファイルアプリが出て、逆に付けると
 * 「カメラ」「写真」しか出なくなる端末もある。どちらが効くかは端末次第なので、
 * 主のボタンは種類を指定せず（＝いちばん間口の広い形）、
 * こちらは選び直し用として置いてある。
 * 画像も原稿も、受け取ったあとに中身で見分けるので、指定は無くても困らない。
 */
const TEXT_ACCEPT = '.md,.markdown,.mdown,.mkd,.mdtext,.txt,.text,text/markdown,text/plain';

export default function ImportPanel({ onSource, onFiles, onDone, ready }: Props) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');

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

  return (
    <div className="card">
      <h2>原稿を読み込む</h2>

      {/*
        ファイル選択の入力欄。スマートフォンでは端末ごとの差が大きい。

        - **主のボタンは種類（accept）を指定しない。** 種類を指定すると、
          それを写真の求めと受け取って「カメラ」「写真」しか出さない端末がある。
          指定しなければ、ふつうのファイル選択が開く見込みがいちばん高い。
          何が渡されても、画像か文書かは中身を見て判断している。
        - **`multiple` を付けない。** 複数選択を求めると、それに対応しない
          ファイルアプリが候補から外される（Samsungの「マイファイル」など）。
          まとめて選びたいときのために、別のボタンを用意してある。
        - **押すのは <label> から。** 利用者が入力欄そのものを押したことになる
          （JavaScriptから開くと、はじかれる端末がある）。
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
        <b>ファイルを選ぶ</b>
        <span>.md .markdown .txt と、挿絵にする画像</span>
        <span>1つずつ選んでも、選ぶたびにうしろへ足していきます</span>
      </label>

      <input id="md-pick" type="file" hidden onChange={onPicked} />
      <input id="md-pick-multi" type="file" multiple hidden onChange={onPicked} />
      <input id="md-pick-typed" type="file" accept={TEXT_ACCEPT} hidden onChange={onPicked} />
      {/*
        いちばん広く知られている種類だけを指定した欄。
        `.md` のような知らない拡張子が混ざると、端末が「写真の求め」と
        受け取ってしまうことがあるため、text/plain だけで開く道も置く。
      */}
      <input id="md-pick-text" type="file" accept="text/plain" hidden onChange={onPicked} />

      <div className="btn-row" style={{ marginTop: 12 }}>
        <label className="btn ghost" htmlFor="md-pick-multi">
          まとめて選ぶ
        </label>
        <label className="btn ghost" htmlFor="md-pick-typed">
          種類を指定して選ぶ
        </label>
        <label className="btn ghost" htmlFor="md-pick-text">
          テキストとして選ぶ
        </label>
      </div>

      {/*
        アプリとして入れて使っているとき、端末によっては選択画面に
        ファイルアプリが出てこない（端末側の仕組みなので、ここからは変えられない）。
        そのときのために、逆向きの道が一行だけ分かるようにしてある。
      */}
      {isStandalone() && (
        <p className="hint" style={{ marginTop: 10 }}>
          「マイファイル」から <b>共有 → 製本所</b> でも渡せます。
        </p>
      )}

      {note && <div className="notice info">{note}</div>}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={onDone} disabled={!ready}>
          本にする
        </button>
        <button className="btn ghost" onClick={() => onSource(SAMPLE)}>
          見本を入れてみる
        </button>
      </div>
    </div>
  );
}
