import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useWork } from '../useWork';
import { AppBar, TabBar, NotFound } from '../components/Chrome';
import { countNovelChars, estimatePages } from '../../lib/textStats';
import { generateTxt, generateBackupJson } from '../../lib/txt';
import { TRIM_SIZES } from '../../lib/trimSizes';
import {
  DEFAULT_ENABLED_RULES,
  DEFAULT_MAX_SENTENCE_LENGTH,
  proofreadText,
  ruleSeverity,
} from '../../lib/proofreader';
import type { Novel, TrimSize } from '../../types';
import { listImages, loadCover, toExportImage, toExportImages } from '../images';
import type { ExportImage } from '../../lib/blockContent';

async function exportEpub(
  work: Novel,
  images: Map<string, ExportImage>,
  cover?: ExportImage
) {
  const { generateEpub } = await import('../../lib/epub');
  await generateEpub(work, images, cover);
}

async function exportDocx(
  work: Novel,
  images: Map<string, ExportImage>,
  cover?: ExportImage
) {
  const { generateDocx } = await import('../../lib/docx');
  await generateDocx(work, images, cover);
}

export default function Finish() {
  const { id } = useParams();
  const { work, update, flush } = useWork(id);
  const [busy, setBusy] = useState<'epub' | 'docx' | null>(null);
  const [hasCover, setHasCover] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadCover(id).then((c) => !cancelled && setHasCover(Boolean(c)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 出せる状態かどうかの確認に使う「要修正」の件数
  const blocking = useMemo(() => {
    if (!work) return 0;
    return work.chapters.reduce((sum, c) => {
      const found = proofreadText(c.content, {
        enabled: DEFAULT_ENABLED_RULES,
        maxSentenceLength: DEFAULT_MAX_SENTENCE_LENGTH,
      });
      return sum + found.filter((i) => ruleSeverity(i.ruleId) === 'error').length;
    }, 0);
  }, [work]);

  if (work === undefined) return <div className="body muted">読み込み中…</div>;
  if (work === null) return <NotFound />;

  const chars = countNovelChars(work.chapters);
  const pages = estimatePages(chars);
  const emptyChapters = work.chapters.filter((c) => c.content.trim() === '').length;

  const checks = [
    { ok: !!work.title.trim(), label: 'タイトルを決めた' },
    { ok: !!(work.author.trim() || work.penName.trim()), label: '著者名を決めた' },
    { ok: !!work.synopsis.trim(), label: 'あらすじを書いた（商品説明に使えます）' },
    { ok: chars >= 5000, label: '本文が5,000字以上ある' },
    { ok: emptyChapters === 0, label: '空の章がない' },
    {
      ok: hasCover,
      label: hasCover ? '表紙をつけた' : '表紙をつける（作品一覧の左側から）',
    },
    {
      ok: blocking === 0,
      label:
        blocking === 0
          ? '推敲の「要修正」が残っていない'
          : `推敲の「要修正」が${blocking}件残っている`,
    },
  ];
  const done = checks.filter((c) => c.ok).length;

  async function run(kind: 'epub' | 'docx') {
    setBusy(kind);
    try {
      await flush();
      const images = await toExportImages(await listImages(work!.id));
      const coverImage = await loadCover(work!.id);
      const cover = coverImage ? await toExportImage(coverImage) : undefined;
      if (kind === 'epub') await exportEpub(work!, images, cover);
      else await exportDocx(work!, images, cover);
    } catch {
      alert('書き出しに失敗しました。もう一度お試しください。');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="screen">
      <AppBar title="仕上げ" sub={work.title || '無題'} back="/" />
      <div className="body">
        <div className="card">
          <div className="row">
            <div>
              <div style={{ fontWeight: 600 }}>
                {chars.toLocaleString()}字・約{pages.toLocaleString()}ページ
              </div>
              <div className="muted">{work.chapters.length}章</div>
            </div>
            <div className="spacer" />
            <Link className="btn btn-sm" to={`/w/${work.id}/read`}>
              縦書きで読む
            </Link>
          </div>
        </div>

        <div className="section-title">本の情報</div>
        <div className="card">
          <label className="field">
            <span>タイトル</span>
            <input
              className="input"
              value={work.title}
              onChange={(e) => update((w) => ({ ...w, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>著者名・ペンネーム</span>
            <input
              className="input"
              value={work.penName || work.author}
              placeholder="表紙と奥付に使われます"
              onChange={(e) => update((w) => ({ ...w, penName: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>ジャンル</span>
            <input
              className="input"
              value={work.genre}
              placeholder="例：現代ファンタジー"
              onChange={(e) => update((w) => ({ ...w, genre: e.target.value }))}
            />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>紙の本にするときの判型</span>
            <select
              className="input"
              value={work.trimSize}
              onChange={(e) => update((w) => ({ ...w, trimSize: e.target.value as TrimSize }))}
            >
              {Object.entries(TRIM_SIZES).map(([key, t]) => (
                <option key={key} value={key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="muted" style={{ display: 'block', marginTop: 4 }}>
              {TRIM_SIZES[work.trimSize].note}
            </span>
          </label>
        </div>

        <div className="section-title">
          出す前の確認 {done}/{checks.length}
        </div>
        <div className="card">
          {checks.map((c) => (
            <div className="row" key={c.label} style={{ padding: '5px 0' }}>
              <span style={{ color: c.ok ? 'var(--ok)' : 'var(--ink-3)', width: 20 }}>
                {c.ok ? '✓' : '−'}
              </span>
              <span style={{ fontSize: 14, color: c.ok ? 'var(--ink)' : 'var(--ink-2)' }}>
                {c.label}
              </span>
            </div>
          ))}
          {blocking > 0 && (
            <Link className="btn btn-wide btn-sm" to={`/w/${work.id}/polish`} style={{ marginTop: 8 }}>
              推敲で確認する
            </Link>
          )}
        </div>

        <div className="section-title">書き出す</div>
        <div className="stack">
          <div className="card">
            <b>EPUB</b>
            <p className="muted">
              電子書籍の標準形式です。Amazon KDPなどにそのまま入稿できます。
              自動生成した表紙と目次、ルビ・傍点も入ります。
            </p>
            <button
              className="btn btn-seal btn-wide"
              disabled={busy !== null}
              onClick={() => void run('epub')}
            >
              {busy === 'epub' ? '作成中…' : '.epub を保存'}
            </button>
          </div>
          <div className="card">
            <b>Word（DOCX）</b>
            <p className="muted">
              電子書籍にも紙の本にも使えます。ルビはWord標準のルビとして入ります。
            </p>
            <button
              className="btn btn-wide"
              disabled={busy !== null}
              onClick={() => void run('docx')}
            >
              {busy === 'docx' ? '作成中…' : '.docx を保存'}
            </button>
          </div>
          <div className="card">
            <b>テキスト</b>
            <p className="muted">
              小説投稿サイトに貼るならルビ記法つき、本文だけ欲しいなら記法なしを選べます。
            </p>
            <div className="row">
              <button className="btn btn-sm" onClick={() => generateTxt(work, true)}>
                記法つき
              </button>
              <button className="btn btn-sm" onClick={() => generateTxt(work, false)}>
                本文のみ
              </button>
            </div>
          </div>
          <div className="card">
            <b>バックアップ</b>
            <p className="muted">
              作品まるごと1ファイルに保存します。機種変更のときや、
              ブラウザのデータを消す前に必ず取っておいてください。
            </p>
            <button className="btn btn-wide" onClick={() => generateBackupJson(work)}>
              バックアップを保存
            </button>
          </div>
        </div>
      </div>
      <TabBar workId={work.id} />
    </div>
  );
}
