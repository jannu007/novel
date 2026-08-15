/**
 * 表紙と挿絵を、Canvas だけで描く。
 *
 * 画像生成AIも素材サイトも使わない。原稿から見立てた情景（analyze.ts）を、
 * 水彩の重ね塗り・にじみ・紙の粒子として描き起こす。したがって
 *   ・完全に無料で、
 *   ・通信は一切発生せず、
 *   ・生成物の権利関係も濁らない（素材の再配布ではない）。
 * 同じ原稿からは毎回まったく同じ絵ができる。
 */

import type { SceneProfile, TimeOfDay } from './analyze';

// ---------------------------------------------------------------------------
// 乱数と色
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = hex.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: Rgb): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export interface Palette {
  paper: string;
  skyTop: string;
  skyBottom: string;
  light: string;
  far: string;
  mid: string;
  near: string;
  ink: string;
  accent: string;
}

const TIME_PALETTES: Record<TimeOfDay, Palette> = {
  dawn: {
    paper: '#fbf4ea',
    skyTop: '#8fa9c9',
    skyBottom: '#f7d9bd',
    light: '#ffc78a',
    far: '#c2a3ab',
    mid: '#9c7f8c',
    near: '#57465a',
    ink: '#3b2f3a',
    accent: '#e08a6a',
  },
  day: {
    paper: '#fbf8f1',
    skyTop: '#9cc6e0',
    skyBottom: '#eef5f6',
    light: '#fff4c9',
    far: '#9db9c9',
    mid: '#6d92a4',
    near: '#3f5c66',
    ink: '#2f4148',
    accent: '#5d9e8f',
  },
  dusk: {
    paper: '#fbf1e6',
    skyTop: '#5b4c7e',
    skyBottom: '#f2a06f',
    light: '#ff9f61',
    far: '#8b6a86',
    mid: '#5d4568',
    near: '#2e2239',
    ink: '#2a2033',
    accent: '#e2724f',
  },
  night: {
    paper: '#f2f0ea',
    skyTop: '#141d3a',
    skyBottom: '#42527f',
    light: '#f6f1d6',
    far: '#26314f',
    mid: '#1a2338',
    near: '#0d1120',
    ink: '#101527',
    accent: '#c8b98a',
  },
};

/** 気分に合わせて配色を寄せる。 */
function tune(palette: Palette, profile: SceneProfile): Palette {
  const p = { ...palette };
  switch (profile.mood) {
    case 'warm':
      p.skyBottom = mix(p.skyBottom, '#ffd7a8', 0.35);
      p.accent = mix(p.accent, '#e2704c', 0.4);
      break;
    case 'cool':
      p.skyTop = mix(p.skyTop, '#9fc8d8', 0.35);
      p.far = mix(p.far, '#8fb2c4', 0.3);
      break;
    case 'dark':
      p.skyTop = mix(p.skyTop, '#2a2630', 0.45);
      p.skyBottom = mix(p.skyBottom, '#5c5460', 0.4);
      p.near = mix(p.near, '#12101a', 0.5);
      p.paper = mix(p.paper, '#d9d3cc', 0.3);
      break;
    case 'bright':
      p.skyBottom = mix(p.skyBottom, '#ffffff', 0.3);
      p.light = mix(p.light, '#ffffff', 0.35);
      break;
    default:
      break;
  }
  if (profile.season === 'autumn') {
    p.far = mix(p.far, '#c98a4b', 0.3);
    p.accent = mix(p.accent, '#c96a3a', 0.4);
  }
  if (profile.season === 'winter') {
    p.far = mix(p.far, '#dfe7ee', 0.35);
    p.mid = mix(p.mid, '#b9c6d2', 0.25);
  }
  if (profile.season === 'spring') {
    p.accent = mix(p.accent, '#e79ab4', 0.45);
  }
  return p;
}

export function paletteFor(profile: SceneProfile): Palette {
  return tune(TIME_PALETTES[profile.time], profile);
}

// ---------------------------------------------------------------------------
// 水彩の筆づかい
// ---------------------------------------------------------------------------

type Rng = () => number;

function blobPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rng: Rng,
  points = 11,
  wobble = 0.34
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
    const m1: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const m2: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    if (i === 0) ctx.moveTo(m1[0], m1[1]);
    ctx.quadraticCurveTo(p1[0], p1[1], m2[0], m2[1]);
  }
  ctx.closePath();
}

/** にじみ（外側の淡いハロー）と芯（内側の濃い部分）を重ねた、水彩の一筆。 */
function wash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  rng: Rng,
  a = 0.4
) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = `blur(${Math.max(6, r * 0.24)}px)`;
  ctx.globalAlpha = a * 0.5;
  blobPath(ctx, cx, cy, r * 1.16, rng);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.filter = `blur(${Math.max(2, r * 0.08)}px)`;
  ctx.globalAlpha = a;
  blobPath(ctx, cx, cy, r * 0.86, rng);
  ctx.fill();
  ctx.restore();
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  ctx.save();
  const count = Math.floor((w * h) / 2200);
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    ctx.fillStyle = rng() < 0.55 ? 'rgba(120,95,70,0.05)' : 'rgba(255,255,255,0.07)';
    const s = 1 + rng() * 1.6;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

/** 紙のふちに水彩がにじんだような枠。 */
function paintedFrame(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, rng: Rng) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.28;
  ctx.filter = 'blur(3px)';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, w * 0.006);
  const inset = Math.min(w, h) * 0.04;
  ctx.beginPath();
  const step = Math.max(w, h) / 40;
  const jitter = () => (rng() - 0.5) * step * 0.25;
  ctx.moveTo(inset + jitter(), inset + jitter());
  for (let x = inset; x <= w - inset; x += step) ctx.lineTo(x, inset + jitter());
  for (let y = inset; y <= h - inset; y += step) ctx.lineTo(w - inset + jitter(), y);
  for (let x = w - inset; x >= inset; x -= step) ctx.lineTo(x, h - inset + jitter());
  for (let y = h - inset; y >= inset; y -= step) ctx.lineTo(inset + jitter(), y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** 画面の四隅を少し落として、絵に落ち着きを出す。 */
function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, ink: string) {
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, alpha(ink, 0.22));
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 情景を描く
// ---------------------------------------------------------------------------

function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette, rng: Rng) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, p.skyTop);
  grad.addColorStop(0.62, mix(p.skyTop, p.skyBottom, 0.75));
  grad.addColorStop(1, p.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 5; i++) {
    wash(
      ctx,
      rng() * w,
      rng() * h * 0.7,
      (0.18 + rng() * 0.24) * Math.min(w, h),
      i % 2 === 0 ? p.skyTop : p.accent,
      rng,
      0.14 + rng() * 0.12
    );
  }
}

function paintSun(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  profile: SceneProfile,
  rng: Rng,
  horizon: number
) {
  const night = profile.time === 'night';
  const cx = w * (0.28 + rng() * 0.44);
  const cy = horizon * (night ? 0.38 : 0.55);
  const r = Math.min(w, h) * (night ? 0.055 : 0.075);

  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 4);
  glow.addColorStop(0, alpha(p.light, 0.55));
  glow.addColorStop(1, alpha(p.light, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // 月（夜）も日（昼）も、縁がやわらかい円として置く
  const disc = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.15, cx, cy, r);
  disc.addColorStop(0, mix(p.light, '#ffffff', 0.5));
  disc.addColorStop(0.82, p.light);
  disc.addColorStop(1, mix(p.light, p.skyTop, 0.35));
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (night || profile.weather === 'stars') {
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const x = rng() * w;
      const y = rng() * horizon * 0.92;
      const s = rng() * 2.2 + 0.6;
      ctx.globalAlpha = 0.3 + rng() * 0.6;
      ctx.fillStyle = p.light;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** 遠景・近景の稜線を、一続きの塗りとして描く。 */
function silhouette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  baseY: number,
  outline: (x: number) => number,
  a = 1
) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = 0; x <= w; x += Math.max(2, w / 240)) ctx.lineTo(x, outline(x));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function mountains(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  horizon: number,
  height: number,
  rng: Rng
) {
  const peaks = 3 + Math.floor(rng() * 3);
  const offsets = Array.from({ length: peaks }, () => ({
    x: rng(),
    h: 0.5 + rng() * 0.5,
    width: 0.18 + rng() * 0.2,
  }));
  silhouette(ctx, w, h, color, horizon, (x) => {
    let y = horizon;
    for (const peak of offsets) {
      const d = Math.abs(x / w - peak.x);
      if (d < peak.width) {
        const t = 1 - d / peak.width;
        y = Math.min(y, horizon - height * peak.h * t * t * (3 - 2 * t));
      }
    }
    return y;
  });
}

function cityline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  horizon: number,
  height: number,
  rng: Rng,
  windows: string | null
) {
  let x = 0;
  ctx.save();
  ctx.fillStyle = color;
  while (x < w) {
    const bw = w * (0.03 + rng() * 0.06);
    const bh = height * (0.25 + rng() * 0.85);
    ctx.fillRect(x, horizon - bh, bw + 1, bh + h);
    if (windows) {
      ctx.save();
      ctx.fillStyle = windows;
      const cols = Math.max(1, Math.floor(bw / (w * 0.016)));
      const rows = Math.max(1, Math.floor(bh / (h * 0.03)));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rng() < 0.42) continue;
          ctx.globalAlpha = 0.35 + rng() * 0.5;
          ctx.fillRect(
            x + bw * ((c + 0.28) / cols),
            horizon - bh + bh * ((r + 0.3) / rows),
            bw / cols * 0.4,
            bh / rows * 0.34
          );
        }
      }
      ctx.restore();
    }
    x += bw + w * 0.006;
  }
  ctx.restore();
}

function tree(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  size: number,
  color: string,
  rng: Rng
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x - size * 0.045, baseY - size * 0.55, size * 0.09, size * 0.55);
  for (let i = 0; i < 4; i++) {
    blobPath(
      ctx,
      x + (rng() - 0.5) * size * 0.3,
      baseY - size * (0.6 + rng() * 0.35),
      size * (0.2 + rng() * 0.16),
      rng,
      9,
      0.5
    );
    ctx.fill();
  }
  ctx.restore();
}

function conifer(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  size: number,
  color: string
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, baseY - size);
  ctx.lineTo(x + size * 0.28, baseY);
  ctx.lineTo(x - size * 0.28, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, baseY - size * 0.72);
  ctx.lineTo(x + size * 0.36, baseY - size * 0.16);
  ctx.lineTo(x - size * 0.36, baseY - size * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function waves(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  horizon: number,
  rng: Rng
) {
  const seaGrad = ctx.createLinearGradient(0, horizon, 0, h);
  seaGrad.addColorStop(0, mix(p.mid, p.skyBottom, 0.45));
  seaGrad.addColorStop(1, p.near);
  ctx.fillStyle = seaGrad;
  ctx.fillRect(0, horizon, w, h - horizon);

  // 光の道
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = p.light;
  const cx = w * 0.5;
  for (let y = horizon; y < h; y += (h - horizon) / 26) {
    const t = (y - horizon) / (h - horizon);
    const width = w * (0.02 + t * 0.16) * (0.6 + rng() * 0.8);
    ctx.fillRect(cx - width / 2 + (rng() - 0.5) * w * 0.05, y, width, Math.max(2, h * 0.004));
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = alpha(p.paper, 0.55);
  ctx.lineCap = 'round';
  for (let i = 0; i < 42; i++) {
    const t = rng();
    const y = horizon + (h - horizon) * t * t;
    const len = w * (0.03 + rng() * 0.12) * (0.4 + t);
    ctx.lineWidth = Math.max(1.2, (h - horizon) * 0.006 * (0.4 + t));
    ctx.globalAlpha = 0.2 + rng() * 0.45;
    ctx.beginPath();
    const x0 = rng() * w;
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0 + len / 2, y - (h - horizon) * 0.012, x0 + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

function ground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  horizon: number,
  color: string
) {
  const grad = ctx.createLinearGradient(0, horizon, 0, h);
  grad.addColorStop(0, mix(color, p.skyBottom, 0.35));
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, horizon, w, h - horizon);
}

function castle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  horizon: number,
  scale: number,
  rng: Rng
) {
  const cx = w * (0.42 + rng() * 0.16);
  const base = horizon;
  const unit = Math.min(w, h) * 0.06 * scale;
  ctx.save();
  ctx.fillStyle = color;
  const tower = (x: number, wid: number, hei: number, spire: number) => {
    ctx.fillRect(x - wid / 2, base - hei, wid, hei);
    ctx.beginPath();
    ctx.moveTo(x - wid * 0.75, base - hei);
    ctx.lineTo(x, base - hei - spire);
    ctx.lineTo(x + wid * 0.75, base - hei);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillRect(cx - unit * 2.6, base - unit * 2.2, unit * 5.2, unit * 2.2);
  tower(cx, unit * 1.5, unit * 5, unit * 1.8);
  tower(cx - unit * 2.4, unit * 1.05, unit * 3.4, unit * 1.3);
  tower(cx + unit * 2.4, unit * 1.05, unit * 3.6, unit * 1.3);
  ctx.restore();
}

function planet(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  rng: Rng
) {
  const cx = w * (0.62 + rng() * 0.2);
  const cy = h * (0.3 + rng() * 0.16);
  const r = Math.min(w, h) * (0.12 + rng() * 0.06);
  ctx.save();
  const grad = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
  grad.addColorStop(0, mix(p.accent, '#ffffff', 0.4));
  grad.addColorStop(1, mix(p.accent, p.near, 0.55));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = alpha(p.light, 0.8);
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.75, r * 0.4, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function windowFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette
) {
  ctx.save();
  ctx.strokeStyle = p.near;
  ctx.lineWidth = Math.max(6, w * 0.018);
  const m = Math.min(w, h) * 0.09;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  ctx.beginPath();
  ctx.moveTo(w / 2, m);
  ctx.lineTo(w / 2, h - m);
  ctx.moveTo(m, h * 0.45);
  ctx.lineTo(w - m, h * 0.45);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = p.near;
  ctx.fillRect(0, h * 0.88, w, h * 0.12);
  ctx.restore();
}

function schoolBuilding(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  horizon: number,
  rng: Rng
) {
  const bw = w * 0.62;
  const bh = h * 0.2;
  const x = w * 0.19 + (rng() - 0.5) * w * 0.06;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x, horizon - bh, bw, bh);
  ctx.fillRect(x + bw * 0.42, horizon - bh * 1.45, bw * 0.16, bh * 0.45);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#ffffff';
  const cols = 12;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect(
        x + bw * ((c + 0.25) / cols),
        horizon - bh + bh * ((r + 0.3) / 3.4),
        (bw / cols) * 0.5,
        bh * 0.15
      );
    }
  }
  ctx.restore();
}

function grasses(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  baseY: number,
  rng: Rng,
  flowers: string | null
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const x = rng() * w;
    const len = (h - baseY) * (0.1 + rng() * 0.35);
    const lean = (rng() - 0.5) * len * 0.6;
    ctx.lineWidth = Math.max(1.5, w * 0.0025);
    ctx.globalAlpha = 0.35 + rng() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.quadraticCurveTo(x + lean * 0.4, h - len * 0.6, x + lean, h - len);
    ctx.stroke();
    if (flowers && rng() < 0.12) {
      ctx.fillStyle = flowers;
      ctx.beginPath();
      ctx.arc(x + lean, h - len, Math.max(2.5, w * 0.005), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function weatherOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  profile: SceneProfile,
  rng: Rng
) {
  ctx.save();
  if (profile.weather === 'rain') {
    ctx.strokeStyle = alpha(p.paper, 0.6);
    ctx.lineWidth = Math.max(1, w * 0.0015);
    for (let i = 0; i < 260; i++) {
      const x = rng() * w * 1.2 - w * 0.1;
      const y = rng() * h;
      const len = h * (0.03 + rng() * 0.06);
      ctx.globalAlpha = 0.15 + rng() * 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.25, y + len);
      ctx.stroke();
    }
  } else if (profile.weather === 'snow') {
    for (let i = 0; i < 220; i++) {
      ctx.globalAlpha = 0.25 + rng() * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, Math.max(1.5, w * 0.002 * (0.5 + rng() * 2)), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (profile.weather === 'petals') {
    for (let i = 0; i < 120; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const s = Math.max(3, w * 0.004 * (0.6 + rng()));
      ctx.globalAlpha = 0.3 + rng() * 0.5;
      ctx.fillStyle = mix('#f6c3d4', p.accent, rng() * 0.4);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (profile.weather === 'cloud') {
    for (let i = 0; i < 7; i++) {
      wash(ctx, rng() * w, h * (0.1 + rng() * 0.35), Math.min(w, h) * (0.1 + rng() * 0.14), p.paper, rng, 0.32);
    }
  }
  ctx.restore();
}

/** 情景そのものを描く（表紙・挿絵で共通）。 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  profile: SceneProfile,
  variation = 0
) {
  const rng = mulberry32(profile.seed + variation * 7919);
  const p = paletteFor(profile);
  const horizon = h * (profile.scene === 'room' ? 0.62 : 0.6 + (rng() - 0.5) * 0.1);

  ctx.save();
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, w, h);
  paintSky(ctx, w, h, p, rng);
  paintSun(ctx, w, h, p, profile, rng, horizon);

  switch (profile.scene) {
    case 'sea':
      mountains(ctx, w, h, alpha(p.far, 0.75), horizon, h * 0.1, rng);
      waves(ctx, w, h, p, horizon, rng);
      break;
    case 'mountain':
      mountains(ctx, w, h, alpha(p.far, 0.8), horizon, h * 0.3, rng);
      mountains(ctx, w, h, alpha(p.mid, 0.9), horizon + h * 0.05, h * 0.2, rng);
      ground(ctx, w, h, p, horizon + h * 0.16, p.near);
      break;
    case 'forest':
      mountains(ctx, w, h, alpha(p.far, 0.6), horizon, h * 0.12, rng);
      ground(ctx, w, h, p, horizon, mix(p.mid, p.near, 0.5));
      for (let i = 0; i < 16; i++) {
        conifer(ctx, rng() * w, horizon + h * 0.02 + rng() * h * 0.08, h * (0.1 + rng() * 0.16), alpha(p.near, 0.85));
      }
      for (let i = 0; i < 5; i++) {
        tree(ctx, rng() * w, h * (0.95 + rng() * 0.05), h * (0.35 + rng() * 0.25), alpha(p.near, 0.9), rng);
      }
      break;
    case 'city':
      cityline(ctx, w, h, alpha(p.far, 0.65), horizon, h * 0.22, rng, null);
      cityline(ctx, w, h, p.near, horizon + h * 0.06, h * 0.3, rng, alpha(p.light, 0.9));
      break;
    case 'castle':
      mountains(ctx, w, h, alpha(p.far, 0.7), horizon, h * 0.18, rng);
      castle(ctx, w, h, p.mid, horizon + h * 0.02, 1, rng);
      ground(ctx, w, h, p, horizon + h * 0.02, p.near);
      for (let i = 0; i < 6; i++) {
        conifer(ctx, rng() * w, h * (0.9 + rng() * 0.1), h * (0.12 + rng() * 0.1), alpha(p.near, 0.9));
      }
      break;
    case 'space':
      planet(ctx, w, h, p, rng);
      ground(ctx, w, h, p, h * 0.82, p.near);
      break;
    case 'school':
      ground(ctx, w, h, p, horizon, mix(p.mid, p.near, 0.4));
      schoolBuilding(ctx, w, h, p.near, horizon, rng);
      grasses(ctx, w, h, alpha(p.near, 0.7), horizon, rng, null);
      break;
    case 'room':
      windowFrame(ctx, w, h, p);
      break;
    case 'field':
      mountains(ctx, w, h, alpha(p.far, 0.55), horizon, h * 0.1, rng);
      ground(ctx, w, h, p, horizon, mix(p.mid, '#8aa86a', 0.45));
      grasses(ctx, w, h, alpha(p.near, 0.75), horizon, rng, p.accent);
      break;
    case 'flower':
      ground(ctx, w, h, p, horizon, mix(p.mid, '#8aa86a', 0.35));
      grasses(ctx, w, h, alpha(p.near, 0.7), horizon, rng, p.accent);
      for (let i = 0; i < 3; i++) {
        wash(ctx, rng() * w, h * (0.7 + rng() * 0.25), Math.min(w, h) * 0.12, p.accent, rng, 0.45);
      }
      break;
    case 'road':
      mountains(ctx, w, h, alpha(p.far, 0.6), horizon, h * 0.14, rng);
      ground(ctx, w, h, p, horizon, mix(p.mid, p.near, 0.35));
      ctx.save();
      ctx.fillStyle = alpha(p.paper, 0.65);
      ctx.beginPath();
      ctx.moveTo(w * 0.47, horizon);
      ctx.lineTo(w * 0.53, horizon);
      ctx.lineTo(w * 0.82, h);
      ctx.lineTo(w * 0.18, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      for (let i = 0; i < 8; i++) {
        conifer(ctx, rng() < 0.5 ? w * (0.05 + rng() * 0.1) : w * (0.85 + rng() * 0.1), h * (0.75 + rng() * 0.25), h * (0.14 + rng() * 0.14), alpha(p.near, 0.85));
      }
      break;
    case 'sky':
    default:
      for (let i = 0; i < 6; i++) {
        wash(ctx, rng() * w, h * (0.15 + rng() * 0.45), Math.min(w, h) * (0.1 + rng() * 0.16), p.paper, rng, 0.3);
      }
      mountains(ctx, w, h, alpha(p.far, 0.5), h * 0.88, h * 0.08, rng);
      break;
  }

  weatherOverlay(ctx, w, h, p, profile, rng);
  grain(ctx, w, h, rng);
  vignette(ctx, w, h, p.ink);
  paintedFrame(ctx, w, h, p.ink, rng);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 文字を置く
// ---------------------------------------------------------------------------

const MINCHO =
  "'Hiragino Mincho ProN', 'Hiragino Mincho Pro', 'Yu Mincho', 'YuMincho', 'Noto Serif JP', " +
  "'Noto Serif CJK JP', 'Source Han Serif JP', 'IPAexMincho', 'IPAMincho', 'MS Mincho', serif";
const GOTHIC =
  "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', " +
  "'Noto Sans CJK JP', 'IPAexGothic', 'IPAGothic', sans-serif";

/** 縦書きにしたとき、90度回して置く文字。 */
const ROTATE_IN_VERTICAL = new Set(['ー', '−', '—', '～', '〜', '（', '）', '「', '」', '『', '』', '【', '】', '〔', '〕', '｛', '｝', '＜', '＞', '(', ')', '[', ']']);

/** 縦書きで少しずらす小書き文字。 */
const SMALL_KANA = new Set(['、', '。', '，', '．', 'ゃ', 'ゅ', 'ょ', 'っ', 'ャ', 'ュ', 'ョ', 'ッ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ']);

function isLatin(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch);
}

/** 日本語の割合が高いか（縦書きにするかの判断）。 */
export function looksJapanese(text: string): boolean {
  const cjk = (text.match(/[　-ヿ一-鿿]/g) ?? []).length;
  return cjk >= Math.max(2, text.replace(/\s/g, '').length * 0.3);
}

interface TextStyle {
  size: number;
  color: string;
  halo?: string;
  haloWidth?: number;
  font?: string;
  weight?: string;
}

function applyFont(ctx: CanvasRenderingContext2D, style: TextStyle) {
  ctx.font = `${style.weight ?? 'bold'} ${style.size}px ${style.font ?? MINCHO}`;
}

function drawGlyph(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, style: TextStyle) {
  if (style.halo) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = style.halo;
    ctx.lineWidth = style.haloWidth ?? style.size * 0.2;
    ctx.globalAlpha = 0.85;
    ctx.strokeText(ch, x, y);
    ctx.restore();
  }
  ctx.fillStyle = style.color;
  ctx.fillText(ch, x, y);
}

/** 縦書きで1行ぶんの文字を置く。戻り値は使った高さ。 */
function drawVerticalLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  style: TextStyle
): number {
  applyFont(ctx, style);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = style.size * 1.06;
  let y = top + style.size * 0.5;
  let latinRun = '';

  const flushLatin = () => {
    if (!latinRun) return;
    ctx.save();
    ctx.translate(x, y + (style.size * (latinRun.length - 1)) / 2);
    ctx.rotate(Math.PI / 2);
    drawGlyph(ctx, latinRun, 0, 0, style);
    ctx.restore();
    y += step * latinRun.length;
    latinRun = '';
  };

  for (const ch of text) {
    if (isLatin(ch)) {
      latinRun += ch;
      continue;
    }
    flushLatin();
    if (ROTATE_IN_VERTICAL.has(ch)) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      drawGlyph(ctx, ch, 0, 0, style);
      ctx.restore();
    } else if (SMALL_KANA.has(ch)) {
      drawGlyph(ctx, ch, x + style.size * 0.22, y - style.size * 0.18, style);
    } else {
      drawGlyph(ctx, ch, x, y, style);
    }
    y += step;
  }
  flushLatin();
  return y - top;
}

/** 指定した幅に収まるように、日本語の文字列を折り返す。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const source of text.split('\n')) {
    let current = '';
    for (const ch of source) {
      if (ctx.measureText(current + ch).width > max && current) {
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/** 縦書きで、文字数に応じて行に割る。 */
function wrapVertical(text: string, perLine: number): string[] {
  const lines: string[] = [];
  for (const source of text.split('\n')) {
    for (let i = 0; i < source.length; i += perLine) {
      lines.push(source.slice(i, i + perLine));
    }
  }
  return lines.length > 0 ? lines : [''];
}

// ---------------------------------------------------------------------------
// 表紙・挿絵
// ---------------------------------------------------------------------------

export interface CoverInput {
  title: string;
  subtitle: string;
  author: string;
  profile: SceneProfile;
  /** 表紙のレイアウト（0〜3）。 */
  layout?: number;
  variation?: number;
}

export function drawCover(canvas: HTMLCanvasElement, input: CoverInput) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { profile } = input;
  const p = paletteFor(profile);
  const variation = input.variation ?? 0;
  const layout = (input.layout ?? 0) % 3;

  paintScene(ctx, w, h, profile, variation);

  const vertical = looksJapanese(input.title);
  const inkDark = profile.time === 'night' || profile.mood === 'dark';
  const ink = inkDark ? '#f7f3e8' : p.ink;
  const halo = inkDark ? alpha('#0c1020', 0.55) : alpha('#ffffff', 0.75);

  // 文字の下に、輪郭のないやわらかい影を敷いて読みやすくする。
  // 四角い帯だと境目が見えてしまうので、外へ向かって消える楕円にする。
  const band = (x: number, y: number, bw: number, bh: number) => {
    const cx = x + bw / 2;
    const cy = y + bh / 2;
    const radius = Math.max(bw, bh) / 2;
    const shade = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
    const base = inkDark ? '0,0,0' : '255,255,255';
    shade.addColorStop(0, `rgba(${base},${inkDark ? 0.42 : 0.5})`);
    shade.addColorStop(0.65, `rgba(${base},${inkDark ? 0.22 : 0.26})`);
    shade.addColorStop(1, `rgba(${base},0)`);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(bw / (radius * 2), bh / (radius * 2));
    ctx.translate(-cx, -cy);
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  if (vertical) {
    const perLine = input.title.length > 10 ? Math.ceil(input.title.length / 2) : input.title.length;
    const lines = wrapVertical(input.title, Math.min(perLine, 12));
    const size = Math.min(
      w * (lines.length > 1 ? 0.13 : 0.155),
      (h * 0.62) / Math.max(...lines.map((l) => l.length), 1)
    );
    const gap = size * 1.5;
    const rightX = layout === 1 ? w * 0.5 + ((lines.length - 1) * gap) / 2 : w * 0.82;
    const top = h * 0.09;
    band(rightX - lines.length * gap, top - size * 0.5, lines.length * gap + size, size * 0.9 + Math.max(...lines.map((l) => l.length)) * size * 1.06);
    lines.forEach((line, i) => {
      drawVerticalLine(ctx, line, rightX - i * gap, top, {
        size,
        color: ink,
        halo,
        haloWidth: size * 0.16,
      });
    });

    if (input.subtitle) {
      const subSize = size * 0.36;
      drawVerticalLine(ctx, input.subtitle.slice(0, 24), rightX - lines.length * gap - subSize * 0.4, top + size * 0.4, {
        size: subSize,
        color: ink,
        halo,
        weight: 'normal',
      });
    }
    if (input.author) {
      const aSize = Math.min(w * 0.06, h * 0.045);
      const authorLines = wrapVertical(input.author, 14);
      authorLines.forEach((line, i) => {
        drawVerticalLine(ctx, line, w * 0.14 + i * aSize * 1.5, h * 0.62, {
          size: aSize,
          color: ink,
          halo,
          weight: 'normal',
        });
      });
    }
  } else {
    const size0 = w * (input.title.length > 24 ? 0.075 : 0.11);
    let size = size0;
    let lines: string[] = [];
    for (; size > w * 0.04; size -= 2) {
      ctx.font = `bold ${size}px ${MINCHO}`;
      lines = wrapText(ctx, input.title, w * 0.78);
      if (lines.length <= 3) break;
    }
    const lineHeight = size * 1.28;
    const startY = (layout === 2 ? h * 0.72 : h * 0.3) - ((lines.length - 1) * lineHeight) / 2;
    band(w * 0.06, startY - size, w * 0.88, lines.length * lineHeight + size * 1.4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px ${MINCHO}`;
    lines.forEach((line, i) => {
      drawGlyph(ctx, line, w / 2, startY + i * lineHeight, {
        size,
        color: ink,
        halo,
        haloWidth: size * 0.18,
      });
    });
    if (input.subtitle) {
      ctx.font = `normal ${size * 0.34}px ${GOTHIC}`;
      drawGlyph(ctx, input.subtitle, w / 2, startY + lines.length * lineHeight + size * 0.2, {
        size: size * 0.34,
        color: ink,
        halo,
      });
    }
    if (input.author) {
      ctx.font = `normal ${w * 0.045}px ${MINCHO}`;
      drawGlyph(ctx, input.author, w / 2, h * 0.9, {
        size: w * 0.045,
        color: ink,
        halo,
      });
    }
  }
}

export interface ChapterArtInput {
  title: string;
  profile: SceneProfile;
  /** 章題を絵の中に入れる。 */
  withTitle?: boolean;
  variation?: number;
}

export function drawChapterArt(canvas: HTMLCanvasElement, input: ChapterArtInput) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paintScene(ctx, w, h, input.profile, (input.variation ?? 0) + 3);
  if (!input.withTitle || !input.title) return;

  const p = paletteFor(input.profile);
  const dark = input.profile.time === 'night' || input.profile.mood === 'dark';
  const size = Math.min(h * 0.12, w * 0.06);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.filter = 'blur(16px)';
  ctx.fillStyle = dark ? '#000000' : p.paper;
  ctx.fillRect(w * 0.06, h * 0.74, w * 0.88, size * 2.2);
  ctx.restore();
  ctx.font = `bold ${size}px ${MINCHO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawGlyph(ctx, input.title.slice(0, 28), w / 2, h * 0.82, {
    size,
    color: dark ? '#f7f3e8' : p.ink,
    halo: dark ? alpha('#0c1020', 0.6) : alpha('#ffffff', 0.8),
  });
}

// ---------------------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------------------

export interface RenderedImage {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  dataUrl: string;
}

async function toBytes(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<RenderedImage> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), mime, quality);
  });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL(mime, quality),
  };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** KDPが推奨する表紙の大きさ（縦横比 1:1.6）。 */
export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 2560;

export async function renderCover(input: CoverInput, width = COVER_WIDTH, height = COVER_HEIGHT) {
  const canvas = makeCanvas(width, height);
  drawCover(canvas, input);
  return toBytes(canvas, 'image/jpeg', 0.92);
}

export async function renderChapterArt(input: ChapterArtInput, width = 1400, height = 800) {
  const canvas = makeCanvas(width, height);
  drawChapterArt(canvas, input);
  return toBytes(canvas, 'image/jpeg', 0.88);
}
