/* Text matching and small deterministic helpers. No DOM here. */

/** Lower-case, no accents, only letters and digits: "Café!" and "cafe" are the same answer. */
const norm = value => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]/gu, '');

/** "color|colour" -> ["color", "colour"]: alternatives accepted for one answer. */
const alts = value => String(value || '').split('|').map(part => part.trim()).filter(Boolean);

/** FNV-1a: a small, stable hash used for storage keys and shuffle seeds (not for security). */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded random numbers (mulberry32), so every student sees the same shuffle for a worksheet. */
function seededRandom(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'worksheet';
