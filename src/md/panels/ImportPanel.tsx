import { useRef, useState } from 'react';
import { readDroppedFiles } from '../assets';

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

export default function ImportPanel({ source, onSource, onFiles, onDone, ready }: Props) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const take = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const loaded = await readDroppedFiles([...list]);
    if (!loaded.text && loaded.assets.size === 0) {
      setNote('読み込めるファイルがありませんでした。');
      return;
    }
    onFiles(loaded.text, loaded.assets, loaded.names, loaded.skipped);
    const parts = [`${loaded.names.length}件の原稿`];
    if (loaded.imageCount > 0) parts.push(`画像${loaded.imageCount}枚`);
    if (loaded.skipped.length > 0) parts.push(`読み飛ばし${loaded.skipped.length}件`);
    setNote(`${parts.join('・')}を読み込みました。`);
  };

  return (
    <>
      <div className="card">
        <h2>原稿を渡す</h2>
        <p className="hint">
          Markdownファイルをここに落とすか、下の欄に貼り付けてください。見出しから章と目次が組まれ、
          内容に合った表紙と挿絵がその場で描かれます。画像も一緒に落とせば、本文の
          <code>![](ファイル名)</code> がそのまま挿絵になります。
        </p>

        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
          }}
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
          role="button"
          tabIndex={0}
        >
          <b>ファイルを落とす／選ぶ</b>
          <span>.md .markdown .txt と、画像（png・jpeg・gif・webp）</span>
          <span>複数まとめて渡すと、ファイル名の順につながります</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.markdown,.mdown,.mkd,.txt,.text,text/markdown,text/plain,image/*"
          hidden
          onChange={(e) => {
            void take(e.target.files);
            e.target.value = '';
          }}
        />
        {note && <p className="hint" style={{ marginTop: 10 }}>{note}</p>}
      </div>

      <div className="card">
        <h2>貼り付ける</h2>
        <p className="hint">貼った瞬間から本の形に組み上がります。書き換えれば、その場で組み直します。</p>
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
