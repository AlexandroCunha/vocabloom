/*
 * Vocabloom: PDF -> interactive worksheet. One page that shows a different view depending on its address:
 *
 *   a downloaded .html file   the worksheet that was saved inside it
 *   #review                   the student's home: review deck and recently opened worksheets
 *   #s=... or #j=...          a worksheet carried inside the link
 *   #w=...                    a short link: the worksheet is fetched from the server
 *   anything else             the teacher's tool: upload, review, share
 */

const SHORT_ID = /^[A-Za-z0-9_-]{12}$/;

/** What a student sees when a link cannot be opened: [title, explanation]. */
const LINK_PROBLEMS = {
  incomplete: ['This link does not work', 'It looks incomplete. Ask your teacher to send it again.'],
  expired: ['This link has expired', 'Ask your teacher to send you a new link.'],
  busy: ['Please wait a moment', 'Too many worksheets are being opened right now. Try again in a minute.'],
  offline: ['You are offline', 'This worksheet has not been opened on this phone yet. Connect to the internet and open the link once. After that it works offline.'],
  unavailable: ['Could not open the worksheet', 'Check your connection and try again.']
};

class LinkProblem extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function readEmbeddedWorksheet() {
  try {
    const embedded = JSON.parse($('#ws-data').textContent);
    return embedded && embedded.sections ? embedded : null;
  } catch (error) {
    return null;
  }
}

/** Fetches the worksheet behind a short link. A worksheet opened before is also served offline (see sw.js). */
async function fetchShortLink(id) {
  let response;
  try {
    response = await fetch('/api/share?id=' + encodeURIComponent(id));
  } catch (error) {
    throw new LinkProblem(navigator.onLine === false ? 'offline' : 'unavailable');
  }
  if (response.status === 404) throw new LinkProblem('expired');
  if (response.status === 429) throw new LinkProblem('busy');
  let body = null;
  try { body = await response.json(); } catch (error) { /* not JSON */ }
  if (!response.ok || !body || !body.worksheet) throw new LinkProblem('unavailable');
  return body.worksheet;
}

/** The worksheet a link points to. Throws a LinkProblem when it cannot be opened. */
async function worksheetFromHash(hash) {
  if (/^#w=/.test(hash)) {
    const id = hash.slice(3);
    if (!SHORT_ID.test(id)) throw new LinkProblem('incomplete');
    return fetchShortLink(id);
  }
  let worksheet = null;
  try { worksheet = await unpack(hash); } catch (error) { /* damaged link */ }
  if (!worksheet || !worksheet.sections) throw new LinkProblem('incomplete');
  return worksheet;
}

function showLinkProblem(kind, retry) {
  const [title, text] = LINK_PROBLEMS[kind] || LINK_PROBLEMS.unavailable;
  $('#app').innerHTML = '<div class="hero"><div class="brand-mini">' + LOGO + '<span>Vocabloom</span></div><h1>' + esc(title) + '</h1></div>'
    + '<div class="pl home-top"><div class="card"><p style="margin:0 0 12px">' + esc(text) + '</p>'
    + '<div class="actions" style="margin:0"><button id="retry">Try again</button></div></div>'
    + '<p class="foot"><a href="#review">My review deck</a></p></div>';
  $('#retry').onclick = retry;
}

function showWorksheet(worksheet, hash) {
  document.title = worksheet.title || 'Worksheet';
  // Only a worksheet opened from a link has a home page to go back to; a downloaded file is the whole app.
  renderPlayer($('#app'), worksheet, { persist: true, home: Boolean(hash) && location.protocol !== 'file:' });
  keepPlace($('#app'), window);   // a turn, a split window or an iPhone Duo opening must not lose the student's place
  if (hash) rememberRecent(worksheet.title, hash, Date.now());
}

let navigation = 0;   // a newer navigation cancels an older one that is still loading

async function route() {
  const ticket = ++navigation;
  const hash = location.hash;
  stopKeepingPlace();
  window.scrollTo(0, 0);
  $('#app').className = '';

  if (hash === '#review') {
    setOfflineMessage('student');
    renderHome($('#app'));
    return;
  }
  if (/^#(?:[sj]=|w=)/.test(hash)) {
    setOfflineMessage('student');
    $('#app').innerHTML = '<div class="wrap"><p class="sub" role="status" style="padding-top:24px">Opening your worksheet&hellip;</p></div>';
    try {
      const worksheet = await worksheetFromHash(hash);
      if (ticket === navigation) showWorksheet(worksheet, hash);
    } catch (error) {
      if (ticket === navigation) showLinkProblem(error.kind || 'unavailable', route);
    }
    return;
  }
  setOfflineMessage('teacher');
  startTeacher();
}

(function start() {
  watchConnection();
  // A file dropped anywhere but on the upload box would make the browser open it and leave the page.
  ['dragover', 'drop'].forEach(name => window.addEventListener(name, event => { if (dragHasFiles(event)) event.preventDefault(); }));
  const embedded = readEmbeddedWorksheet();
  if (embedded) {
    showWorksheet(embedded, '');
    return;
  }
  registerServiceWorker();
  window.addEventListener('hashchange', route);
  route();
})();
