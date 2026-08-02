import type { Novel } from '../types';

// タイトル・ジャンルから、外部AI（画像生成）を使わずCanvas APIだけで
// 水彩画風の表紙・章ごとの挿し絵を自動デザインする。実写や生成AIの
// イラストではなく、にじみ・ブラーを重ねたプログラム的な水彩表現である点に留意。

function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Palette {
  paper: string;
  washA: string;
  washB: string;
  washC: string;
  ink: string;
}

const PALETTES: Palette[] = [
  { paper: '#faf3e8', washA: '#e0836f', washB: '#f2c05c', washC: '#d99a8f', ink: '#4a3428' },
  { paper: '#f3f6ef', washA: '#7fa98d', washB: '#c9d97a', washC: '#8fb9a8', ink: '#33452e' },
  { paper: '#f5f1f8', washA: '#9678c2', washB: '#e6a0c4', washC: '#b79ad1', ink: '#3c3350' },
  { paper: '#eef4f7', washA: '#6699c2', washB: '#8fcfc4', washC: '#7fb3d5', ink: '#2c4655' },
  { paper: '#faf0ef', washA: '#d9707a', washB: '#f0b8ab', washC: '#e0919e', ink: '#5a2c32' },
  { paper: '#f7f2e7', washA: '#c98f4e', washB: '#e0c07d', washC: '#d1a86c', ink: '#4a3820' },
];

type IconName = 'moonstar' | 'heart' | 'magnifier' | 'orbit' | 'leaf' | 'spark';

function pickIcon(genre: string, title: string): IconName {
  const s = `${genre} ${title}`.toLowerCase();
  if (/(恋愛|ラブ|ロマンス|romance|love|恋)/.test(s)) return 'heart';
  if (/(ミステリー|推理|探偵|mystery|謎)/.test(s)) return 'magnifier';
  if (/(sf|エスエフ|宇宙|space|近未来|サイエンス)/.test(s)) return 'orbit';
  if (/(ファンタジー|魔法|fantasy|異世界|竜|ドラゴン)/.test(s)) return 'moonstar';
  if (/(青春|日常|slice|学園|部活)/.test(s)) return 'leaf';
  if (/(ホラー|怪談|horror|怖)/.test(s)) return 'moonstar';
  return 'spark';
}

/** 円形をベースに輪郭を揺らがせた、水彩の「にじみ」らしい不規則なブロブのパスを作る */
function organicBlobPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rng: () => number,
  points = 10,
  wobble = 0.32
) {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const rad = r * (1 - wobble / 2 + rng() * wobble);
    pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad]);
  }
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const mid1: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const mid2: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    if (i === 0) ctx.moveTo(mid1[0], mid1[1]);
    ctx.quadraticCurveTo(p1[0], p1[1], mid2[0], mid2[1]);
  }
  ctx.closePath();
}

/** 水彩の一筆分：外側ににじみのハロー、内側にやや濃いコアを重ねて塗る */
function paintWash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  rng: () => number,
  alpha = 0.4
) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';

  ctx.filter = `blur(${Math.max(5, r * 0.22)}px)`;
  ctx.globalAlpha = alpha * 0.55;
  organicBlobPath(ctx, cx, cy, r * 1.15, rng);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.filter = `blur(${Math.max(2, r * 0.09)}px)`;
  ctx.globalAlpha = alpha;
  organicBlobPath(ctx, cx, cy, r * 0.88, rng);
  ctx.fill();

  ctx.restore();
}

/** 紙の質感を出すための粒状ノイズ */
function paintPaperGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: () => number
) {
  ctx.save();
  const count = Math.floor((w * h) / 1600);
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const dark = rng() < 0.55;
    ctx.fillStyle = dark ? 'rgba(120,95,70,0.045)' : 'rgba(255,255,255,0.06)';
    const s = 1 + rng() * 1.4;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: Palette,
  rng: () => number
) {
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, w, h);

  const washColors = [palette.washA, palette.washB, palette.washC];
  const washCount = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < washCount; i++) {
    const color = washColors[Math.floor(rng() * washColors.length)];
    const r = (0.16 + rng() * 0.26) * Math.min(w, h);
    const x = rng() * w;
    const y = rng() * h;
    paintWash(ctx, x, y, r, color, rng, 0.22 + rng() * 0.16);
  }

  paintPaperGrain(ctx, w, h, rng);

  // ページ端の水彩額縁（にじんだボーダー）
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = palette.washA;
  ctx.globalAlpha = 0.35;
  ctx.filter = 'blur(2px)';
  ctx.lineWidth = Math.max(3, w * 0.008);
  ctx.strokeRect(w * 0.045, h * 0.035, w * 0.91, h * 0.93);
  ctx.restore();
}

/** アイコンは水彩のにじみの上に、細い墨線のスケッチを重ねて描く */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconName,
  cx: number,
  cy: number,
  r: number,
  washColor: string,
  ink: string,
  rng: () => number
) {
  paintWash(ctx, cx + r * 0.05, cy + r * 0.08, r * 1.05, washColor, rng, 0.5);
  paintWash(ctx, cx - r * 0.1, cy - r * 0.05, r * 0.7, washColor, rng, 0.35);

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = Math.max(1.5, r * 0.045);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (icon) {
    case 'heart': {
      const s = r * 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.6);
      ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.4, cx - s * 0.5, cy - s * 1.2, cx, cy - s * 0.3);
      ctx.bezierCurveTo(cx + s * 0.5, cy - s * 1.2, cx + s * 1.3, cy - s * 0.4, cx, cy + s * 0.6);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'magnifier': {
      ctx.beginPath();
      ctx.arc(cx - r * 0.15, cy - r * 0.15, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.2, cy + r * 0.2);
      ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
      ctx.stroke();
      break;
    }
    case 'orbit': {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.9, r * 0.32, Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.9, r * 0.32, -Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'leaf': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.9);
      ctx.bezierCurveTo(cx + r * 0.85, cy - r * 0.5, cx + r * 0.85, cy + r * 0.5, cx, cy + r * 0.9);
      ctx.bezierCurveTo(cx - r * 0.85, cy + r * 0.5, cx - r * 0.85, cy - r * 0.5, cx, cy - r * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.7);
      ctx.lineTo(cx, cy + r * 0.7);
      ctx.stroke();
      break;
    }
    case 'moonstar': {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, Math.PI * 0.15, Math.PI * 1.55, false);
      ctx.arc(cx + r * 0.3, cy - r * 0.05, r * 0.5, Math.PI * 1.55, Math.PI * 0.15, true);
      ctx.closePath();
      ctx.stroke();
      drawStarOutline(ctx, cx + r * 0.7, cy + r * 0.5, r * 0.14);
      drawStarOutline(ctx, cx - r * 0.65, cy - r * 0.55, r * 0.09);
      break;
    }
    case 'spark':
    default: {
      drawStarOutline(ctx, cx, cy, r * 0.8);
      break;
    }
  }
  ctx.restore();
}

function drawStarOutline(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number
) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i;
    const ox = cx + Math.cos(angle) * r;
    const oy = cy + Math.sin(angle) * r;
    const ix = cx + Math.cos(angle + Math.PI / 4) * r * 0.32;
    const iy = cy + Math.sin(angle + Math.PI / 4) * r * 0.32;
    if (i === 0) ctx.moveTo(ox, oy);
    else ctx.lineTo(ox, oy);
    ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.stroke();
}

/** 半角スペースの無い日本語見出しを、指定幅に収まるよう複数行に折り返す */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawInkText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  ink: string,
  paper: string,
  haloWidth: number
) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = paper;
  ctx.lineWidth = haloWidth;
  ctx.globalAlpha = 0.85;
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}

export function drawCoverToCanvas(canvas: HTMLCanvasElement, novel: Novel, variation = 0) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const seed = hashString(`cover::${novel.title}::${novel.genre}::${variation}`);
  const rng = mulberry32(seed);
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)];
  const icon = pickIcon(novel.genre, novel.title);

  paintBackground(ctx, w, h, palette, rng);
  drawIcon(ctx, icon, w / 2, h * 0.3, Math.min(w, h) * 0.16, palette.washA, palette.ink, rng);

  const title = novel.title || '無題の物語';
  let fontSize = Math.floor(w * (title.length > 12 ? 0.075 : 0.1));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let lines: string[] = [];
  for (; fontSize > w * 0.045; fontSize -= 2) {
    ctx.font = `bold ${fontSize}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
    lines = wrapText(ctx, title, w * 0.8);
    if (lines.length <= 4) break;
  }
  const lineHeight = fontSize * 1.35;
  const startY = h * 0.56 - ((lines.length - 1) * lineHeight) / 2;
  ctx.font = `bold ${fontSize}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
  lines.forEach((line, i) => {
    drawInkText(ctx, line, w / 2, startY + i * lineHeight, palette.ink, palette.paper, fontSize * 0.22);
  });

  if (novel.genre) {
    ctx.font = `${Math.floor(w * 0.032)}px sans-serif`;
    ctx.globalAlpha = 0.75;
    drawInkText(
      ctx,
      novel.genre,
      w / 2,
      h * 0.56 + (lines.length * lineHeight) / 2 + fontSize * 0.6,
      palette.ink,
      palette.paper,
      w * 0.012
    );
    ctx.globalAlpha = 1;
  }

  const author = novel.penName || novel.author;
  if (author) {
    ctx.font = `${Math.floor(w * 0.045)}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
    drawInkText(ctx, author, w / 2, h * 0.92, palette.ink, palette.paper, w * 0.014);
  }
}

export function drawChapterIllustrationToCanvas(
  canvas: HTMLCanvasElement,
  novel: Novel,
  chapterTitle: string,
  index: number
) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const seed = hashString(`illust::${novel.title}::${chapterTitle}::${index}`);
  const rng = mulberry32(seed);
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)];
  const icon = pickIcon(novel.genre, `${novel.title} ${chapterTitle}`);

  paintBackground(ctx, w, h, palette, rng);
  drawIcon(ctx, icon, w / 2, h * 0.42, Math.min(w, h) * 0.34, palette.washA, palette.ink, rng);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(h * 0.14)}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
  drawInkText(ctx, chapterTitle, w / 2, h * 0.82, palette.ink, palette.paper, h * 0.03);
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export interface GeneratedImage {
  canvas: HTMLCanvasElement;
  bytes: Uint8Array;
  dataUrl: string;
}

export async function generateCoverImage(
  novel: Novel,
  width = 1000,
  height = 1600,
  variation = 0
): Promise<GeneratedImage> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawCoverToCanvas(canvas, novel, variation);
  const bytes = await canvasToPngBytes(canvas);
  return { canvas, bytes, dataUrl: canvas.toDataURL('image/png') };
}

export async function generateChapterIllustration(
  novel: Novel,
  chapterTitle: string,
  index: number,
  width = 1200,
  height = 500
): Promise<GeneratedImage> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawChapterIllustrationToCanvas(canvas, novel, chapterTitle, index);
  const bytes = await canvasToPngBytes(canvas);
  return { canvas, bytes, dataUrl: canvas.toDataURL('image/png') };
}
