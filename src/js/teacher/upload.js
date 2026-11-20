/* Teacher step 1: choose a PDF, type the school access code, convert. */

const MAX_PDF_BYTES = 3.1 * 1024 * 1024;
const LOADING_MESSAGES = ['Reading your PDF...', 'Finding the exercises...', 'Working out the answers...', 'Almost there...'];
const ACCESS_CODE_KEY = 'vb-code';

/* The access code is kept for this browser tab only (session storage), never in local storage. */
function rememberedAccessCode() {
  try { return sessionStorage.getItem(ACCESS_CODE_KEY) || ''; } catch (error) { return ''; }
}
function rememberAccessCode(code) {
  try { sessionStorage.setItem(ACCESS_CODE_KEY, code); } catch (error) { /* private mode: nothing to remember */ }
}

/* Wording that fits the device: "Tap" on a phone, "Click" and "drop it here" where there is a mouse (see .touch-only and .mouse-only). */
const TAP_OR_CLICK = '<span class="touch-only">tap</span><span class="mouse-only">click</span>';
const DROP_BOX_TEXT = '<span class="ic">&#8593;</span><span class="touch-only">Tap</span><span class="mouse-only">Click</span> to choose a PDF<br>'
  + '<small><span class="mouse-only">or drop it here &middot; </span>up to about 3 MB</small>';

function uploadStepHtml() {
  return '<section class="panel up"><div class="up-intro"><h2>Upload a PDF</h2><p class="lead">Any worksheet: vocabulary, grammar, reading, true/false, matching&hellip; The AI finds the exercises and turns them into questions students can answer on a phone.</p>'
    + '<p class="sub">Privacy: the PDF is sent to an AI service to be converted. Please do not upload files that contain students&rsquo; personal data. <a href="privacy.html" target="_blank" rel="noopener">Privacy notice</a></p></div>'
    + '<div class="up-form"><label class="drop" id="drop"><input type="file" id="file" accept="application/pdf,.pdf"><span id="dropt">' + DROP_BOX_TEXT + '</span></label>'
    + '<label class="f" for="code">School access code</label><input type="password" id="code" autocomplete="current-password" placeholder="Ask your school admin">'
    + '<div class="err" id="err" role="alert" hidden></div>'
    + '<div class="btns"><button id="go" disabled>Convert to interactive page</button></div>'
    + '<div class="btns"><button class="ghost" id="demo">Try the demo worksheet</button></div></div></section>';
}

function showUploadError(message) {
  const box = $('#err');
  box.textContent = message;
  box.hidden = false;
}

/** Returns an error message for a file that cannot be used, or '' when it is fine. */
function problemWithFile(file) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return 'Please choose a PDF file.';
  if (file.size > MAX_PDF_BYTES) {
    return 'This PDF is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is about 3 MB. Compress it (for example with an online PDF compressor) and try again.';
  }
  return '';
}

const fileToBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/** Full-screen "please wait" with rotating messages. Returns a function that removes it. */
function showLoadingOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'load';
  overlay.setAttribute('role', 'status');
  overlay.innerHTML = '<div class="spin"></div><div id="lm" style="font-weight:700;font-size:18px">' + LOADING_MESSAGES[0] + '</div><div style="color:#5f776f;font-size:14px">This usually takes 20&ndash;60 seconds.</div>';
  document.body.appendChild(overlay);
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(step + 1, LOADING_MESSAGES.length - 1);
    $('#lm').textContent = LOADING_MESSAGES[step];
  }, 9000);
  return () => { clearInterval(timer); overlay.remove(); };
}

/**
 * Returns { worksheet, cached }. `cached` is true when the server already had a result for this exact PDF.
 * `fresh` asks for a new conversion instead (it uses AI credit again and replaces the saved result).
 */
async function requestConversion(file, accessCode, fresh) {
  const pdf = await fileToBase64(file);
  const response = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-code': accessCode },
    body: JSON.stringify(fresh ? { pdf, fresh: true } : { pdf })
  });
  let body = {};
  try { body = await response.json(); } catch (error) { /* not JSON: fall through to the generic error */ }
  if (!response.ok) throw new Error(body.error || ('Server error (' + response.status + ')'));
  return { worksheet: normaliseWorksheet(body.worksheet), cached: Boolean(body.cached) };
}

/** "Convert again" in the review step. Errors are shown as a short message, since the upload screen is gone. */
async function convertAgain(session, nav) {
  const hideOverlay = showLoadingOverlay();
  try {
    const result = await requestConversion(session.file, rememberedAccessCode(), true);
    Object.assign(session, { worksheet: result.worksheet, cached: result.cached, shortLink: null });
    nav.go(2);
  } catch (error) {
    toast(error.message || 'Something went wrong. Please try again.');
  } finally {
    hideOverlay();
  }
}

function renderUploadStep(session, nav) {
  $('#stage').innerHTML = uploadStepHtml();
  $('#code').value = rememberedAccessCode();

  function chooseFile(file) {
    $('#err').hidden = true;
    if (!file) return;
    const problem = problemWithFile(file);
    if (problem) { showUploadError(problem); return; }
    session.file = file;
    $('#drop').classList.add('has');
    $('#dropt').innerHTML = '<span class="ic">&#10003;</span>' + esc(file.name) + '<br><small>' + (file.size / 1024).toFixed(0) + ' KB &middot; ' + TAP_OR_CLICK + ' to change</small>';
    $('#go').disabled = false;
  }

  async function convert() {
    if (location.protocol === 'file:') {
      showUploadError('Open the Vocabloom website to convert PDFs. This copy was opened as a plain file.');
      return;
    }
    const code = $('#code').value;
    rememberAccessCode(code);
    const hideOverlay = showLoadingOverlay();
    try {
      const result = await requestConversion(session.file, code);
      Object.assign(session, { worksheet: result.worksheet, cached: result.cached, shortLink: null });
      nav.go(2);
    } catch (error) {
      showUploadError(error.message || 'Something went wrong. Please try again.');
    } finally {
      hideOverlay();
    }
  }

  async function loadDemo() {
    try {
      const response = await fetch('demo.json');
      if (!response.ok) throw new Error('demo missing');
      Object.assign(session, { worksheet: normaliseWorksheet(await response.json()), file: null, cached: false, shortLink: null });
      nav.go(2);
    } catch (error) {
      showUploadError('The demo needs the website to be running (it cannot load from a plain file).');
    }
  }

  $('#file').onchange = event => chooseFile(event.target.files[0]);
  // The whole panel accepts a dropped file, and the box lights up while one is over it.
  const dropZone = $('#drop');
  const panel = $('.up');
  ['dragenter', 'dragover'].forEach(name => panel.addEventListener(name, event => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('over');
  }));
  panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) dropZone.classList.remove('over'); });
  panel.addEventListener('drop', event => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dropZone.classList.remove('over');
    chooseFile(event.dataTransfer.files[0]);
  });
  $('#go').onclick = convert;
  $('#demo').onclick = loadDemo;
}
