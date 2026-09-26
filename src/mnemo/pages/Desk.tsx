/**
 * 卓（つくえ）。
 *
 * 直しかけの原稿を並べておく場所。栞の「本棚」にあたるが、並ぶのは
 * 読み終えた本ではなく、これから手を入れる原稿なので、
 * 表紙よりも「どこまで直したか・印がいくつ残っているか」を大きく出す。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import {
  clearDrafts,
  deleteDraft,
  keepStorage,
  listDrafts,
  saveDraft,
  storageInfo,
  type DraftRecord,
} from '../db';
import { downloadSource, makeDraft, readDraftFiles, takeSharedFiles } from '../import';
import { BUILD_ID, serviceWorkerState } from '../sw-client';
import { SAMPLE_DRAFT, SAMPLE_FILE_NAME } from '../sample';

const SEEDED_KEY = 'mnemosyne:seeded';

/** 題名の種から、背の色みを決める。同じ題名ならいつも同じ色になる。 */
function hueOf(seed: number): number {
  return seed % 360;
}

export default function Desk() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DraftRecord[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [sheet, setSheet] = useState<null | 'paste' | 'about' | 'manage'>(null);
  const [pasted, setPasted] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');
  const [storage, setStorage] = useState<{ kept: boolean; used: string } | null>(null);
  const [swState, setSwState] = useState('');
  const { canInstall, promptInstall } = useInstallPrompt();
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setDrafts(await listDrafts());
  }, []);

  useEffect(() => {
    /*
     * 原稿を消さないようブラウザに頼んでおく。
     * 既定では「空きが足りなくなったら捨ててよい」扱いのままなので、
     * 直しかけの原稿が端末の判断で消えることがある。
     */
    keepStorage();

    (async () => {
      const existing = await listDrafts();
      // はじめて開いたときだけ、試し書き用の原稿を入れておく
      if (existing.length === 0 && localStorage.getItem(SEEDED_KEY) !== '1') {
        try {
          localStorage.setItem(SEEDED_KEY, '1');
        } catch {
          /* 保存できなくても続行する */
        }
        const sample = makeDraft(SAMPLE_DRAFT, SAMPLE_FILE_NAME);
        await saveDraft(sample);
        setDrafts([sample]);
        return;
      }
      setDrafts(existing);
    })();
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const { drafts: added, errors: failed } = await readDraftFiles(files);
      for (const draft of added) await saveDraft(draft);
      setErrors(failed);
      await refresh();
      // 1つだけ取り込んだときは、そのまま開く
      if (added.length === 1 && failed.length === 0) navigate(`/d/${added[0].id}`);
    },
    [navigate, refresh]
  );

  // 他のアプリから「共有」で送られてきた原稿を拾う
  useEffect(() => {
    takeSharedFiles().then((files) => {
      if (files.length > 0) void addFiles(files);
    });
  }, [addFiles]);

  useEffect(() => {
    if (sheet !== 'manage') return;
    storageInfo().then(setStorage);
    serviceWorkerState().then(setSwState);
  }, [sheet]);

  async function addPasted() {
    const text = pasted.trim();
    if (text === '') return;
    const name = `${pastedTitle.trim() || '貼り付けた原稿'}.md`;
    const draft = makeDraft(pasted, name);
    await saveDraft(draft);
    setPasted('');
    setPastedTitle('');
    setSheet(null);
    await refresh();
    navigate(`/d/${draft.id}`);
  }

  async function remove(draft: DraftRecord) {
    const marks = draft.marks.length;
    const fixes = draft.history.length;
    const extra =
      marks + fixes > 0 ? `\n付けた印 ${marks}件と、直した記録 ${fixes}件も消えます。` : '';
    if (!confirm(`「${draft.title || '無題'}」を消します。取り消せません。${extra}`)) return;
    await deleteDraft(draft.id);
    await refresh();
  }

  async function removeAll() {
    if (!confirm('この端末に入れた原稿を、印も直した記録もまとめて消します。取り消せません。')) {
      return;
    }
    await clearDrafts();
    setSheet(null);
    await refresh();
  }

  return (
    <div
      className={`desk${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <header className="desk-head">
        <div className="brand">
          <b>ムネモシュネ</b>
          <i>Mnemosyne</i>
        </div>
        <p className="tagline">
          本の形で読みながら、その場で直し、気づいたところに印を残す。
          原稿はこの端末から出ません。
        </p>
      </header>

      <div className="desk-actions">
        <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
          <PlusIcon />
          原稿を取り込む
        </button>
        <button className="btn" onClick={() => setSheet('paste')}>
          <PasteIcon />
          貼り付ける
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          /*
           * 種類でしぼり込まない。Androidでは .md を知らない端末があり、
           * しぼるとファイルアプリそのものが選択肢から消えてしまう。
           * 読めるかどうかは、選ばれたあとに中身で確かめている。
           */
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      )}

      {drafts === null && <p className="muted center">読み込み中…</p>}

      {drafts !== null && drafts.length === 0 && (
        <div className="empty">
          <span className="mark">朱</span>
          まだ原稿がありません。
          <br />
          手元の .md を取り込むか、文章を貼り付けてください。
        </div>
      )}

      {drafts !== null && drafts.length > 0 && (
        <ul className="drafts">
          {drafts.map((draft) => {
            const fixes = draft.history.length;
            const marks = draft.marks.length;
            const percent = Math.round((draft.position?.ratio ?? 0) * 100);
            return (
              <li key={draft.id} className="draft">
                <button className="draft-main" onClick={() => navigate(`/d/${draft.id}`)}>
                  <span
                    className="draft-spine"
                    style={{ ['--hue' as string]: `${hueOf(draft.seed)}` }}
                    aria-hidden
                  />
                  <span className="draft-body">
                    <strong>{draft.title || '無題'}</strong>
                    {draft.author && <em className="draft-author">{draft.author}</em>}
                    <span className="draft-meta">
                      <span>{draft.chars.toLocaleString()}字</span>
                      {fixes > 0 && <span className="tag tag-fix">直し {fixes}</span>}
                      {marks > 0 && <span className="tag tag-mark">印 {marks}</span>}
                      {percent > 0 && <span>{percent}%</span>}
                    </span>
                    <span className="gauge">
                      <i style={{ width: `${percent}%` }} />
                    </span>
                  </span>
                </button>
                <div className="draft-side">
                  <button
                    className="icon-btn"
                    onClick={() => downloadSource(draft)}
                    aria-label={`${draft.title || '無題'}を書き出す`}
                    title="直したあとの原稿を書き出す"
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => void remove(draft)}
                    aria-label={`${draft.title || '無題'}を消す`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="desk-foot">
        {canInstall && (
          <button className="btn btn-ghost" onClick={() => void promptInstall()}>
            <InstallIcon />
            アプリとして入れる
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => setSheet('about')}>
          <ShieldIcon />
          このアプリについて
        </button>
        <button className="btn btn-ghost" onClick={() => setSheet('manage')}>
          保存データ
        </button>
      </footer>

      {/* ---- 貼り付け ---- */}
      <Sheet open={sheet === 'paste'} title="文章を貼り付ける" onClose={() => setSheet(null)}>
        <label className="field">
          <span>題名（省略すると原稿の見出しから取ります）</span>
          <input
            className="input"
            value={pastedTitle}
            placeholder="例：夜明けの汽笛"
            spellCheck={false}
            onChange={(e) => setPastedTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>本文（Markdown）</span>
          <textarea
            className="input textarea"
            value={pasted}
            rows={10}
            placeholder={'# 第一章\n\n　ここに原稿を貼り付けてください。'}
            spellCheck={false}
            onChange={(e) => setPasted(e.target.value)}
          />
        </label>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setSheet(null)}>
            やめる
          </button>
          <button
            className="btn btn-primary"
            disabled={pasted.trim() === ''}
            onClick={() => void addPasted()}
          >
            取り込む
          </button>
        </div>
      </Sheet>

      {/* ---- このアプリについて ---- */}
      <Sheet open={sheet === 'about'} title="このアプリについて" onClose={() => setSheet(null)}>
        <p className="sheet-note">
          ムネモシュネは、書き上がった原稿を<strong>本の形で読みながら推敲する</strong>ための
          アプリです。読んでいる流れのまま、気になった段をその場で直し、
          あとで考えたいところに印を残せます。
        </p>
        <p className="sheet-note">
          名前は、ギリシャ神話の記憶の女神ムネモシュネから。
          読みながら「ここが気になった」と思ったことは、たいてい次の行で忘れます。
          それを覚えておくのがこのアプリの役目です。
        </p>
        <div className="section-title">原稿の行き先</div>
        <p className="sheet-note">
          原稿はこの端末のブラウザの中だけに保存されます。
          <strong>通信は一切行いません。</strong>送る手立て（fetch・WebSocketなど）は
          ブラウザ側の宣言（CSP）で禁止したうえ、アプリの起動時に道具そのものを
          取り上げています。書き出すときも、端末にファイルとして保存するだけです。
        </p>
        <p className="sheet-note">
          ブラウザの翻訳機能も切ってあります。翻訳はページの文字を翻訳サーバーへ
          送って行われるため、これだけは禁止の網にかからないからです。
        </p>
      </Sheet>

      {/* ---- 保存データ ---- */}
      <Sheet open={sheet === 'manage'} title="保存データ" onClose={() => setSheet(null)}>
        <dl className="facts">
          <dt>原稿</dt>
          <dd>{drafts?.length ?? 0}件</dd>
          <dt>使っている容量</dt>
          <dd>{storage?.used ?? '確認中…'}</dd>
          <dt>消さない設定</dt>
          <dd>{storage ? (storage.kept ? '有効' : '未設定（端末の判断で消えることがあります）') : '確認中…'}</dd>
          <dt>オフライン</dt>
          <dd>{swState || '確認中…'}</dd>
          <dt>この版</dt>
          <dd>{BUILD_ID}</dd>
        </dl>
        <p className="sheet-note">
          原稿はこの端末のブラウザの中にだけあります。ブラウザのデータを消すと
          原稿も消えるので、大事なものは「書き出す」から手元に保存してください。
        </p>
        <div className="sheet-actions">
          <button className="btn btn-danger" onClick={() => void removeAll()}>
            すべて消す
          </button>
        </div>
      </Sheet>
    </div>
  );
}
