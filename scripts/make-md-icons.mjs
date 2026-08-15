/**
 * 「製本所」のアプリアイコン（PNG）を作る。
 *
 * 画像ライブラリを足さずに済むよう、favicon.svg と同じ図形を
 * ここで直接ラスタライズして PNG を書き出している。
 *
 *   node scripts/make-md-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'md');

const TEAL = [0x1f, 0x5f, 0x6b];
const TEAL_DEEP = [0x16, 0x45, 0x4e];
const PAPER = [0xf7, 0xf3, 0xea];
const PAPER_SHADE = [0xe6, 0xdc, 0xc8];
const GOLD = [0xf0, 0xb4, 0x29];

// --- 図形（64 × 64 の座標系。favicon.svg と同じ） ---------------------------

function cubic(p0, p1, p2, p3, steps = 24) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return points;
}

const LEFT_PAGE = [
  ...cubic([10, 18], [17, 15], [24, 15], [31, 19]),
  [31, 48],
  ...cubic([31, 48], [24, 44], [17, 44], [10, 47]),
];

const RIGHT_PAGE = [
  ...cubic([54, 18], [47, 15], [40, 15], [33, 19]),
  [33, 48],
  ...cubic([33, 48], [40, 44], [47, 44], [54, 47]),
];

function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** 64単位の座標で、その点の色を返す（背景なら null）。 */
function sample(x, y, opts) {
  const { radius, opaqueBackground } = opts;
  const bg = insideRoundedRect(x, y, 64, radius);
  if (!bg && !opaqueBackground) return null;

  // 星（本より手前に描く。favicon.svg と同じ重ね順）
  const dx = x - 46;
  const dy = y - 14;
  if (dx * dx + dy * dy <= 4.5 * 4.5) return GOLD;

  if (inside(LEFT_PAGE, x, y)) return PAPER;
  if (inside(RIGHT_PAGE, x, y)) return PAPER_SHADE;
  // 中央の綴じ目
  if (x >= 31.2 && x <= 32.8 && y >= 18 && y <= 48) return TEAL_DEEP;

  return mix(TEAL, TEAL_DEEP, y / 64);
}

// --- ラスタライズ ------------------------------------------------------------

function render(size, { scale = 1, radius = 14, opaqueBackground = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 3; // 1辺あたりの多重サンプリング数
  const offset = (64 - 64 * scale) / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = ((px + (sx + 0.5) / samples) / size) * 64;
          const v = ((py + (sy + 0.5) / samples) / size) * 64;
          const x = (u - offset) / scale;
          const y = (v - offset) / scale;
          const color = sample(x, y, { radius, opaqueBackground });
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }
      const total = samples * samples;
      const i = (py * size + px) * 4;
      if (a > 0) {
        const hits = a / 255;
        pixels[i] = Math.round(r / hits);
        pixels[i + 1] = Math.round(g / hits);
        pixels[i + 2] = Math.round(b / hits);
        pixels[i + 3] = Math.round(a / total);
      }
    }
  }
  return pixels;
}

// --- PNG ---------------------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // フィルタなし
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, size, options) {
  const png = encodePng(size, render(size, options));
  writeFileSync(join(OUT, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)}KB`);
}

write('icon-192.png', 192, { radius: 14 });
write('icon-512.png', 512, { radius: 14 });
// マスク付き表示では、端が切り取られても図が欠けないよう内側に縮める
write('icon-512-maskable.png', 512, { radius: 64, scale: 0.66, opaqueBackground: true });
write('apple-touch-icon.png', 180, { radius: 64, scale: 0.82, opaqueBackground: true });
