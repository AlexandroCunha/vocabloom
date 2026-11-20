'use strict';
/**
 * Draws the app icons (public/icons/*.png) from the Vocabloom logo. No dependencies.
 *
 *   node scripts/make-icons.js
 *
 * The PNGs are committed, so this only needs to run when the logo or the colours change.
 * Shapes are drawn with 4x4 supersampling for smooth edges, then written as plain RGBA PNG files.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

/* The logo, in a 32 x 32 box (the same shapes as LOGO in src/js/core/ui.js): [x, y, radius, opacity] */
const PETALS = [[16, 8, 6, 1], [24, 14, 6, 0.85], [21, 24, 6, 0.7], [11, 24, 6, 0.85], [8, 14, 6, 1]];
const CENTRE = [16, 16, 5.5];
const WHITE = [255, 255, 255];
const RED = [228, 71, 76];
const GRADIENT = [[0, [63, 149, 171]], [0.5, [31, 119, 144]], [1, [20, 88, 107]]];   // same blues as the page header

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

function backgroundAt(t) {
  const [from, to] = t < 0.5 ? [GRADIENT[0], GRADIENT[1]] : [GRADIENT[1], GRADIENT[2]];
  return mix(from[1], to[1], (t - from[0]) / (to[0] - from[0]));
}

/**
 * One icon. `unit` is the size of one logo unit as a fraction of the icon width.
 * `rounded` draws a rounded square on a transparent background; otherwise the colour fills the whole square
 * (needed for maskable icons, and for iOS, which adds its own rounded corners).
 */
function drawIcon(size, unit, rounded) {
  const SS = 4;
  const scale = unit * size;
  const corner = 0.22 * size;
  const pixels = Buffer.alloc(size * size * 4);

  function insideSquare(x, y) {
    if (!rounded) return true;
    const dx = Math.max(corner - x, x - (size - corner), 0);
    const dy = Math.max(corner - y, y - (size - corner), 0);
    return dx * dx + dy * dy <= corner * corner;
  }

  function colourAt(x, y) {
    let colour = backgroundAt((x + y) / (2 * size));
    const lx = (x - size / 2) / scale + 16;
    const ly = (y - size / 2) / scale + 16;
    PETALS.forEach(([cx, cy, r, opacity]) => {
      if ((lx - cx) ** 2 + (ly - cy) ** 2 <= r * r) colour = mix(colour, WHITE, opacity);
    });
    if ((lx - CENTRE[0]) ** 2 + (ly - CENTRE[1]) ** 2 <= CENTRE[2] ** 2) colour = RED;
    return colour;
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!insideSquare(x, y)) continue;
          const colour = colourAt(x, y);
          r += colour[0]; g += colour[1]; b += colour[2];
          covered += 1;
        }
      }
      const at = (py * size + px) * 4;
      if (covered) {
        pixels[at] = Math.round(r / covered);
        pixels[at + 1] = Math.round(g / covered);
        pixels[at + 2] = Math.round(b / covered);
      }
      pixels[at + 3] = Math.round(255 * covered / (SS * SS));
    }
  }
  return pixels;
}

/* ---------- PNG encoding ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (unused, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;    // bits per channel
  header[9] = 6;    // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);   // each row starts with filter type 0 (none)
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- the icon set ---------- */

const ICONS = [
  { file: 'icon-192.png', size: 192, unit: 0.0265, rounded: true },
  { file: 'icon-512.png', size: 512, unit: 0.0265, rounded: true },
  // Maskable: the logo stays inside the centre 80% circle, which is all that every phone keeps.
  { file: 'icon-maskable-512.png', size: 512, unit: 0.0215, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, unit: 0.0245, rounded: false }
];

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  ICONS.forEach(({ file, size, unit, rounded }) => {
    fs.writeFileSync(path.join(OUT, file), encodePng(size, drawIcon(size, unit, rounded)));
    console.log('Wrote public/icons/' + file);
  });
}

module.exports = { ICONS, drawIcon, encodePng };
