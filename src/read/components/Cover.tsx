/**
 * 本の表紙。
 *
 * その本の中身から描き起こした絵を使う（`src/read/cover.ts`）。
 * 描き上がるまでのあいだと、描けなかったときは、題名から決まる
 * 配色と模様の表紙を出す（本棚が空白にならないように）。
 * どちらも外部の画像を読みに行かないので、通信は発生しない。
 */

const PALETTES = [
  ['#2f3a56', '#7d90c0', '#e9e3d3'],
  ['#4a2f38', '#b8433a', '#f0e6d8'],
  ['#26382f', '#5f8f6d', '#eae7d6'],
  ['#3a3350', '#8f7bb5', '#ece6db'],
  ['#523a24', '#b98a4d', '#f2ead9'],
  ['#1f3742', '#4f8ba0', '#e6ece9'],
];

function mix(seed: number, n: number): number {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export default function Cover({
  title,
  author,
  seed,
  progress,
  imageUrl,
}: {
  title: string;
  author?: string;
  seed: number;
  progress?: number;
  /** 中身から描いた表紙。あればこちらを使う。 */
  imageUrl?: string | null;
}) {
  const [dark, accent, light] = PALETTES[seed % PALETTES.length];
  const angle = Math.round(mix(seed, 1) * 60) - 30;
  const band = 26 + Math.round(mix(seed, 2) * 26);
  const dot = 12 + Math.round(mix(seed, 3) * 30);

  return (
    <div className="cover" style={{ background: dark }}>
      {imageUrl ? (
        <img className="cover-art-img" src={imageUrl} alt="" />
      ) : (
        <>
          <div
            className="cover-art"
            style={{
              background: `linear-gradient(${angle + 120}deg, ${accent} 0%, transparent 70%)`,
            }}
          />
          <div className="cover-band" style={{ background: light, top: `${band}%` }} />
          <div className="cover-dot" style={{ borderColor: light, left: `${dot}%` }} />
          <div className="cover-text">
            <span className="cover-title" style={{ color: light }}>
              {title}
            </span>
            {author && (
              <span className="cover-author" style={{ color: light }}>
                {author}
              </span>
            )}
          </div>
        </>
      )}
      {progress !== undefined && progress > 0 && (
        <div className="cover-progress">
          <span style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
        </div>
      )}
    </div>
  );
}
