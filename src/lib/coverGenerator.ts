import type { Novel } from '../types';

// タイトル・ジャンルから、外部AI（画像生成）を使わずCanvas APIだけで
// 表紙・章ごとの装飾イラストを自動デザインする。実際のシーンを描いた
// 挿し絵ではなく、色とアイコンによる抽象的なデザインである点に留意。

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
  from: string;
  to: string;
  accent: string;
  text: string;
}

const PALETTES: Palette[] = [
  { from: '#2b1a4a', to: '#6b3fa0', accent: '#f2c94c', text: '#f7f3ff' },
  { from: '#0f2b2e', to: '#1f6f6b', accent: '#f2c94c', text: '#f2fbfa' },
  { from: '#2a0f1a', to: '#7a2340', accent: '#f2d49a', text: '#fdf2f5' },
  { from: '#0d1b3e', to: '#33418f', accent: '#9fd3ff', text: '#f2f6ff' },
  { from: '#12281a', to: '#2f6b3a', accent: '#ffe08a', text: '#f3fbf3' },
  { from: '#241608', to: '#7a4a1e', accent: '#ffdca0', text: '#fdf6ec' },
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

function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconName,
  cx: number,
  cy: number,
  r: number,
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (icon) {
    case 'heart': {
      ctx.beginPath();
      const s = r * 0.9;
      ctx.moveTo(cx, cy + s * 0.6);
      ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.4, cx - s * 0.5, cy - s * 1.2, cx, cy - s * 0.3);
      ctx.bezierCurveTo(cx + s * 0.5, cy - s * 1.2, cx + s * 1.3, cy - s * 0.4, cx, cy + s * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'magnifier': {
      ctx.beginPath();
      ctx.arc(cx - r * 0.15, cy - r * 0.15, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.25, cy + r * 0.25);
      ctx.lineTo(cx + r * 0.75, cy + r * 0.75);
      ctx.stroke();
      break;
    }
    case 'orbit': {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.95, r * 0.35, Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.95, r * 0.35, -Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'leaf': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.bezierCurveTo(cx + r * 0.9, cy - r * 0.6, cx + r * 0.9, cy + r * 0.6, cx, cy + r);
      ctx.bezierCurveTo(cx - r * 0.9, cy + r * 0.6, cx - r * 0.9, cy - r * 0.6, cx, cy - r);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.8);
      ctx.lineTo(cx, cy + r * 0.8);
      ctx.stroke();
      break;
    }
    case 'moonstar': {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.6, Math.PI * 0.15, Math.PI * 1.55, false);
      ctx.arc(cx + r * 0.32, cy - r * 0.05, r * 0.55, Math.PI * 1.55, Math.PI * 0.15, true);
      ctx.closePath();
      ctx.fill();
      drawStar(ctx, cx + r * 0.75, cy + r * 0.55, r * 0.16, color);
      drawStar(ctx, cx - r * 0.7, cy - r * 0.6, r * 0.1, color);
      break;
    }
    case 'spark':
    default: {
      drawStar(ctx, cx, cy, r * 0.85, color);
      break;
    }
  }
  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string
) {
  ctx.save();
  ctx.fillStyle = color;
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
  ctx.fill();
  ctx.restore();
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

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: Palette,
  rng: () => number
) {
  const grad = ctx.createLinearGradient(0, 0, w * 0.3, h);
  grad.addColorStop(0, palette.from);
  grad.addColorStop(1, palette.to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.12;
  const shapeCount = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < shapeCount; i++) {
    ctx.beginPath();
    const r = (0.08 + rng() * 0.22) * Math.min(w, h);
    const x = rng() * w;
    const y = rng() * h;
    ctx.fillStyle = palette.accent;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawCoverToCanvas(canvas: HTMLCanvasElement, novel: Novel, variation = 0) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const seed = hashString(`cover::${novel.title}::${novel.genre}::${variation}`);
  const rng = mulberry32(seed);
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)];
  const icon = pickIcon(novel.genre, novel.title);

  drawBackground(ctx, w, h, palette, rng);

  drawIcon(ctx, icon, w / 2, h * 0.3, Math.min(w, h) * 0.16, palette.accent);

  const title = novel.title || '無題の物語';
  let fontSize = Math.floor(w * (title.length > 12 ? 0.075 : 0.1));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.text;
  let lines: string[] = [];
  for (; fontSize > w * 0.045; fontSize -= 2) {
    ctx.font = `bold ${fontSize}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
    lines = wrapText(ctx, title, w * 0.8);
    if (lines.length <= 4) break;
  }
  const lineHeight = fontSize * 1.35;
  const startY = h * 0.56 - ((lines.length - 1) * lineHeight) / 2;
  ctx.font = `bold ${fontSize}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = fontSize * 0.15;
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, startY + i * lineHeight);
  });
  ctx.shadowBlur = 0;

  if (novel.genre) {
    ctx.font = `${Math.floor(w * 0.032)}px sans-serif`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(novel.genre, w / 2, h * 0.56 + (lines.length * lineHeight) / 2 + fontSize * 0.6);
    ctx.globalAlpha = 1;
  }

  const author = novel.penName || novel.author;
  if (author) {
    ctx.font = `${Math.floor(w * 0.045)}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
    ctx.fillStyle = palette.text;
    ctx.fillText(author, w / 2, h * 0.92);
  }

  ctx.strokeStyle = palette.accent;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(2, w * 0.006);
  ctx.strokeRect(w * 0.06, h * 0.04, w * 0.88, h * 0.92);
  ctx.globalAlpha = 1;
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

  drawBackground(ctx, w, h, palette, rng);
  drawIcon(ctx, icon, w / 2, h * 0.42, Math.min(w, h) * 0.34, palette.accent);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(h * 0.14)}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
  ctx.fillStyle = palette.text;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = h * 0.05;
  ctx.fillText(chapterTitle, w / 2, h * 0.82);
  ctx.shadowBlur = 0;
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
