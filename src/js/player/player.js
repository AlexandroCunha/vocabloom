/*
 * The student worksheet: draws it, grades answers as they are given, shows feedback and the score.
 * Usage: renderPlayer(rootElement, worksheet, { persist: true|false, home: true|false })
 *   persist: keep the student's answers on this device;  home: link to the student's home page.
 */

const INSTANT_TYPES = ['choice', 'truefalse', 'match'];   // graded as soon as the student picks
const CONFETTI_COLOURS = ['#B4252A', '#388A9F', '#1B9A5A', '#E4B43A', '#CC3366'];
const RESET_CONFIRM_MS = 3000;

/** One speaker for the whole page, so only one thing is ever read aloud at a time. */
let speakerInstance = null;
const sharedSpeaker = () => speakerInstance || (speakerInstance = createSpeaker(window));

function launchConfetti(container) {
  for (let i = 0; i < 34; i++) {
    const piece = document.createElement('i');
    piece.className = 'cf';
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    piece.style.animationDelay = (Math.random() * 0.6) + 's';
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 3200);
  }
}

function renderPlayer(root, rawWorksheet, options) {
  options = options || {};
  const worksheet = normaliseWorksheet(rawWorksheet);
  const index = buildItemIndex(worksheet);
  const { items, scoredIds } = index;
  const total = scoredIds.length;
  const find = selector => $(selector, root);

  const key = storageKey(worksheet);
  let state = options.persist ? loadStudentState(key) : freshStudentState();
  const save = () => { if (options.persist) saveStudentState(key, state); };

  const speaker = sharedSpeaker();
  const speak = speaker.supported ? (text, button) => speaker.speak(text, button) : null;
  speaker.stop();

  root.innerHTML = playerHtml(worksheet, index, { listen: speaker.supported, home: Boolean(options.home) });

  /* ---------- reading the state of one question ---------- */

  const typeOf = id => items[id].section.type;
  const isRight = id => items[id].scored && isCorrect(typeOf(id), items[id].item, state.values[id]);
  const isAnswered = id => items[id].scored && hasAnswer(typeOf(id), state.values[id]);
  const hintFor = id => items[id].item.hint || firstLetterHint(typeOf(id), items[id].item);
  const mistakeIds = () => scoredIds.filter(id => state.everWrong[id]);
  const sourceOf = id => ({ type: typeOf(id), item: items[id].item, choices: index.matchOptions[items[id].sectionIndex] || [] });

  /** none | ok (right first time) | fix (right after a mistake) | bad | rev (answer was shown) */
  function statusOf(id) {
    if (!items[id].scored) return 'none';
    if (state.revealed[id]) return 'rev';
    const gradedInstantly = INSTANT_TYPES.includes(typeOf(id));
    if (!gradedInstantly && !state.checked[id]) return 'none';
    if (!isAnswered(id)) return 'none';
    if (!isRight(id)) return 'bad';
    return state.everWrong[id] ? 'fix' : 'ok';
  }

  /** The first time a question goes wrong it becomes a mistake (and joins the review deck, if the student keeps one). */
  function markMistake(id) {
    if (state.everWrong[id]) return;
    state.everWrong[id] = true;
    deckPanel.noteMistake(sourceOf(id));
  }

  /** Counts a wrong answer once, however many times the student presses Check on it. */
  function recordAttempt(id) {
    if (!isAnswered(id) || isRight(id)) return;
    const snapshot = JSON.stringify(state.values[id]);
    if (state.lastWrongAnswer[id] === snapshot) return;
    state.lastWrongAnswer[id] = snapshot;
    state.wrongAttempts[id] = (state.wrongAttempts[id] || 0) + 1;
    markMistake(id);
  }

  /* ---------- feedback on one question ---------- */

  function paintOptions(card, id, status) {
    const chosen = state.values[id];
    card.querySelectorAll('.opt').forEach(button => {
      button.className = 'opt';
      if (chosen !== undefined && button.dataset.v === chosen && status !== 'none') button.classList.add(status === 'bad' ? 'bad' : 'ok');
    });
  }

  function feedbackHtml(id, status) {
    const item = items[id].item;
    switch (status) {
      case 'ok': return 'Correct, well done!';
      case 'fix': return 'Corrected! You got this wrong at first, then fixed it.' + tipHtml('📘', item.explanation);
      case 'rev': return 'Answer: <b>' + esc(answerText(typeOf(id), item)) + '</b>' + tipHtml('📘', item.explanation);
      case 'bad': return 'Not quite. Have another go.' + tipHtml('💡', hintFor(id)) + ((state.wrongAttempts[id] || 0) >= 2 ? tipHtml('📘', item.explanation) : '');
      default: return '';
    }
  }

  function paint(id) {
    const card = find('#w-' + id);
    const message = find('#m-' + id);
    if (!card || !message) return;
    const status = statusOf(id);
    const type = typeOf(id);
    card.className = 'card' + (status === 'none' ? '' : ' ' + status);
    message.className = 'msg' + (status === 'none' ? '' : ' ' + status);
    message.innerHTML = feedbackHtml(id, status);
    if (type === 'choice' || type === 'truefalse') paintOptions(card, id, status);
    if (type === 'match' && state.values[id] !== undefined) card.querySelector('select').value = state.values[id];
  }

  function updateWordBanks() {
    worksheet.sections.forEach((section, sectionIndex) => {
      if (!section.wordBank.length) return;
      const used = new Set();
      root.querySelectorAll('#sec-' + sectionIndex + ' [data-id][data-k]').forEach(field => used.add(norm(field.value)));
      root.querySelectorAll('#sec-' + sectionIndex + ' .chip').forEach(chip => chip.classList.toggle('used', used.has(chip.dataset.w)));
    });
  }

  /* ---------- mistakes, score and final message ---------- */

  const MISTAKE_LABELS = { fix: 'Corrected', rev: 'Answer shown', bad: 'Still to fix' };

  function renderMistakes() {
    const box = find('#mist');
    if (!box) return;
    const ids = mistakeIds();
    if (!ids.length) { box.innerHTML = ''; return; }
    const cards = ids.map(id => {
      const entry = items[id];
      const status = statusOf(id);
      const pill = MISTAKE_LABELS[status] ? status : 'bad';
      const explanation = (status === 'fix' || status === 'rev') ? tipHtml('📘', entry.item.explanation) : '';
      return '<div class="mk" data-act="goto" data-id="' + id + '"><div><b>' + esc(entry.section.title || ('Exercise ' + (entry.sectionIndex + 1))) + ' &middot; Q' + (entry.itemIndex + 1) + '</b>'
        + '<span class="pill ' + pill + '">' + (MISTAKE_LABELS[status] || MISTAKE_LABELS.bad) + '</span></div>'
        + '<div class="mkp">' + esc(entry.item.prompt.replace(/___/g, '_____')) + '</div>' + explanation + '</div>';
    });
    box.innerHTML = '<h3 style="margin-top:20px">Your mistakes</h3><p class="sub">Questions you got wrong at some point. Tap one to go back to it.</p>' + cards.join('');
  }

  function countResults() {
    let right = 0, firstTime = 0, fixed = 0;
    scoredIds.forEach(id => {
      const status = statusOf(id);
      if (status === 'ok') { right++; firstTime++; }
      else if (status === 'fix') { right++; fixed++; }
    });
    return { right, firstTime, fixed };
  }

  function finalMessage(results) {
    if (results.right === total) return results.fixed ? 'All correct! Well done for fixing your mistakes.' : 'Perfect! Well done!';
    if (results.right >= total * 0.8) return 'Very good! Have another look at the ones you missed.';
    return 'Keep practising, you are getting there!';
  }

  function updateScore(showFinal) {
    if (!total) return;
    const results = countResults();
    find('#score').textContent = results.right + ' / ' + total;
    find('#pb').style.width = (results.right / total * 100) + '%';
    renderMistakes();
    if (!practice.isRunning()) practice.render();
    if (!deckPanel.isRunning()) deckPanel.render();

    const final = find('#final');
    const allRight = results.right === total;
    if (!allRight && showFinal !== true) { final.classList.remove('show'); return; }
    if (allRight && !final.classList.contains('show')) launchConfetti(final);
    final.classList.add('show');
    find('#fscore').textContent = results.right + ' / ' + total;
    find('#fdetail').textContent = 'Right first time: ' + results.firstTime + ' · Corrected after a mistake: ' + results.fixed + ' · Not yet correct: ' + (total - results.right);
    find('#fmsg').textContent = finalMessage(results);
    if (showFinal === true) final.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const practice = createPractice({
    root, panel: '#prac', prefix: 'p',
    index, ids: mistakeIds, hintFor, speak,
    isClosed: () => state.practiceSkipped,
    onClose: () => { state.practiceSkipped = true; save(); }
  });

  const deckPanel = createDeckPanel({
    root, panel: '#deck', speak,
    enabled: Boolean(options.persist),
    source: worksheet.title,
    mistakes: () => mistakeIds().map(sourceOf),
    isDismissed: () => state.deckDismissed,
    onDismiss: () => { state.deckDismissed = true; save(); }
  });

  /* ---------- what each button does ---------- */

  let resetArmedAt = 0;

  const actions = {
    check(id) {
      state.checked[id] = true;
      recordAttempt(id);
      save(); paint(id); updateScore();
    },
    hint(id) {
      const message = find('#m-' + id);
      state.hintTaps[id] = (state.hintTaps[id] || 0) + 1;
      if (state.hintTaps[id] === 1 && !state.revealed[id]) {
        const hint = hintFor(id);
        message.className = 'msg h';
        message.textContent = hint ? '💡 ' + hint : 'No hint for this one. Tap again to see the answer.';
      } else {
        state.revealed[id] = true;
        markMistake(id);
        paint(id); updateScore();
      }
      save();
    },
    pick(id, button) {
      state.values[id] = button.dataset.v;
      recordAttempt(id);
      save(); paint(id); updateScore();
    },
    all() {
      scoredIds.forEach(id => {
        if (isAnswered(id)) { state.checked[id] = true; recordAttempt(id); }
        paint(id);
      });
      save(); updateScore(true);
    },
    goto(id) {
      const card = find('#w-' + id);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    say(id, button) {
      const settled = ['ok', 'fix', 'rev'].includes(statusOf(id));
      speaker.speak(spokenText(typeOf(id), items[id].item, settled), button);
    },
    'say-passage'(id, button) {
      speaker.speak(worksheet.sections[+button.dataset.s].passage, button);
    },
    'say-word'(id, button) {
      speaker.speak(button.textContent, button);
    },
    reset(id, button) {
      if (Date.now() - resetArmedAt < RESET_CONFIRM_MS) {
        state = freshStudentState();
        save();
        renderPlayer(root, rawWorksheet, options);
        window.scrollTo(0, 0);
        return;
      }
      resetArmedAt = Date.now();
      button.textContent = 'Tap again to confirm';
      setTimeout(() => { if (button.isConnected) button.textContent = 'Start over'; }, RESET_CONFIRM_MS);
    }
  };

  root.onclick = event => {
    const button = event.target.closest('[data-act]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.act;
    if (practice.handleAction(action, button) || deckPanel.handleAction(action, button)) return;
    if (actions[action]) actions[action](button.dataset.id, button);
  };

  root.oninput = event => {
    const field = event.target;
    if (field.id === 'sname') { state.name = field.value; save(); return; }
    const id = field.dataset.id;
    if (!id || field.tagName === 'SELECT') return;
    const blankIndex = +field.dataset.k || 0;
    if (!Array.isArray(state.values[id])) state.values[id] = [];
    state.values[id][blankIndex] = field.value;
    if (state.checked[id] && !state.revealed[id]) { delete state.checked[id]; paint(id); }
    save(); updateWordBanks(); updateScore();
  };

  root.onchange = event => {
    const field = event.target;
    if (practice.handleChange(field) || deckPanel.handleChange(field)) return;
    if (field.tagName === 'SELECT' && field.dataset.id) {
      state.values[field.dataset.id] = field.value;
      recordAttempt(field.dataset.id);
      save(); paint(field.dataset.id); updateScore();
    }
  };

  root.onkeydown = event => {
    if (moveBetweenOptions(event)) { event.preventDefault(); return; }
    const field = event.target;
    // A word in the word bank is a button made from a span: Enter and Space press it like a real button.
    if ((event.key === 'Enter' || event.key === ' ') && field.getAttribute('role') === 'button') { event.preventDefault(); field.click(); return; }
    if (event.key !== 'Enter' || field.tagName !== 'INPUT') return;
    if (practice.handleEnter(field) || deckPanel.handleEnter(field)) { event.preventDefault(); return; }
    if (!field.dataset.id) return;
    event.preventDefault();
    const checkButton = root.querySelector('[data-act="check"][data-id="' + field.dataset.id + '"]');
    if (checkButton) { checkButton.click(); field.blur(); }
  };

  /* ---------- first paint: restore what the student had already done ---------- */

  find('#sname').value = state.name || '';
  root.querySelectorAll('input[data-id],textarea[data-id]').forEach(field => {
    const saved = state.values[field.dataset.id];
    const blankIndex = +field.dataset.k || 0;
    if (Array.isArray(saved) && saved[blankIndex] !== undefined) field.value = saved[blankIndex];
  });
  Object.keys(items).forEach(paint);
  updateWordBanks();
  updateScore();
}
