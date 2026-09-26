/**
 * 「ヘルメス」のアプリアイコン（PNG）を作る。
 *
 * 画像ライブラリを足さずに済むよう、favicon.svg と同じ図形を
 * ここで直接ラスタライズして PNG を書き出している。
 * 図形は「縦書きの原稿」と、そこに入れた「朱の筆」。
 *
 *   node scripts/make-hermes-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'hermes');

const PAPER = [0xf4, 0xf1, 0xea];
const SHEET = [0xef, 0xe9, 0xdc];
const EDGE = [0xd6, 0xcd, 0xba];
const INK = [0x3a, 0x33, 0x2a];
const VERMILION = [0xc0, 0x45, 0x3b];

/* --- 図形（64 × 64 の座標系。favicon.svg を 8 で割ったもの） --- */

const SHEET_RECT = { x: 11, y: 9, w: 42, h: 46, r: 2 };
/** 紙の縁の太さ */
const EDGE_W = 1;

/** 縦書きの行（右から左へ）。[x, 上端, 高さ] */
const COLUMNS = [
  [44.5, 14.5, 35],
  [38.5, 14.5, 26],
  [32.5, 14.5, 32],
  [26.5, 14.5, 19],
  [20.5, 14.5, 29],
  [14.5, 14.5, 13],
];
const COL_W = 2;

/** 朱の筆（折れ線）。[x, y] の並びと太さ */
const STROKE = [
  [26.5, 37.5],
  [31.5, 43],
  [43, 28.5],
];
const STROKE_W = 3.25;

function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** 点と線分の距離（朱の筆を、丸い筆先の折れ線として描くため）。 */
function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** 1点の色を決める。手前にあるものから順に見る。 */
function sample(px, py) {
  // 朱の筆（いちばん手前）
  for (let i = 0; i + 1 < STROKE.length; i++) {
    if (distanceToSegment(px, py, STROKE[i], STROKE[i + 1]) <= STROKE_W / 2) {
      return VERMILION;
    }
  }

  if (!insideRoundedRect(px, py, SHEET_RECT)) return PAPER;

  // 紙の縁
  const inner = {
    x: SHEET_RECT.x + EDGE_W,
    y: SHEET_RECT.y + EDGE_W,
    w: SHEET_RECT.w - EDGE_W * 2,
    h: SHEET_RECT.h - EDGE_W * 2,
    r: Math.max(0, SHEET_RECT.r - EDGE_W),
  };
  if (!insideRoundedRect(px, py, inner)) return EDGE;

  // 行の文字
  for (const [x, top, height] of COLUMNS) {
    if (insideRoundedRect(px, py, { x, y: top, w: COL_W, h: height, r: COL_W / 2 })) {
      return INK;
    }
  }

  return SHEET;
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
