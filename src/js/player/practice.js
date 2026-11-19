/*
 * Optional "Practise your mistakes".
 * Re-asks, one at a time, the same questions from the PDF that the student got wrong.
 * It never changes the score and the student can skip it at any moment.
 *
 * ctx = {
 *   root, index,            where to draw, and the item index
 *   mistakeIds(),           ids the student got wrong at some point
 *   hintFor(id),            hint text for an id
 *   isSkipped(), markSkipped()
 * }
 */

const MAX_PRACTICE_TRIES = 3;

function createPractice(ctx) {
  const { root, index } = ctx;
  const run = { mode: ctx.isSkipped() ? 'closed' : 'idle', ids: [], position: 0, fixed: 0, tries: 0, resolved: false, picked: '' };

  const panel = () => $('#prac', root);
  const message = () => $('#pmsg', root);
  const currentEntry = () => index.items[run.ids[run.position]];

  /* ---------- drawing ---------- */

  function offerHtml(count) {
    return '<div class="card prac"><h3 style="margin:0 0 4px">Practise your mistakes?</h3>'
      + '<p class="sub" style="margin:0 0 10px">Optional. Try the ' + count + ' question' + (count === 1 ? '' : 's') + ' you got wrong again, one at a time. It will not change your score.</p>'
      + '<div class="actions" style="margin:0"><button data-act="p-start">Practise now</button><button class="sec" data-act="p-skip">No thanks, skip</button></div></div>';
  }

  function doneHtml() {
    return '<div class="card prac ok"><h3 style="margin:0 0 4px">Practice complete</h3>'
      + '<p style="margin:0 0 10px">' + run.fixed + ' of ' + run.ids.length + ' fixed. Well done for going back over them!</p>'
      + '<div class="actions" style="margin:0"><button class="sec" data-act="p-skip">Close</button></div></div>';
  }

  function questionHtml(entry) {
    const { item, section } = entry;
    const prompt = '<div class="q">' + esc(item.prompt) + '</div>';
    switch (section.type) {
      case 'fill': return '<div class="q">' + fillPromptHtml(item, k => 'data-pk="' + k + '"') + '</div>';
      case 'short': return prompt + shortInputHtml('data-pk="0"', 'Type your answer');
      case 'choice':
      case 'truefalse': return prompt + choiceButtonsHtml(item, 'data-act="p-pick"');
      case 'match': return prompt + matchSelectHtml(index.matchOptions[entry.sectionIndex], 'data-pk="0"');
      default: return '';
    }
  }

  function runningHtml() {
    const entry = currentEntry();
    const where = entry.section.title || ('Exercise ' + (entry.sectionIndex + 1));
    return '<div class="card prac"><div class="sub" style="margin:0 0 6px">Practice &middot; question ' + (run.position + 1) + ' of ' + run.ids.length + ' &middot; ' + esc(where) + '</div>'
      + questionHtml(entry) + '<div class="msg" id="pmsg" aria-live="polite"></div>'
      + '<div class="row" style="margin-top:8px"><button data-act="p-check" id="pchk">&#10003; Check</button><button class="sec" data-act="p-hint">&#128161; Hint</button><button data-act="p-next" id="pnext" style="display:none">Next &rarr;</button></div>'
      + '<div class="actions" style="margin:10px 0 0"><button class="ghost" data-act="p-skipq">Skip this question</button><button class="ghost" data-act="p-end">Stop practice</button></div></div>';
  }

  function render() {
    const box = panel();
    if (!box) return;
    if (run.mode === 'closed') box.innerHTML = '';
    else if (run.mode === 'done') box.innerHTML = doneHtml();
    else if (run.mode === 'run') box.innerHTML = runningHtml();
    else {
      const count = ctx.mistakeIds().length;
      box.innerHTML = count ? offerHtml(count) : '';
    }
  }

  /* ---------- answering ---------- */

  function readValue() {
    const fields = [].slice.call(panel().querySelectorAll('[data-pk]'));
    const type = currentEntry().section.type;
    if (type === 'fill' || type === 'short') return fields.map(field => field.value);
    return fields.length ? fields[0].value : run.picked;
  }

  function finishQuestion() {
    run.resolved = true;
    $('#pnext', root).style.display = '';
    $('#pchk', root).style.display = 'none';
  }

  /** Returns true when the answer was right, false when wrong, null when nothing was entered. */
  function check(value) {
    if (run.resolved) return null;
    const entry = currentEntry();
    const type = entry.section.type;
    const box = message();
    if (!hasAnswer(type, value)) {
      box.className = 'msg';
      box.textContent = 'Type or choose an answer first.';
      return null;
    }
    run.tries += 1;
    if (isCorrect(type, entry.item, value)) {
      run.fixed += 1;
      box.className = 'msg ok';
      box.innerHTML = 'Correct, well done!' + tipHtml('📘', entry.item.explanation);
      finishQuestion();
      return true;
    }
    box.className = 'msg bad';
    if (run.tries >= MAX_PRACTICE_TRIES) {
      box.innerHTML = 'Answer: <b>' + esc(answerText(type, entry.item)) + '</b>' + tipHtml('📘', entry.item.explanation);
      finishQuestion();
    } else {
      box.innerHTML = 'Not quite. Have another go.' + tipHtml('💡', ctx.hintFor(entry.id)) + (run.tries >= 2 ? tipHtml('📘', entry.item.explanation) : '');
    }
    return false;
  }

  function nextQuestion() {
    run.position += 1;
    run.tries = 0;
    run.resolved = false;
    run.picked = '';
    run.mode = run.position >= run.ids.length ? 'done' : 'run';
    render();
  }

  function start() {
    run.ids = ctx.mistakeIds().slice();
    Object.assign(run, { position: 0, fixed: 0, tries: 0, resolved: false, picked: '', mode: run.ids.length ? 'run' : 'idle' });
    render();
    const box = panel();
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function pickOption(button) {
    if (run.resolved) return;
    run.picked = button.dataset.v;
    panel().querySelectorAll('.opt').forEach(option => { option.className = 'opt'; });
    const right = check(run.picked);
    if (right !== null) button.classList.add(right ? 'ok' : 'bad');
  }

  function showHint() {
    const hint = ctx.hintFor(run.ids[run.position]);
    const box = message();
    box.className = 'msg h';
    box.textContent = hint ? '💡 ' + hint : 'No hint for this one.';
  }

  /* ---------- events from the player ---------- */

  const actions = {
    'p-start': start,
    'p-skip': () => { run.mode = 'closed'; ctx.markSkipped(); render(); },
    'p-end': () => { run.mode = 'idle'; render(); },
    'p-check': () => check(readValue()),
    'p-pick': pickOption,
    'p-hint': showHint,
    'p-next': nextQuestion,
    'p-skipq': nextQuestion
  };

  return {
    render,
    isRunning: () => run.mode === 'run',
    /** Returns true when the click belonged to the practice panel. */
    handleAction(action, button) {
      if (!actions[action]) return false;
      actions[action](button);
      return true;
    },
    /** A drop-down inside the practice panel changed. Returns true when it was handled. */
    handleChange(target) {
      if (target.tagName !== 'SELECT' || target.dataset.pk === undefined) return false;
      check(target.value);
      return true;
    },
    /** Enter pressed inside a practice field. Returns true when it was handled. */
    handleEnter(target) {
      if (target.tagName !== 'INPUT' || target.dataset.pk === undefined) return false;
      check(readValue());
      return true;
    }
  };
}
