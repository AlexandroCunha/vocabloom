/*
 * QR code generator, written for Vocabloom (no libraries).
 * Byte mode, error correction level M, versions 1 to 10: enough for a link of up to 213 characters.
 * Pure functions: qrMatrix(text) gives a square list of rows (true = dark module), qrSvg(matrix) draws it.
 * Layout and numbers follow ISO/IEC 18004; the tests check it against a known Reed-Solomon vector,
 * and the output was decoded with an independent QR reader.
 */

const QR_MAX_VERSION = 10;
const QR_ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];  // level M, versions 1..10
const QR_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const QR_ALIGNMENT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const QR_FORMAT_LEVEL_M = 0;      // the two format bits that mean "level M"
const QR_DARK = '#0B1D24';

/* ---------- Reed-Solomon error correction over GF(256) ---------- */

const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function fillGaloisTables() {
  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMultiply = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

/** The generator polynomial of the given degree: (x - a^0)(x - a^1)... with the leading 1 first. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((coefficient, j) => {
      next[j] ^= coefficient;
      next[j + 1] ^= gfMultiply(coefficient, GF_EXP[i]);
    });
    poly = next;
  }
  return poly;
}

/** The `ecLength` error correction codewords for a block of data codewords. */
function rsRemainder(data, ecLength) {
  const generator = rsGenerator(ecLength);
  const work = data.concat(new Array(ecLength).fill(0));
  for (let i = 0; i < data.length; i++) {
    const factor = work[i];
    if (!factor) continue;
    for (let j = 1; j < generator.length; j++) work[i + j] ^= gfMultiply(generator[j], factor);
  }
  return work.slice(data.length);
}

/* ---------- sizes ---------- */

/** Bits that can hold data or error correction in a version (everything except the fixed patterns). */
function qrRawModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

const qrDataCodewords = version => Math.floor(qrRawModules(version) / 8) - QR_ECC_PER_BLOCK[version - 1] * QR_BLOCKS[version - 1];
const qrCountBits = version => (version < 10 ? 8 : 16);

function qrVersionFor(byteLength) {
  for (let version = 1; version <= QR_MAX_VERSION; version++) {
    if (4 + qrCountBits(version) + 8 * byteLength <= qrDataCodewords(version) * 8) return version;
  }
  throw new Error('Too long for a QR code');
}

/* ---------- data codewords ---------- */

function qrDataBits(bytes, version) {
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);                       // byte mode
  push(bytes.length, qrCountBits(version));
  bytes.forEach(byte => push(byte, 8));
  const capacity = qrDataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));   // terminator
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xEC; codewords.length < qrDataCodewords(version); pad ^= 0xEC ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Splits the data into blocks, adds error correction to each, and interleaves them. */
function qrInterleave(data, version) {
  const blockCount = QR_BLOCKS[version - 1];
  const ecLength = QR_ECC_PER_BLOCK[version - 1];
  const rawCodewords = Math.floor(qrRawModules(version) / 8);
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortLength = Math.floor(rawCodewords / blockCount);
  const dataBlocks = [];
  let start = 0;
  for (let i = 0; i < blockCount; i++) {
    const length = shortLength - ecLength + (i < shortBlocks ? 0 : 1);
    dataBlocks.push(data.slice(start, start + length));
    start += length;
  }
  const ecBlocks = dataBlocks.map(block => rsRemainder(block, ecLength));
  const out = [];
  for (let i = 0; i < shortLength - ecLength + 1; i++) dataBlocks.forEach(block => { if (i < block.length) out.push(block[i]); });
  for (let i = 0; i < ecLength; i++) ecBlocks.forEach(block => out.push(block[i]));
  return out;
}

/* ---------- the grid ---------- */

const bitOf = (value, index) => (value >>> index) & 1;

const QR_MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
];

function qrGrid(version, codewords) {
  const size = 17 + 4 * version;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, value) => { dark[y][x] = !!value; fixed[y][x] = true; };

  // Timing lines, finder patterns (with their white borders) and alignment patterns.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  });
  const places = QR_ALIGNMENT[version - 1];
  places.forEach((cy, i) => places.forEach((cx, j) => {
    const onFinder = (i === 0 && j === 0) || (i === 0 && j === places.length - 1) || (i === places.length - 1 && j === 0);
    if (onFinder) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  // Version information (versions 7 and up).
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1F25);
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bitOf(bits, i));
      set(b, a, bitOf(bits, i));
    }
  }

  /** Writes the 15 format bits (error level + mask), twice, and the always-dark module. */
  function drawFormat(mask) {
    const data = (QR_FORMAT_LEVEL_M << 3) | mask;
    let rest = data;
    for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
    const bits = ((data << 10) | rest) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bitOf(bits, i));
    set(8, 7, bitOf(bits, 6));
    set(8, 8, bitOf(bits, 7));
    set(7, 8, bitOf(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bitOf(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitOf(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitOf(bits, i));
    set(8, size - 8, true);
  }
  drawFormat(0);   // reserves the format areas so the data skips them

  // Data bits, in the zigzag order of the standard.
  let bit = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let side = 0; side < 2; side++) {
        const x = right - side;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (!fixed[y][x] && bit < totalBits) {
          dark[y][x] = bitOf(codewords[bit >>> 3], 7 - (bit & 7)) === 1;
          bit++;
        }
      }
    }
  }

  const applyMask = mask => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && QR_MASKS[mask](x, y)) dark[y][x] = !dark[y][x];
  };

  // Try all eight masks and keep the one the standard scores best (fewest hard-to-scan patterns).
  let best = { mask: 0, penalty: Infinity };
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const penalty = qrPenalty(dark);
    if (penalty < best.penalty) best = { mask, penalty };
    applyMask(mask);
  }
  applyMask(best.mask);
  drawFormat(best.mask);
  return dark;
}

/** The standard's four penalty rules: long runs, 2x2 blocks, finder-like patterns, and dark/light balance. */
function qrPenalty(grid) {
  const size = grid.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(grid[i].slice());
    lines.push(grid.map(row => row[i]));
  }
  lines.forEach(line => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    // 1:1:3:1:1 with four light modules on one side (looks like a finder pattern).
    for (let i = 0; i + 11 <= size; i++) {
      const pattern = line.slice(i, i + 11).map(Number).join('');
      if (pattern === '10111010000' || pattern === '00001011101') score += 40;
    }
  });
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const colour = grid[y][x];
      if (grid[y][x + 1] === colour && grid[y + 1][x] === colour && grid[y + 1][x + 1] === colour) score += 3;
    }
  }
  const darkCount = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  score += (Math.ceil(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) - 1) * 10;
  return score;
}

/** The QR code for a text, as rows of booleans. Throws when the text is too long for versions 1 to 10. */
function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = qrVersionFor(bytes.length);
  return qrGrid(version, qrInterleave(qrDataBits(bytes, version), version));
}

/* ---------- drawing ---------- */

const QR_QUIET_ZONE = 4;   // the standard asks for four light modules all around

/** A self-contained SVG: dark modules as one path, on a white square. */
function qrSvg(matrix) {
  const size = matrix.length;
  const total = size + QR_QUIET_ZONE * 2;
  let path = '';
  matrix.forEach((row, y) => {
    for (let x = 0; x < size;) {
      if (!row[x]) { x++; continue; }
      let end = x;
      while (end < size && row[end]) end++;
      path += 'M' + (x + QR_QUIET_ZONE) + ' ' + (y + QR_QUIET_ZONE) + 'h' + (end - x) + 'v1h-' + (end - x) + 'z';
      x = end;
    }
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" aria-label="QR code">'
    + '<rect width="' + total + '" height="' + total + '" fill="#fff"/><path d="' + path + '" fill="' + QR_DARK + '"/></svg>';
}

/** Draws the code on a canvas (white background, quiet zone included) at roughly `pixels` wide. */
function qrDrawCanvas(canvas, matrix, pixels) {
  const total = matrix.length + QR_QUIET_ZONE * 2;
  const scale = Math.max(1, Math.ceil(pixels / total));
  canvas.width = canvas.height = total * scale;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = QR_DARK;
  matrix.forEach((row, y) => row.forEach((on, x) => {
    if (on) context.fillRect((x + QR_QUIET_ZONE) * scale, (y + QR_QUIET_ZONE) * scale, scale, scale);
  }));
}
