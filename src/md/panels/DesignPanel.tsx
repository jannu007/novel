import { useCallback, useRef } from 'react';
import type { Book } from '../book';
import { describeScene, type SceneProfile } from '../analyze';
import { drawChapterArt, drawCover } from '../artwork';
import { imageToDataUrl, type PreparedImage } from '../assets';
import ArtCanvas from '../components/ArtCanvas';

interface Props {
  book: Book;
  bookProfile: SceneProfile;
  chapterProfiles: SceneProfile[];
  coverLayout: number;
  onCoverLayout: (next: number) => void;
  artSeed: number;
  onArtSeed: (next: number) => void;
  userCover: PreparedImage | null;
  onUserCover: (next: PreparedImage | null) => void;
}

/** 章の挿絵は多いと重いので、画面にはこの数だけ出す。 */
const PREVIEW_LIMIT = 8;

export default function DesignPanel({
  book,
  bookProfile,
  chapterProfiles,
  coverLayout,
  onCoverLayout,
  artSeed,
  onArtSeed,
  userCover,
  onUserCover,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const paintCover = useCallback(
    (canvas: HTMLCanvasElement) => {
      drawCover(canvas, {
        title: book.meta.title,
        subtitle: book.meta.subtitle,
        author: book.meta.author,
        profile: bookProfile,
        layout: coverLayout,
        variation: artSeed,
      });
    },
    [book.meta.title, book.meta.subtitle, book.meta.author, bookProfile, coverLayout, artSeed]
  );

  return (
    <>
      <div className="card">
        <h2>表紙</h2>
        <p className="hint">
          本文を読み取って「{describeScene(bookProfile)}」の情景として描いています。
          {bookProfile.evidence.length > 0 && `（手がかりにした言葉：${bookProfile.evidence.join('・')}）`}
          {bookProfile.genre && ` ジャンルは「${bookProfile.genre}」と見ています。`}
        </p>

        <div className="cover-frame">
          {userCover ? (
            <img src={userCover.dataUrl} alt="用意した表紙" />
          ) : (
            <ArtCanvas width={800} height={1280} paint={paintCover} alt="自動生成した表紙" />
          )}
        </div>

        {!userCover && (
          <div className="btn-row">
            <button className="btn" onClick={() => onArtSeed(artSeed + 1)}>
              別の絵にする
            </button>
            <button className="btn ghost" onClick={() => onCoverLayout(coverLayout + 1)}>
              文字の配置を変える
            </button>
            {artSeed !== 0 && (
              <button className="btn ghost" onClick={() => onArtSeed(0)}>
                最初の絵に戻す
              </button>
            )}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            自分の表紙を使う
          </button>
          {userCover && (
            <button className="btn ghost" onClick={() => onUserCover(null)}>
              自動生成に戻す
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            onUserCover(await imageToDataUrl(file));
          }}
        />
        <p className="hint" style={{ marginTop: 10 }}>
          自動生成の表紙は 1600 × 2560ピクセル（縦横比 1 : 1.6）で書き出します。これはKDPが推奨する大きさです。
        </p>
      </div>

      {book.options.illustrations && (
        <div className="card">
          <h2>章の扉絵</h2>
          <p className="hint">
            章ごとに、その章の本文から情景を見立てて描いています。書き出しには全{book.chapters.length}章ぶんが入ります。
          </p>
          <div className="art-grid">
            {book.chapters.slice(0, PREVIEW_LIMIT).map((chapter, i) => (
              <figure key={chapter.id}>
                <ChapterArt
                  title={chapter.title}
                  profile={chapterProfiles[i]}
                  seed={artSeed}
                />
                <figcaption>
                  {chapter.title}
                  <br />
                  {describeScene(chapterProfiles[i])}
                </figcaption>
              </figure>
            ))}
          </div>
          {book.chapters.length > PREVIEW_LIMIT && (
            <p className="hint" style={{ marginTop: 10 }}>
              ほか{book.chapters.length - PREVIEW_LIMIT}章ぶんは、書き出すときに描きます。
            </p>
          )}
        </div>
      )}
    </>
  );
}

function ChapterArt({
  title,
  profile,
  seed,
}: {
  title: string;
  profile: SceneProfile;
  seed: number;
}) {
  const paint = useCallback(
    (canvas: HTMLCanvasElement) => {
      drawChapterArt(canvas, { title, profile, withTitle: true, variation: seed });
    },
    [title, profile, seed]
  );
  return <ArtCanvas width={700} height={400} paint={paint} alt={`${title}の扉絵`} />;
}
