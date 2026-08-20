/**
 * 「語り部」のアプリアイコン（PNG）を作る。
 *
 * 画像ライブラリを足さずに済むよう、favicon.svg と同じ図形を
 * ここで直接ラスタライズして PNG を書き出している。
 * 図形は「本」と、そこから広がる「声の弧」。
 *
 *   node scripts/make-voice-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'voice');

const PAPER = [0xf6, 0xf3, 0xec];
const PURPLE = [0x7a, 0x4a, 0x86];
const PURPLE_DEEP = [0x5d, 0x36, 0x67];

/* --- 図形（64 × 64 の座標系。favicon.svg と同じ） --- */

const BOOK = { x: 12, y: 12, w: 19, h: 40, r: 2 };
/** 声の弧の中心 */
const HUB = { x: 31, y: 32 };
/** [半径, 太さ] */
const ARCS = [
  [11, 3.2],
  [17, 2.7],
  [23, 2.2],
];
/** 本の上に置く白い行 */
const RULES = [
  { y: 19, w: 11 },
  { y: 24.5, w: 11 },
  { y: 30, w: 7.5 },
];

function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/**
 * 1点の色を決める。境目のギザギザを抑えるため、1画素を4×4で見て平均する。
 */
function sample(px, py) {
  // 本
  if (insideRoundedRect(px, py, BOOK)) {
    for (const rule of RULES) {
      if (
        px >= BOOK.x + 3 &&
        px <= BOOK.x + 3 + rule.w &&
        py >= rule.y &&
        py <= rule.y + 1.6
      ) {
        return PAPER;
      }
    }
    // 背の側を少し濃くして厚みを出す
    return px < BOOK.x + 3.5 ? PURPLE_DEEP : PURPLE;
  }

  // 声の弧（本の右側にだけ描く）
  if (px > HUB.x + 1) {
    const d = Math.hypot(px - HUB.x, py - HUB.y);
    for (const [radius, width] of ARCS) {
      if (Math.abs(d - radius) <= width / 2) {
        // 弧は上下に開きすぎないように、角度でも切る
        const angle = Math.abs(Math.atan2(py - HUB.y, px - HUB.x));
        if (angle < Math.PI / 2.6) return PURPLE;
      }
    }
  }

  return PAPER;
}

function render(size, { bleed = 1 } = {}) {
  const pixels = Buffer.alloc(size * size * 3);
  const scale = 64 / size;
  const sub = [0.125, 0.375, 0.625, 0.875];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const dy of sub) {
        for (const dx of sub) {
          /*
           * maskable のアイコンは四隅が切り落とされるので、図形を内側に寄せる
           * （bleed が大きいほど図形が小さくなる）。
           */
          const u = ((x + dx) * scale - 32) / bleed + 32;
          const v = ((y + dy) * scale - 32) / bleed + 32;
          const [pr, pg, pb] = sample(u, v);
          r += pr;
          g += pg;
          b += pb;
        }
      }
      const n = sub.length * sub.length;
      const at = (y * size + x) * 3;
      pixels[at] = Math.round(r / n);
      pixels[at + 1] = Math.round(g / n);
      pixels[at + 2] = Math.round(b / n);
    }
  }
  return pixels;
}

/* --- PNG に書き出す --- */

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const head = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head) >>> 0);
  return Buffer.concat([length, head, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 1色8ビット
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // フィルタなし
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  // maskable は四隅が切られるので、図形を8割ほどに寄せる
  ['icon-512-maskable.png', 512, 1.35],
  ['apple-touch-icon.png', 180, 1],
];

for (const [name, size, bleed] of targets) {
  writeFileSync(join(OUT, name), png(size, render(size, { bleed })));
  console.log(`${name} (${size}px)`);
}
