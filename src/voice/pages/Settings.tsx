/**
 * 設定と「安全のしくみ」。
 *
 * 安全の説明を隠さず、実際に調べた結果として見せる。
 * 「通信しません」と書くだけなら誰でも書けるので、この端末で
 * 何個の声を使い、何個を使わずに伏せたのかを、その場で数えて出す。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  clearLibrary,
  deleteBook,
  isEphemeral,
  listBooks,
  storageInfo,
  type VoiceBook,
} from '../db';
import {
  PALETTE_LABEL,
  PITCH_RANGE,
  RATE_RANGE,
  SIZE_RANGE,
  useSettings,
  type Palette,
} from '../settings';
import { useVoices } from '../useVoices';
import { BUILD_ID, serviceWorkerState } from '../sw-client';

function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { settings, update, reset } = useSettings();
  const pickVoice = useCallback((name: string) => update({ voiceName: name }), [update]);
  const { survey, ready, canSpeak } = useVoices(settings.voiceName, pickVoice);

  const [books, setBooks] = useState<VoiceBook[]>([]);
  const [storage, setStorage] = useState({ kept: false, used: '調べています' });
  const [worker, setWorker] = useState('調べています');
  /** 端末に何も残さない状態で動いているか（1ファイル版など） */
  const [ephemeral, setEphemeral] = useState(false);

  useEffect(() => {
    listBooks()
      .then((found) => {
        setBooks(found);
        // 保存が使えるかは、実際に読んでみて初めて分かる
        setEphemeral(isEphemeral());
      })
      .catch(() => setBooks([]));
    storageInfo().then(setStorage);
    serviceWorkerState().then(setWorker);
  }, []);

  return (
    <div className="app">
      <header className="bar">
        <button className="icon-btn" onClick={() => navigate('/')}>
          書棚
        </button>
        <h1>設定</h1>
      </header>

      {/* ---- 声 ---- */}
      <section className="card section">
        <h2>声</h2>

        {ready && (
          <div className={`banner ${canSpeak ? 'good' : 'warn'}`} style={{ marginTop: 0 }}>
            {canSpeak ? (
              <>
                この端末で使える声：<b>{survey.usable.length}個</b>
                （いずれも端末の中だけで話す声）
                {survey.refused > 0 && (
                  <>
                    <br />
                    使わずに伏せた声：<b>{survey.refused}個</b>
                    （本文をメーカーのサーバーへ送って読み上げる種類のため）
                  </>
                )}
              </>
            ) : (
              <>
                端末の中だけで話す声が見つかりません。安全のため、語り部は
                読み上げを行いません。端末の設定から読み上げ（音声合成）の
                データを追加すると使えるようになります。
              </>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <label htmlFor="voice">
            使う声
            <span className="sub">端末の中だけで話す声だけが並びます</span>
          </label>
          <select
            id="voice"
            value={settings.voiceName}
            disabled={!canSpeak}
            onChange={(e) => update({ voiceName: e.target.value })}
          >
            {survey.usable.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
            {survey.usable.length === 0 && <option value="">使える声がありません</option>}
          </select>
        </div>

        <div className="row">
          <label htmlFor="rate">
            話す速さ<span className="sub">{settings.rate.toFixed(2)}倍</span>
          </label>
          <input
            id="rate"
            type="range"
            min={RATE_RANGE.min}
            max={RATE_RANGE.max}
            step={RATE_RANGE.step}
            value={settings.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
          />
        </div>

        <div className="row">
          <label htmlFor="pitch">
            声の高さ<span className="sub">{settings.pitch.toFixed(2)}</span>
          </label>
          <input
            id="pitch"
            type="range"
            min={PITCH_RANGE.min}
            max={PITCH_RANGE.max}
            step={PITCH_RANGE.step}
            value={settings.pitch}
            onChange={(e) => update({ pitch: Number(e.target.value) })}
          />
        </div>

        <div className="row">
          <label htmlFor="volume">
            音の大きさ<span className="sub">{Math.round(settings.volume * 100)}%</span>
          </label>
          <input
            id="volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
          />
        </div>
      </section>

      {/* ---- 読み方 ---- */}
      <section className="card section">
        <h2>読み方</h2>
        <div className="row">
          <label>
            見出しも読む
            <span className="sub">章の題を声に出してから本文に入ります</span>
          </label>
          <Switch
            label="見出しも読む"
            on={settings.segment.headings}
            onChange={(v) => update({ segment: { ...settings.segment, headings: v } })}
          />
        </div>
        <div className="row">
          <label>
            表も読む<span className="sub">既定では飛ばします</span>
          </label>
          <Switch
            label="表も読む"
            on={settings.segment.tables}
            onChange={(v) => update({ segment: { ...settings.segment, tables: v } })}
          />
        </div>
        <div className="row">
          <label>
            ソースコードも読む<span className="sub">既定では飛ばします</span>
          </label>
          <Switch
            label="ソースコードも読む"
            on={settings.segment.code}
            onChange={(v) => update({ segment: { ...settings.segment, code: v } })}
          />
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          ふりがな（<code>｜漢字《かんじ》</code>）は、画面には漢字を出したまま、
          声にはふりがなを渡します。人名や地名も思ったとおりに読ませられます。
        </p>
      </section>

      {/* ---- 画面 ---- */}
      <section className="card section">
        <h2>画面</h2>
        <div className="row">
          <label htmlFor="palette">配色</label>
          <select
            id="palette"
            value={settings.palette}
            onChange={(e) => update({ palette: e.target.value as Palette })}
          >
            {(Object.keys(PALETTE_LABEL) as Palette[]).map((p) => (
              <option key={p} value={p}>
                {PALETTE_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="size">
            字の大きさ<span className="sub">{settings.size}px</span>
          </label>
          <input
            id="size"
            type="range"
            min={SIZE_RANGE.min}
            max={SIZE_RANGE.max}
            step={SIZE_RANGE.step}
            value={settings.size}
            onChange={(e) => update({ size: Number(e.target.value) })}
          />
        </div>
        <div className="row">
          <label>
            読んでいる文を追いかける
            <span className="sub">声に合わせて画面が送られます</span>
          </label>
          <Switch
            label="読んでいる文を追いかける"
            on={settings.follow}
            onChange={(v) => update({ follow: v })}
          />
        </div>
        <div className="row">
          <label>
            朗読中は画面を消さない
            <span className="sub">目で追いながら聴くときに便利です</span>
          </label>
          <Switch
            label="朗読中は画面を消さない"
            on={settings.awake}
            onChange={(v) => update({ awake: v })}
          />
        </div>
        <div className="row">
          <label>設定を初期値に戻す</label>
          <button className="btn" onClick={reset}>
            戻す
          </button>
        </div>
      </section>

      {/* ---- 安全のしくみ ---- */}
      <section className="card section">
        <h2>安全のしくみ</h2>
        <p className="note">
          語り部は、本の中身が端末の外に出ないように作ってあります。
          仕掛けは4つあり、どれか1つが破れても残りが効くようにしてあります。
        </p>
        <ol className="note" style={{ paddingLeft: '1.2em', marginTop: 10 }}>
          <li>
            <b>端末の中で話す声しか使わない。</b>
            読み上げの声には、文字をメーカーのサーバーへ送って音を作る種類があります
            （パソコン版Chromeの一部の声など）。これはブラウザ自身が送るため、
            ページ側の通信の禁止では止められません。語り部は
            <b>端末の中だけで話す声</b>だけを選び、
            それが1つも無いときは読み上げません。
            {ready && survey.refused > 0 && (
              <>（この端末では{survey.refused}個を伏せています）</>
            )}
          </li>
          <li>
            <b>一度に渡すのは一文だけ。</b>
            本文をまとめて渡さず、文ごとに切って渡します。
            万一のときも、渡っているのは常に一文で、本一冊ではありません。
          </li>
          <li>
            <b>通信の口をブラウザ側で閉じる。</b>
            配信されるHTMLに <code>connect-src 'none'</code> を宣言し、
            外へ送る手段そのものを禁止しています。翻訳機能も止めてあります
            （翻訳は本文を翻訳サーバーへ送るため）。
          </li>
          <li>
            <b>アプリ自身の手でも道具を取り上げる。</b>
            起動直後に <code>fetch</code> などを使えない形に置き換えます。
            宣言が読み飛ばされる環境でも、道具が無ければ送れません。
          </li>
        </ol>
        <p className="note" style={{ marginTop: 10 }}>
          本は、この端末のブラウザの中にだけ保存されます。会員登録も、
          広告も、利用状況の記録もありません。
        </p>
        <p className="note" style={{ marginTop: 10 }}>
          <b>さらに徹底したいときは「ひとり版」を。</b>
          語り部ぜんぶが入った<b>HTMLファイル1つ</b>です。手元に保存して開けば、
          読み込みのための接続も起きず、同じ置き場に別のアプリが同居することも
          ありません。中身を1文字でも書き換えると動かなくなります
          （差し替えの細工を防ぐため、コードのハッシュをCSPに書いてあります）。
          そのかわり書棚は残らず、聴くたびにファイルを選び直します。
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          <a href="./kataribe-standalone.html" download="語り部.html">
            ひとり版を保存する（HTMLファイル1つ）
          </a>
        </p>

        <p className="note" style={{ marginTop: 10 }}>
          なお、<b>スピーカーから出た音</b>は誰でも録音できます。ソフトウェアで
          防げるのは端末から先へ文字が渡ることまでで、聞こえている音そのものは
          守れません。人のいる場所ではイヤホンをお使いください。
        </p>
      </section>

      {/* ---- 保存データ ---- */}
      <section className="card section">
        <h2>保存データ</h2>
        {ephemeral && (
          <div className="banner good" style={{ marginTop: 0 }}>
            <b>端末には何も残していません。</b>
            この画面を閉じると、取り込んだ本は消えます（保存する場所が無いためです）。
            聴くたびにファイルを選び直すことになりますが、
            端末を後から調べられても本の中身は出てきません。
          </div>
        )}

        <div className="row">
          <label>
            書棚の本
            <span className="sub">
              {ephemeral
                ? 'この画面を閉じるまでのあいだだけ'
                : 'この端末の中だけにあります'}
            </span>
          </label>
          <span>{books.length}冊</span>
        </div>
        <div className="row">
          <label>使っている大きさ</label>
          <span>{storage.used}</span>
        </div>
        <div className="row">
          <label>
            消えないようにする
            <span className="sub">端末の空きが減っても書棚が保たれます</span>
          </label>
          <span>{storage.kept ? '設定済み' : '未設定'}</span>
        </div>
        <div className="row">
          <label>オフラインの備え</label>
          <span>{worker}</span>
        </div>
        <div className="row">
          <label>いま動いている版</label>
          <span className="note">{BUILD_ID}</span>
        </div>

        {books.map((book) => (
          <div className="row" key={book.id}>
            <label>
              {book.title}
              <span className="sub">{book.chars.toLocaleString('ja-JP')}字</span>
            </label>
            <button
              className="btn danger"
              onClick={async () => {
                await deleteBook(book.id);
                setBooks(await listBooks());
              }}
            >
              削除
            </button>
          </div>
        ))}

        {books.length > 0 && (
          <div className="row">
            <label>
              すべて削除<span className="sub">元に戻せません</span>
            </label>
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm('書棚の本をすべて削除します。よろしいですか？')) return;
                await clearLibrary();
                setBooks([]);
              }}
            >
              すべて削除
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
