/*
 * What Vocabloom keeps on a student's device besides their answers and the review deck:
 * the worksheets they opened recently (a title and a link each), so the app can offer them again
 * when it is opened from the home screen. Everything stays in this browser's local storage.
 */

const RECENT_KEY = 'vocabloom-recent1';
const RECENT_MAX = 8;
const RECENT_MAX_LINK_CHARS = 20000;
const LOCAL_KEY_PREFIX = 'vocabloom';   // student answers (vocabloom3:...), the deck and the recent list

/** Only worksheet links are ever kept or used as a link target: no other kind of address can get in. */
const WORKSHEET_LINK = /^#(?:[sj]=[\w-]+|w=[A-Za-z0-9_-]{12})$/;

/** Newest first, one entry per link, at most RECENT_MAX. Returns a new list. */
function addRecent(list, title, link, now) {
  if (!WORKSHEET_LINK.test(link) || link.length > RECENT_MAX_LINK_CHARS) return list.slice();
  const entry = { title: String(title || 'Worksheet').slice(0, 120), link, at: now };
  return [entry].concat(list.filter(known => known.link !== link)).slice(0, RECENT_MAX);
}

function cleanRecent(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(entry => entry && typeof entry.link === 'string' && WORKSHEET_LINK.test(entry.link) && entry.link.length <= RECENT_MAX_LINK_CHARS)
    .map(entry => ({ title: String(entry.title || 'Worksheet').slice(0, 120), link: entry.link, at: Number.isFinite(entry.at) ? entry.at : 0 }))
    .slice(0, RECENT_MAX);
}

function loadRecent(storage) {
  try { return cleanRecent(JSON.parse((storage || localStorage).getItem(RECENT_KEY) || '[]')); } catch (error) { return []; }
}

function rememberRecent(title, link, now, storage) {
  try { (storage || localStorage).setItem(RECENT_KEY, JSON.stringify(addRecent(loadRecent(storage), title, link, now))); } catch (error) { /* storage full or blocked */ }
}

/** "Clear everything on this device": answers, deck and recent list. Returns how many items were removed. */
function clearLocalData(storage) {
  storage = storage || localStorage;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.indexOf(LOCAL_KEY_PREFIX) === 0) keys.push(key);
    }
    keys.forEach(key => storage.removeItem(key));
  } catch (error) { /* storage blocked: nothing was kept */ }
  return keys.length;
}

/** "Opened today", "Opened yesterday", "Opened 3 days ago". */
function openedText(at, now) {
  if (!at) return '';
  const days = dayNumber(new Date(now)) - dayNumber(new Date(at));
  if (days < 0) return '';
  if (days === 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  return 'Opened ' + days + ' days ago';
}
