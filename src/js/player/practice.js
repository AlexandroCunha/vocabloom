/*
 * A one-question-at-a-time runner. It is used twice:
 *   - "Practise your mistakes" on a worksheet: optional, and it never changes the score;
 *   - the review deck (deck-panel.js): the same questions, kept on this device, asked again on later days.
 * The student can skip or stop at any moment.
 *
 * ctx = {
 *   root, panel, prefix,    where to draw, the container's selector, and the prefix of its action names and ids
 *   index,                  the question index (or a function that builds it when a run starts)
 *   ids(),                  the question ids to ask, in order
 *   hintFor(id),            hint text for an id
 *   idleHtml?(count),       what to show before a run (default: the "Practise your mistakes?" offer)
 *   isClosed?(),            true when the student already said "no thanks"
 *   onClose?(),             the student pressed the close / skip button
 *   afterClose?,            mode to go to after that: 'closed' (default) or 'idle'
 *   onResult?(id, right),   a question was settled: `right` is true only when it was right at the first try
 *   speak?(text, button),   read-aloud; leave out to hide the listen button
 *   copy?                   texts, see PRACTICE_COPY; copy.done receives { asked, right, firstTime }
 * }
 */

const MAX_PRACTICE_TRIES = 3;

const PRACTICE_COPY = {
  offerTitle: 'Practise your mistakes?',
  offer: count => 'Optional. Try the ' + count + ' question' + (count === 1 ? '' : 's') + ' you got wrong again, one at a time. It will not change your score.',
  start: 'Practise now',
  skip: 'No thanks, skip',
  running: 'Practice',
  doneTitle: 'Practice complete',
  done: result => result.right + ' of ' + result.asked + ' fixed. Well done for going back over them!',
  close: 'Close'
};

function createPractice(ctx) {
  const { root, prefix } = ctx;
  const copy = Object.assign({}, PRACTICE_COPY, ctx.copy || {});
  const fieldAttr = 'data-' + prefix + 'k';
  const act = name => prefix + '-' + name;
  const run = { mode: ctx.isClosed && ctx.isClosed() ? 'closed' : 'idle', ids: [], index: null, position: 0, fixed: 0, firstTime: 0, tries: 0, resolved: false, picked: '', last: null };
  const result = () => ({ asked: run.ids.length, right: run.fixed, firstTime: run.firstTime });

  const panel = () => $(ctx.panel, root);
  const message = () => $('#' + prefix + 'msg', root);
  const currentEntry = () => run.index.items[run.ids[run.position]];
  const buildIndex = () => (typeof ctx.index === 'function' ? ctx.index() : ctx.index);

  /* ---------- drawing ---------- */

  function offerHtml(count) {
    return '<div class="card prac"><h3 style="margin:0 0 4px">' + esc(copy.offerTitle) + '</h3>'
      + '<p class="sub" style="margin:0 0 10px">' + esc(copy.offer(count)) + '</p>'
      + '<div class="actions" style="margin:0"><button data-act="' + act('start') + '">' + esc(copy.start) + '</button><button class="sec" data-act="' + act('skip') + '">' + esc(copy.skip) + '</button></div></div>';
  }

  function doneHtml() {
    return '<div class="card prac ok"><h3 style="margin:0 0 4px">' + esc(copy.doneTitle) + '</h3>'
      + '<p style="margin:0 0 10px">' + esc(copy.done(result())) + '</p>'
      + '<div class="actions" style="margin:0"><button class="sec" data-act="' + act('skip') + '">' + esc(copy.close) + '</button></div></div>';
  }

  function questionHtml(entry) {
    const { item, section } = entry;
    const say = ctx.speak ? listenButtonHtml('data-act="' + act('say') + '"', 'Listen to the question') : '';
    const prompt = '<div class="q">' + say + esc(item.prompt) + '</div>';
    switch (section.type) {
      case 'fill': return '<div class="q">' + say + fillPromptHtml(item, k => fieldAttr + '="' + k + '"') + '</div>';
      case 'short': return prompt + shortInputHtml(fieldAttr + '="0"', 'Type your answer');
      case 'choice':
      case 'truefalse': return prompt + choiceButtonsHtml(item, 'data-act="' + act('pick') + '"');
      case 'match': return prompt + matchSelectHtml(run.index.matchOptions[entry.sectionIndex], fieldAttr + '="0"');
      default: return '';
    }
  }

  function runningHtml() {
    const entry = currentEntry();
    const where = entry.section.title || ('Exercise ' + (entry.sectionIndex + 1));
    return '<div class="card prac">'
      + '<div class="sub" style="margin:0 0 6px">' + esc(copy.running) + ' &middot; question ' + (run.position + 1) + ' of ' + run.ids.length + ' &middot; ' + esc(where) + '</div>'
      + questionHtml(entry) + '<div class="msg" id="' + prefix + 'msg" aria-live="polite"></div>'
      + '<div class="row" style="margin-top:8px"><button data-act="' + act('check') + '" id="' + prefix + 'chk">&#10003; Check</button><button class="sec" data-act="' + act('hint') + '">&#128161; Hint</button><button data-act="' + act('next') + '" id="' + prefix + 'next" style="display:none">Next &rarr;</button></div>'
      + '<div class="actions" style="margin:10px 0 0"><button class="ghost" data-act="' + act('skipq') + '">Skip this question</button><button class="ghost" data-act="' + act('end') + '">Stop</button></div></div>';
  }

  function render() {
    const box = panel();
    if (!box) return;
    if (run.mode === 'closed') box.innerHTML = '';
    else if (run.mode === 'done') box.innerHTML = doneHtml();
    else if (run.mode === 'run') box.innerHTML = runningHtml();
    else {
      const count = ctx.ids().length;
      box.innerHTML = ctx.idleHtml ? ctx.idleHtml(count) : (count ? offerHtml(count) : '');
    }
  }

  /* ---------- answering ---------- */

  function readValue() {
    const fields = [].slice.call(panel().querySelectorAll('[' + fieldAttr + ']'));
    const type = currentEntry().section.type;
    if (type === 'fill' || type === 'short') return fields.map(field => field.value);
    return fields.length ? fields[0].value : run.picked;
  }

  /** The question is settled (right, or the answer was shown): show "Next" and tell the owner how it went. */
  function finishQuestion(rightFirstTime) {
    run.resolved = true;
    $('#' + prefix + 'next', root).style.display = '';
    $('#' + prefix + 'chk', root).style.display = 'none';
    if (ctx.onResult) ctx.onResult(currentEntry().id, rightFirstTime);
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
    run.last = value;
    const slips = diagnose(type, entry.item, value) || [];   // what the student actually got wrong, if it is a slip
    if (isCorrect(type, entry.item, value)) {
      run.fixed += 1;
      if (run.tries === 1) run.firstTime += 1;
      box.className = 'msg ok';
      box.innerHTML = 'Correct, well done!' + tipHtml('📘', entry.item.explanation) + tipHtml('💡', capitalReminder(slips));
      finishQuestion(run.tries === 1);
      return true;
    }
    box.className = 'msg bad';
    if (run.tries >= MAX_PRACTICE_TRIES) {
      box.innerHTML = 'Answer: <b>' + esc(answerText(type, entry.item)) + '</b>' + (slips.length ? tipHtml('💡', slipReveal(slips)) : tipHtml('📘', entry.item.explanation));
      finishQuestion(false);
    } else {
      box.innerHTML = 'Not quite. Have another go.' + tipHtml('💡', slips.length ? slipHint(slips) : ctx.hintFor(entry.id)) + (run.tries >= 2 && !slips.length ? tipHtml('📘', entry.item.explanation) : '');
    }
    return false;
  }

  function nextQuestion() {
    run.position += 1;
    run.tries = 0;
    run.resolved = false;
    run.picked = '';
    run.last = null;
    run.mode = run.position >= run.ids.length ? 'done' : 'run';
    render();
  }

  function start() {
    run.ids = ctx.ids().slice();
    run.index = buildIndex();
    Object.assign(run, { position: 0, fixed: 0, firstTime: 0, tries: 0, resolved: false, picked: '', last: null, mode: run.ids.length ? 'run' : 'idle' });
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
    const slips = run.last ? diagnose(currentEntry().section.type, currentEntry().item, run.last) : null;
    const hint = (slips && slips.length ? slipHint(slips) : '') || ctx.hintFor(run.ids[run.position]);
    const box = message();
    box.className = 'msg h';
    box.textContent = hint ? '💡 ' + hint : 'No hint for this one.';
  }

  function listen(button) {
    const entry = currentEntry();
    ctx.speak(spokenText(entry.section.type, entry.item, run.resolved), button);
  }

  /* ---------- events from the player ---------- */

  const actions = {
    start,
    skip: () => { run.mode = ctx.afterClose || 'closed'; if (ctx.onClose) ctx.onClose(); render(); },
    end: () => { run.mode = 'idle'; render(); },
    check: () => check(readValue()),
    pick: pickOption,
    hint: showHint,
    next: nextQuestion,
    skipq: nextQuestion,
    say: listen
  };
  const own = {};
  Object.keys(actions).forEach(name => { own[act(name)] = actions[name]; });

  return {
    render,
    isRunning: () => run.mode === 'run',
    /** Returns true when the click belonged to this panel. */
    handleAction(action, button) {
      if (!own[action]) return false;
      own[action](button);
      return true;
    },
    /** A drop-down inside this panel changed. Returns true when it was handled. */
    handleChange(target) {
      if (target.tagName !== 'SELECT' || target.getAttribute(fieldAttr) === null) return false;
      check(target.value);
      return true;
    },
    /** Enter pressed inside one of this panel's fields. Returns true when it was handled. */
    handleEnter(target) {
      if (target.tagName !== 'INPUT' || target.getAttribute(fieldAttr) === null) return false;
      check(readValue());
      return true;
    },
    /** How the last run went. */
    result
  };
}
