/**
 * 書棚に並べる表紙。
 *
 * 題名から決まる配色と模様を、その場で描く。外部の画像を一切読まないので
 * 通信は起きず、「どの本を持っているか」が外に知られることもない。
 * 同じ題名なら必ず同じ表紙になるので、並びを覚えやすい。
 */

const PALETTES = [
  ['#2f3a56', '#7d90c0'],
  ['#4a2f38', '#b8433a'],
  ['#26382f', '#5f8f6d'],
  ['#3a3350', '#8f7bb5'],
  ['#523a24', '#b98a4d'],
  ['#1f3742', '#4f8ba0'],
];

function mix(seed: number, n: number): number {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export default function Cover({
  title,
  author,
  seed,
}: {
  title: string;
  author?: string;
  seed: number;
}) {
  const [dark, accent] = PALETTES[seed % PALETTES.length];
  const angle = Math.round(mix(seed, 1) * 120);
  const wave = 22 + Math.round(mix(seed, 2) * 16);

  return (
    <div
      className="book-cover"
      style={{
        background: `linear-gradient(${angle}deg, ${dark} 0%, ${accent} 100%)`,
      }}
    >
      {/* 声の広がりを思わせる弧。装飾なので読み上げの対象にはしない */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.28 }}
      >
        <circle cx="20" cy={wave} r="9" fill="none" stroke="#fff" strokeWidth="1.4" />
        <circle cx="20" cy={wave} r="17" fill="none" stroke="#fff" strokeWidth="1.1" />
        <circle cx="20" cy={wave} r="26" fill="none" stroke="#fff" strokeWidth="0.8" />
      </svg>
      <span className="cover-title">{title}</span>
      {author ? <span className="cover-author">{author}</span> : null}
    </div>
  );
}
