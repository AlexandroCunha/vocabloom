/* Teacher step 2: check and edit what the AI built before sharing it. */

const splitList = (text, separator) => text.split(separator).map(part => part.trim()).filter(Boolean);
const answersAsText = (section, item) => item.answers.join(section.type === 'fill' ? ' ; ' : ' | ');

const correctOptionHtml = item =>
  '<option value="">Correct answer?</option>' + item.options.map(option => '<option' + (item.answers[0] === option ? ' selected' : '') + '>' + esc(option) + '</option>').join('');

/* ---------- editor markup ---------- */

function hintAndExplanationHtml(item) {
  return '<input type="text" data-f="hint" value="' + esc(item.hint || '') + '" placeholder="Hint shown after a wrong answer (optional)" aria-label="Hint">'
    + '<input type="text" data-f="explanation" value="' + esc(item.explanation || '') + '" placeholder="Explanation (optional)" aria-label="Explanation">';
}

function itemEditorHtml(section, item, itemIndex) {
  const type = section.type;
  const header = '<div class="it" data-ii="' + itemIndex + '"><div class="top2"><span>' + (itemIndex + 1) + '.</span><button class="danger sm" data-del="item">Remove</button></div>';
  if (type === 'match') {
    return header
      + '<input type="text" data-f="left" value="' + esc(item.left || item.prompt) + '" placeholder="Left item" aria-label="Left item">'
      + '<input type="text" data-f="right" value="' + esc(item.right || item.answers[0] || '') + '" placeholder="Correct partner" aria-label="Correct partner">'
      + hintAndExplanationHtml(item) + '</div>';
  }
  let html = header + '<textarea data-f="prompt" aria-label="Question">' + esc(item.prompt) + '</textarea>';
  if (type === 'fill') {
    html += '<input type="text" data-f="answers" value="' + esc(answersAsText(section, item)) + '" placeholder="Answer for each blank, separated by ;" aria-label="Answers">'
      + '<small>Several blanks: separate with ; &middot; accepted alternatives for one blank: separate with |</small>';
  }
  if (type === 'short') {
    html += '<input type="text" data-f="answers" value="' + esc(answersAsText(section, item)) + '" placeholder="Accepted answers, separated by |" aria-label="Accepted answers">'
      + '<small>Leave empty if there is no single right answer (it will not be scored).</small>';
  }
  if (type === 'choice') {
    html += '<textarea data-f="options" placeholder="One option per line" aria-label="Options">' + esc(item.options.join('\n')) + '</textarea><select data-f="correct" aria-label="Correct option">' + correctOptionHtml(item) + '</select>';
  }
  if (type === 'truefalse') {
    html += '<select data-f="tf" aria-label="Correct answer"><option value="">No answer</option><option' + (item.answers[0] === 'True' ? ' selected' : '') + '>True</option><option' + (item.answers[0] === 'False' ? ' selected' : '') + '>False</option></select>';
  }
  if (type !== 'open') html += hintAndExplanationHtml(item);
  return html + '</div>';
}

function sectionEditorHtml(section, sectionIndex) {
  const showWordBank = section.type === 'short' || section.type === 'fill';
  return '<div class="xsec" data-si="' + sectionIndex + '"><div class="sech"><span class="tag">' + TYPE_NAMES[section.type] + '</span><button class="danger sm" data-del="sec">Remove exercise</button></div>'
    + '<input class="e" type="text" data-sf="title" value="' + esc(section.title) + '" placeholder="Exercise title" aria-label="Exercise title">'
    + '<textarea class="e" data-sf="instructions" placeholder="Instructions for students" style="min-height:48px" aria-label="Instructions">' + esc(section.instructions) + '</textarea>'
    + (section.passage ? '<textarea class="e" data-sf="passage" placeholder="Reading text" aria-label="Reading text">' + esc(section.passage) + '</textarea>' : '')
    + (showWordBank ? '<input class="e" type="text" data-sf="wordBank" value="' + esc(section.wordBank.join(', ')) + '" placeholder="Word bank (comma separated, optional)" aria-label="Word bank">' : '')
    + section.items.map((item, itemIndex) => itemEditorHtml(section, item, itemIndex)).join('') + '</div>';
}

function reviewHtml(worksheet) {
  const keyNote = worksheet.answerKeyFound
    ? '<div class="note ok"><b>Answer key found.</b> The correct answers come from your PDF.</div>'
    : '<div class="note warn"><b>No answer key in the PDF.</b> The AI worked out the answers itself. Please check them before sharing.</div>';
  return '<section class="panel"><h2>Review the exercises</h2>' + keyNote
    + '<p class="sub">The AI can make mistakes. Check the questions, answers, hints and explanations before you share the link.</p>'
    + '<label class="f">Worksheet title</label><input type="text" data-wf="title" value="' + esc(worksheet.title) + '">'
    + worksheet.sections.map(sectionEditorHtml).join('')
    + '<div class="nav"><button class="sec" id="b1">&larr; New PDF</button><button id="b3">Continue &rarr;</button></div></section>';
}

/* ---------- applying edits to the worksheet ---------- */

const ITEM_FIELD_UPDATERS = {
  prompt: (item, value) => { item.prompt = value; },
  hint: (item, value) => { item.hint = value; },
  explanation: (item, value) => { item.explanation = value; },
  left: (item, value) => { item.left = value; item.prompt = value; },
  right: (item, value) => { item.right = value; item.answers = value.trim() ? [value.trim()] : []; },
  answers: (item, value, section) => { item.answers = splitList(value, section.type === 'fill' ? ';' : '|'); },
  options: (item, value) => {
    item.options = splitList(value, '\n');
    if (item.answers[0] && !item.options.includes(item.answers[0])) item.answers = [];
  }
};

function renderReviewStep(session, nav) {
  const stage = $('#stage');
  stage.innerHTML = reviewHtml(session.worksheet);

  const sectionOf = element => {
    const box = element.closest('.xsec');
    return box ? session.worksheet.sections[+box.dataset.si] : null;
  };

  stage.oninput = event => {
    const field = event.target;
    const worksheet = session.worksheet;
    if (field.dataset.wf) { worksheet[field.dataset.wf] = field.value; return; }
    const section = sectionOf(field);
    if (!section) return;
    if (field.dataset.sf) {
      section[field.dataset.sf] = field.dataset.sf === 'wordBank' ? splitList(field.value, ',') : field.value;
      return;
    }
    const row = field.closest('.it');
    const update = ITEM_FIELD_UPDATERS[field.dataset.f];
    if (!row || !update) return;
    const item = section.items[+row.dataset.ii];
    update(item, field.value, section);
    if (field.dataset.f === 'options') row.querySelector('select[data-f=correct]').innerHTML = correctOptionHtml(item);
  };

  stage.onchange = event => {
    const field = event.target;
    const section = sectionOf(field);
    const row = field.closest('.it');
    if (!section || !row) return;
    if (field.dataset.f === 'correct' || field.dataset.f === 'tf') {
      section.items[+row.dataset.ii].answers = field.value ? [field.value] : [];
    }
  };

  stage.onclick = event => {
    const button = event.target.closest('[data-del]');
    if (!button) return;
    const sectionIndex = +button.closest('.xsec').dataset.si;
    const scrollY = window.scrollY;
    if (button.dataset.del === 'sec') session.worksheet.sections.splice(sectionIndex, 1);
    else session.worksheet.sections[sectionIndex].items.splice(+button.closest('.it').dataset.ii, 1);
    session.worksheet.sections = session.worksheet.sections.filter(section => section.items.length);
    renderReviewStep(session, nav);
    window.scrollTo(0, scrollY);
  };

  $('#b1').onclick = () => nav.go(1);
  $('#b3').onclick = () => {
    if (!session.worksheet.sections.length) { toast('Nothing left to share'); return; }
    nav.go(3);
  };
}
