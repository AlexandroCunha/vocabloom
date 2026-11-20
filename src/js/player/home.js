/*
 * The student's home page (#review): the review deck, the worksheets opened lately, and a button that
 * clears everything Vocabloom keeps on this device. It is what opens when the app is started from the
 * home screen, and it works offline.
 */

const FORGET_LABEL = 'Clear everything on this device';

function recentListHtml(list, now) {
  if (!list.length) return '<p class="sub">Worksheets you open will appear here, so you can find them again.</p>';
  return list.map(entry => '<a class="recent" href="' + esc(entry.link) + '"><span>' + esc(entry.title) + '</span><small>' + esc(openedText(entry.at, now)) + '</small></a>').join('');
}

function homeHtml(now) {
  return '<div class="hero"><div class="brand-mini">' + LOGO + '<span>Vocabloom</span></div><h1>Welcome back</h1></div>'
    + '<div class="pl home-top"><div id="deck"></div>'
    + '<h3>Your worksheets</h3>' + recentListHtml(loadRecent(), now)
    + '<div class="actions"><button class="ghost" data-act="forget">' + FORGET_LABEL + '</button></div>'
    + '<p class="sub" style="text-align:center">Your answers, your review deck and this list are saved only on this device.</p>'
    + '<p class="foot"><a href="./">Teacher? Create a worksheet</a> &middot; <a href="privacy.html">Privacy</a></p></div>';
}

function renderHome(root) {
  const speaker = sharedSpeaker();
  speaker.stop();
  const speak = speaker.supported ? (text, button) => speaker.speak(text, button) : null;
  document.title = 'Vocabloom';
  let deckPanel = null;
  let forgetArmedAt = 0;

  function draw() {
    root.innerHTML = homeHtml(Date.now());
    deckPanel = createDeckPanel({ root, panel: '#deck', speak });
    deckPanel.render();
  }

  function forget(button) {
    if (Date.now() - forgetArmedAt < CLEAR_CONFIRM_MS) {
      forgetArmedAt = 0;
      clearLocalData();
      draw();
      toast('Cleared');
      return;
    }
    forgetArmedAt = Date.now();
    button.textContent = 'Tap again to clear';
    setTimeout(() => { if (button.isConnected) button.textContent = FORGET_LABEL; }, CLEAR_CONFIRM_MS);
  }

  root.onclick = event => {
    const button = event.target.closest('[data-act]');
    if (!button || !root.contains(button)) return;
    if (deckPanel.handleAction(button.dataset.act, button)) return;
    if (button.dataset.act === 'forget') forget(button);
  };
  root.oninput = null;
  root.onchange = event => { deckPanel.handleChange(event.target); };
  root.onkeydown = event => {
    if (moveBetweenOptions(event)) { event.preventDefault(); return; }
    if (event.key === 'Enter' && event.target.tagName === 'INPUT' && deckPanel.handleEnter(event.target)) event.preventDefault();
  };
  draw();
}
