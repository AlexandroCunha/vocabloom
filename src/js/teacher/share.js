/*
 * Teacher step 3: the link to give to students (the end of the flow).
 *   - the normal link carries the whole worksheet inside it, so nothing is stored anywhere;
 *   - optionally, a short link plus a QR code: the worksheet is then kept on the server for a while.
 */

const LONG_LINK_CHARS = 6000;

/** `canShare`: the device has its own share sheet (iPhone, Android, Windows), which is the easiest way to send a link. */
function shareHtml(canShare) {
  return '<section class="panel share"><div class="share-main"><h2>Share with your students</h2><p class="lead">Send them the link. It opens on any phone, no login needed.</p>'
    + '<div class="linkbox"><input type="text" id="lnk" readonly value="Preparing link..." aria-label="Link to share"><button id="cl">Copy</button></div>'
    + '<div class="note warn" id="long" hidden></div>'
    + '<div class="btns">' + (canShare ? '<button class="wide" id="sh">Share&hellip;</button>' : '')
    + '<button class="sec" id="dl">Download as a file</button><button class="ghost" id="op">Open student view</button></div>'
    + '<div id="short"></div>'
    + '<p class="lead" style="margin:0">Paste the link into Google Classroom, WhatsApp or anywhere else. Answers stay on each student\'s phone, so there is nothing for you to collect.</p></div>'
    + '<aside class="share-preview" aria-label="What students see"><p class="sub">What students see</p><div class="phone"><div id="pv"></div></div></aside>'
    + '<div class="nav share-nav"><button class="sec" id="b2">&larr; Edit</button><button class="sec" id="b1">New PDF</button></div></section>';
}

const shortLinkUrl = id => location.origin + location.pathname + '#w=' + id;

/** The link to hand over right now: the short one if it was made for this exact worksheet, otherwise the long one. */
function bestLink(session, longLink) {
  const made = session.shortLink;
  return made && made.key === hash(slimJSON(session.worksheet)) ? shortLinkUrl(made.id) : longLink;
}

/** The device's own share sheet (Messages, WhatsApp, Mail...). Closing it without choosing anything is not an error. */
async function shareWithDevice(title, url) {
  try {
    await navigator.share({ title, url });
  } catch (error) {
    if (!error || error.name !== 'AbortError') copyText(url, 'Copy the link');
  }
}

/* ---------- short link and QR code ---------- */

/** Short links need the server to keep a copy, so they only exist when the school has switched that on. */
async function shortLinksAvailable() {
  if (location.protocol === 'file:') return false;
  try {
    const response = await fetch('/api/share');
    return response.ok && Boolean((await response.json()).available);
  } catch (error) {
    return false;
  }
}

/** Asks the server to keep the worksheet and returns { id, days }. */
async function requestShortLink(worksheet, accessCode) {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-code': accessCode },
    body: '{"worksheet":' + slimJSON(worksheet) + '}'
  });
  let body = {};
  try { body = await response.json(); } catch (error) { /* not JSON: fall through to the generic error */ }
  if (!response.ok) throw new Error(body.error || ('Server error (' + response.status + ')'));
  return body;
}

function shortLinkHtml(needsCode) {
  return '<div class="shortbox"><h3>Short link and QR code</h3>'
    + '<p class="sub">Handy for the classroom screen or a printed sheet. To keep the link short, Vocabloom stores a copy of this worksheet on its server for a limited time. Student answers are never sent there.</p>'
    + (needsCode ? '<label class="f" for="scode">School access code</label><input type="password" id="scode" autocomplete="current-password" placeholder="Ask your school admin">' : '')
    + '<div class="err" id="serr" role="alert" hidden></div>'
    + '<div class="btns"><button id="mk">Create short link and QR code</button></div>'
    + '<div id="made" hidden>'
    + '<div class="qr" id="qr"></div>'
    + '<div class="linkbox"><input type="text" id="slnk" readonly aria-label="Short link"><button id="scopy">Copy</button></div>'
    + '<div class="btns"><button class="sec" id="qbig">Show large</button><button class="sec" id="qpng">Download QR code</button></div>'
    + '<p class="sub" id="sinfo"></p></div></div>';
}

/** Full-screen QR code, for a classroom projector. */
function showQrLarge(matrix, link) {
  const overlay = document.createElement('div');
  overlay.className = 'ov';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'QR code');
  overlay.innerHTML = '<div class="box qrbig"><div class="qr">' + qrSvg(matrix) + '</div><p class="qrlink">' + esc(link) + '</p><div class="nav"><button class="sec" id="qclose">Close</button></div></div>';
  const close = showOverlay(overlay);
  $('#qclose', overlay).onclick = close;
  $('#qclose', overlay).focus();
}

function downloadQrPng(matrix, name) {
  const canvas = document.createElement('canvas');
  qrDrawCanvas(canvas, matrix, 1024);
  canvas.toBlob(blob => {
    if (blob) { downloadBlob(name, blob); toast('Downloaded'); } else toast('Could not make the image');
  }, 'image/png');
}

/** Wires up the short-link box. `session.shortLink` remembers the link made for this exact worksheet. */
function setUpShortLink(session, box) {
  const worksheet = session.worksheet;
  const worksheetKey = hash(slimJSON(worksheet));
  const needsCode = !rememberedAccessCode();
  box.innerHTML = shortLinkHtml(needsCode);

  function showResult(result) {
    const link = shortLinkUrl(result.id);
    const matrix = qrMatrix(link);
    $('#qr').innerHTML = qrSvg(matrix);
    $('#slnk').value = link;
    $('#sinfo').textContent = 'Students who open this link load the worksheet from Vocabloom, and their answers still stay on their own phones. The link stops working after ' + result.days + ' days.';
    $('#made').hidden = false;
    $('#scopy').onclick = () => copyText(link, 'Copy the link');
    $('#qbig').onclick = () => showQrLarge(matrix, link);
    $('#qpng').onclick = () => downloadQrPng(matrix, slug(worksheet.title) + '-qr.png');
  }

  async function create() {
    $('#serr').hidden = true;
    const typed = needsCode ? $('#scode').value : '';
    if (typed) rememberAccessCode(typed);
    const button = $('#mk');
    button.disabled = true;
    try {
      const result = await requestShortLink(worksheet, rememberedAccessCode());
      session.shortLink = { key: worksheetKey, id: result.id, days: result.days };
      showResult(session.shortLink);
      button.textContent = 'Create a new short link';
    } catch (error) {
      $('#serr').textContent = error.message || 'Something went wrong. Please try again.';
      $('#serr').hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  $('#mk').onclick = create;
  if (session.shortLink && session.shortLink.key === worksheetKey) {
    showResult(session.shortLink);
    $('#mk').textContent = 'Create a new short link';
  }
}

/* ---------- the step itself ---------- */

async function renderShareStep(session, nav) {
  const worksheet = session.worksheet;
  const thisRender = session.shareRender = (session.shareRender || 0) + 1;
  const canShare = typeof navigator.share === 'function';
  $('#stage').innerHTML = shareHtml(canShare);
  renderPlayer($('#pv'), worksheet, { persist: false });

  $('#b1').onclick = () => { session.worksheet = null; session.file = null; session.shortLink = null; nav.go(1); };
  $('#b2').onclick = () => nav.go(2);
  $('#dl').onclick = () => { downloadTextFile(slug(worksheet.title) + '.html', buildStandalonePage(worksheet)); toast('Downloaded'); };

  let link = '';
  try {
    link = location.origin + location.pathname + '#' + await pack(worksheet);
    $('#lnk').value = link;
  } catch (error) {
    $('#lnk').value = 'Could not create a link. Use Download instead.';
  }
  $('#cl').onclick = () => { if (link) copyText(link, 'Copy the link'); };
  $('#op').onclick = () => { if (link) window.open(link, '_blank', 'noopener'); };
  if (canShare) $('#sh').onclick = () => { if (link) shareWithDevice(worksheet.title, bestLink(session, link)); };

  const canShorten = await shortLinksAvailable();
  if (thisRender !== session.shareRender || !$('#short')) return;   // the teacher already moved on
  if (canShorten) setUpShortLink(session, $('#short'));
  if (link.length >= LONG_LINK_CHARS) {
    const note = $('#long');
    note.innerHTML = 'This link is very long. WhatsApp and some apps may cut it. '
      + (canShorten ? 'Create a short link below, or use <b>Download</b> and send the file instead.' : 'Use <b>Download</b> and send the file instead.');
    note.hidden = false;
  }
}
