import { useState } from 'react';
import { downloadBlob, type Saveable } from '../save';
import SaveBox from '../components/SaveBox';
import type { Book } from '../book';
import type { SceneProfile } from '../analyze';
import { renderChapterArt, renderCover, type RenderedImage } from '../artwork';
import { buildEpub, type BookArtwork } from '../epub';
import { buildDocx, TRIMS, type TrimName } from '../docx';
import { decodeDataUrl, safeFileName, type PreparedImage } from '../assets';
import { blocksToText } from '../markdown';

interface Props {
  book: Book;
  bookProfile: SceneProfile;
  chapterProfiles: SceneProfile[];
  coverLayout: number;
  artSeed: number;
  userCover: PreparedImage | null;
  onPrint: () => void;
}

type Check = { state: 'ok' | 'warn' | 'ng'; text: string; detail?: string };

const MARK = { ok: '✓', warn: '！', ng: '×' };

export default function ExportPanel({
  book,
  bookProfile,
  chapterProfiles,
  coverLayout,
  artSeed,
  userCover,
  onPrint,
}: Props) {
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  /** 組み立て終わったファイル。保存はここから何度でもやり直せる。 */
  const [made, setMade] = useState<Saveable | null>(null);
  const [trim, setTrim] = useState<TrimName>('p6x9');

  const fileBase = safeFileName(book.meta.title, 'book');

  /** 画面を固まらせないよう、重い処理の合間にブラウザへ制御を返す。 */
  const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

  const makeArtwork = async (withChapterArt: boolean): Promise<BookArtwork> => {
    let cover: RenderedImage | null = null;
    if (userCover) {
      const decoded = decodeDataUrl(userCover.dataUrl);
      if (decoded) {
        cover = {
          bytes: decoded.bytes,
          mime: decoded.mime,
          width: userCover.width,
          height: userCover.height,
          dataUrl: userCover.dataUrl,
        };
      }
    } else {
      cover = await renderCover({
        title: book.meta.title,
        subtitle: book.meta.subtitle,
        author: book.meta.author,
        profile: bookProfile,
        layout: coverLayout,
        variation: artSeed,
      });
    }

    const chapterArt: (RenderedImage | null)[] = [];
    if (withChapterArt && book.options.illustrations) {
      for (let i = 0; i < book.chapters.length; i++) {
        setProgress(Math.round(((i + 1) / book.chapters.length) * 100));
        chapterArt.push(
          await renderChapterArt({
            title: book.chapters[i].title,
            profile: chapterProfiles[i],
            withTitle: true,
            variation: artSeed,
          })
        );
        await breathe();
      }
    }
    return { cover, chapterArt };
  };

  /**
   * 本を組み立て、できたファイルを手元に置く。
   * 保存（端末へ渡すところ）は、そのあと利用者が押したときに行う。
   * スマートフォンでは、押した直後でないと「共有」に渡せないため。
   */
  const run = async (label: string, task: () => Promise<Saveable>) => {
    setBusy(label);
    setProgress(0);
    setError('');
    setMade(null);
    try {
      await breathe();
      const item = await task();
      setMade(item);
      // パソコン向けに、まずはそのまま保存を試す。
      // スマートフォンでは弾かれることがあるので、下の受け渡し口も必ず出す。
      downloadBlob(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : '書き出しに失敗しました。');
    } finally {
      setBusy('');
      setProgress(0);
    }
  };

  const exportEpub = () =>
    run('EPUB', async () => {
      const artwork = await makeArtwork(true);
      const blob = await buildEpub(book, artwork);
      return { blob, name: `${fileBase}.epub` };
    });

  const exportDocx = () =>
    run('Word（DOCX）', async () => {
      const artwork = await makeArtwork(true);
      const blob = await buildDocx(book, artwork, { trim, vertical: book.options.vertical });
      return { blob, name: `${fileBase}.docx` };
    });

  const exportCover = () =>
    run('表紙画像', async () => {
      const artwork = await makeArtwork(false);
      if (!artwork.cover) throw new Error('表紙を作れませんでした。');
      const ext = artwork.cover.mime === 'image/png' ? 'png' : 'jpg';
      return {
        blob: new Blob([artwork.cover.bytes as BlobPart], { type: artwork.cover.mime }),
        name: `${fileBase}-cover.${ext}`,
      };
    });

  const exportText = () =>
    run('テキスト', async () => {
      const parts = [book.meta.title, book.meta.author, ''];
      for (const chapter of book.chapters) {
        parts.push('', chapter.title, '', blocksToText(chapter.blocks));
      }
      return {
        blob: new Blob([parts.join('\n')], { type: 'text/plain;charset=utf-8' }),
        name: `${fileBase}.txt`,
      };
    });

  const checks = buildChecks(book, userCover);
  const ng = checks.filter((c) => c.state === 'ng').length;

  return (
    <>
      <div className="card">
        <h2>Amazonに出す</h2>
        <p className="hint">
          KDP（Kindleダイレクト・パブリッシング）にそのまま登録できる形で書き出します。
          電子書籍はEPUB、ペーパーバックの原稿はWord、表紙は画像を使ってください。
        </p>

        {busy && (
          <>
            <p className="hint">{busy}を組み立てています…</p>
            <div className="progress">
              <div style={{ width: `${progress || 8}%` }} />
            </div>
          </>
        )}
        {error && <div className="notice" style={{ marginTop: 12 }}>{error}</div>}

        {made && !busy && <SaveBox item={made} title={book.meta.title} />}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={exportEpub} disabled={Boolean(busy)}>
            EPUB（Kindle電子書籍）
          </button>
          <button className="btn" onClick={exportDocx} disabled={Boolean(busy)}>
            Word（ペーパーバック原稿）
          </button>
          <button className="btn" onClick={exportCover} disabled={Boolean(busy)}>
            表紙画像
          </button>
          <button className="btn ghost" onClick={onPrint} disabled={Boolean(busy)}>
            印刷・PDF
          </button>
          <button className="btn ghost" onClick={exportText} disabled={Boolean(busy)}>
            テキスト
          </button>
        </div>
      </div>

      <div className="card">
        <h2>ペーパーバックの判型</h2>
        <p className="hint">Wordで書き出すときの紙の大きさです。KDPの規定サイズから選べます。</p>
        <label className="field">
          <span>判型</span>
          <select value={trim} onChange={(e) => setTrim(e.target.value as TrimName)}>
            {Object.entries(TRIMS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{TRIMS[trim].note}／ノド（綴じ側）に0.35インチの余白を足しています。</p>
      </div>

      <div className="card">
        <h2>出す前の確かめ</h2>
        <p className="hint">
          {ng === 0
            ? '出せる状態です。気になる点があれば下を確かめてください。'
            : '直したほうがよい点があります。'}
        </p>
        <ul className="check-list">
          {checks.map((check, i) => (
            <li key={i} className={check.state}>
              <span className="mark" aria-hidden="true">
                {MARK[check.state]}
              </span>
              <span>
                {check.text}
                {check.detail && <small>{check.detail}</small>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>登録のしかた（かんたんな手順）</h2>
        <ol className="hint" style={{ paddingLeft: '1.3em' }}>
          <li>KDP（kdp.amazon.co.jp）に無料の著者アカウントを作る</li>
          <li>「+ 電子書籍または有料マンガ」を選び、題名・著者名・紹介文を入れる</li>
          <li>原稿として、ここで書き出した <b>EPUB</b> を上げる</li>
          <li>表紙として、ここで書き出した <b>表紙画像</b> を上げる（自分の絵に差し替えても構いません）</li>
          <li>プレビューで確認し、価格を決めて出版する</li>
        </ol>
        <p className="hint">
          ペーパーバックにする場合は、原稿にWord、表紙に別途「表紙作成ツール」を使うのが手軽です。
        </p>
      </div>
    </>
  );
}

function buildChecks(book: Book, userCover: PreparedImage | null): Check[] {
  const checks: Check[] = [];
  const { meta, stats } = book;

  checks.push(
    meta.title && meta.title !== '無題の本'
      ? { state: 'ok', text: `題名：${meta.title}` }
      : { state: 'ng', text: '題名が決まっていません', detail: '「本のかたち」で入れてください。' }
  );

  checks.push(
    meta.author
      ? { state: 'ok', text: `著者名：${meta.author}` }
      : {
          state: 'warn',
          text: '著者名が空です',
          detail: 'KDPの登録画面でも入れられますが、本の中にも入れておくと親切です。',
        }
  );

  checks.push(
    stats.chapters >= 2
      ? { state: 'ok', text: `${stats.chapters}章に分かれ、目次が作られています` }
      : {
          state: 'warn',
          text: '章がひとつだけです',
          detail: '見出し（# や ##）を入れると、目次と章送りが効くようになります。',
        }
  );

  checks.push(
    stats.chars >= 2000
      ? { state: 'ok', text: `本文 ${stats.chars.toLocaleString()}字` }
      : {
          state: 'warn',
          text: `本文が ${stats.chars.toLocaleString()}字と短めです`,
          detail: '短編でも出版はできますが、内容量は購入者に表示されます。',
        }
  );

  if (userCover) {
    const ratio = userCover.height / userCover.width;
    const good = Math.abs(ratio - 1.6) < 0.12 && userCover.width >= 1000;
    checks.push(
      good
        ? { state: 'ok', text: `表紙：${userCover.width} × ${userCover.height}ピクセル` }
        : {
            state: 'warn',
            text: `表紙の縦横比が推奨から外れています（${userCover.width} × ${userCover.height}）`,
            detail: 'KDPの推奨は 1.6 : 1（例：1600 × 2560ピクセル）です。',
          }
    );
  } else {
    checks.push({ state: 'ok', text: '表紙：1600 × 2560ピクセルで自動生成します' });
  }

  checks.push(
    stats.externalLinks === 0
      ? { state: 'ok', text: '外部サイトへのリンクはありません' }
      : {
          state: 'warn',
          text: `外部サイトへのリンクが ${stats.externalLinks} 件あります`,
          detail:
            '他の販売サイトへのリンクはKDPの規約で認められていません。参考文献などであれば問題ありません。',
        }
  );

  const warnKinds = new Set(book.warnings.map((w) => w.kind));
  if (warnKinds.has('missing-image') || warnKinds.has('remote-image')) {
    checks.push({
      state: 'warn',
      text: '本文から参照された画像のうち、手元に無いものがあります',
      detail: '画像ファイルも一緒に読み込ませると、本文の中に入ります。',
    });
  }
  if (warnKinds.has('missing-anchor')) {
    checks.push({
      state: 'warn',
      text: '行き先の見つからない内部リンクがあります',
      detail: '見出し名と、リンクに書いた名前が一致しているか確かめてください。',
    });
  }

  checks.push({
    state: 'ok',
    text: '原稿は端末の外に出ていません',
    detail: 'この画面までのすべての処理が、あなたのブラウザの中だけで行われています。',
  });

  return checks;
}
