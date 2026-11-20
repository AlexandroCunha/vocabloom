/* HTML for the student worksheet. Everything dynamic is escaped with esc(). */

/* An answer field: no suggestions or auto-correction (it would change the answer), and the iPhone's return key reads "done"
   because pressing it checks the answer and closes the keyboard. */
const NO_AUTOFILL = 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"';

const tipHtml = (icon, text) => (text ? '<div class="tip">' + icon + ' ' + esc(text) + '</div>' : '');

/** Wide enough for the longest accepted answer, but never absurdly narrow or wide. */
function blankWidth(item, blankIndex) {
  const answers = alts(item.answers[blankIndex] || '');
  const longest = answers.length ? Math.max.apply(null, answers.map(answer => answer.length)) : 8;
  return Math.min(20, Math.max(7, longest + 2));
}

/** A sentence with an input in place of each "___". `fieldAttrs(k)` says how to tag blank k. */
function fillPromptHtml(item, fieldAttrs) {
  const parts = item.prompt.split('___');
  const lastIndex = parts.length - 1;
  return parts.map((text, k) => esc(text) + (k < lastIndex
    ? '<input type="text" class="blk" style="width:' + blankWidth(item, k) + 'ch" ' + fieldAttrs(k) + ' ' + NO_AUTOFILL + ' aria-label="blank ' + (k + 1) + '">'
    : '')).join('');
}

const shortInputHtml = (attrs, placeholder) =>
  '<input type="text" ' + attrs + ' ' + NO_AUTOFILL + ' placeholder="' + placeholder + '" aria-label="Your answer">';

/** Short options (True / False, single words) are drawn side by side on wide screens. */
const SHORT_OPTION_CHARS = 24;

const choiceButtonsHtml = (item, attrs) =>
  '<div class="opts' + (item.options.every(option => option.length <= SHORT_OPTION_CHARS) ? ' short' : '') + '">' + item.options.map(option => '<button class="opt" ' + attrs + ' data-v="' + esc(option) + '">' + esc(option) + '</button>').join('') + '</div>';

const matchSelectHtml = (options, attrs) =>
  '<select ' + attrs + ' aria-label="Choose the match"><option value="">Choose&hellip;</option>' + options.map(option => '<option>' + esc(option) + '</option>').join('') + '</select>';

/** The round "listen" button. It floats to the right of the text it reads. */
const listenButtonHtml = (attrs, label) =>
  '<button class="say" ' + attrs + ' aria-label="' + label + '" aria-pressed="false">&#128266;</button>';

/* ---------- one question card ---------- */

/** `view.listen` is true when the browser can read text aloud. */
function questionCardHtml(entry, matchOptions, view) {
  const { id, item, section, itemIndex, scored } = entry;
  const say = view.listen ? listenButtonHtml('data-act="say" data-id="' + id + '"', 'Listen to the question') : '';
  const number = '<b>' + (itemIndex + 1) + '.</b> ';
  const prompt = '<div class="q">' + say + number + esc(item.prompt) + '</div>';
  const feedback = '<div class="msg" id="m-' + id + '" aria-live="polite"></div>';
  const buttons = scored
    ? '<div class="row" style="margin-top:6px"><button data-act="check" data-id="' + id + '">&#10003; Check</button><button class="sec" data-act="hint" data-id="' + id + '" aria-label="Hint">&#128161;</button></div>'
    : '';
  const card = inner => '<div class="card" id="w-' + id + '">' + inner + '</div>';

  switch (section.type) {
    case 'fill':
      return card('<div class="q">' + say + number + fillPromptHtml(item, k => 'data-id="' + id + '" data-k="' + k + '"') + '</div>' + buttons + feedback);
    case 'short':
      return card(prompt + shortInputHtml('data-id="' + id + '" data-k="0"', scored ? 'Type your answer' : 'Your answer') + buttons + feedback);
    case 'open':
      return '<div class="card">' + prompt + '<textarea data-id="' + id + '" data-k="0" placeholder="Write your answer here..." autocapitalize="sentences" aria-label="Your answer"></textarea></div>';
    case 'choice':
    case 'truefalse':
      return card(prompt + choiceButtonsHtml(item, 'data-act="pick" data-id="' + id + '"') + feedback);
    case 'match':
      return card(prompt + matchSelectHtml(matchOptions[entry.sectionIndex], 'data-id="' + id + '"') + feedback);
    default:
      return '';
  }
}

/* ---------- sections and the whole page ---------- */

/** With read-aloud, each word in the bank can be tapped to hear it. */
function wordChipHtml(word, listen) {
  const speak = listen ? ' data-act="say-word" role="button" tabindex="0" aria-pressed="false" aria-label="Listen to ' + esc(word) + '"' : '';
  return '<span class="chip" data-w="' + esc(norm(word)) + '"' + speak + '>' + esc(word) + '</span>';
}

function sectionHtml(section, sectionIndex, index, view) {
  const wordBank = section.wordBank.length
    ? '<details class="bank"><summary>Word bank (' + section.wordBank.length + ')</summary>'
      + (view.listen ? '<p class="sub" style="margin:8px 0 0">Tap a word to hear it.</p>' : '')
      + '<div class="chips">' + section.wordBank.map(word => wordChipHtml(word, view.listen)).join('') + '</div></details>'
    : '';
  const passageSay = view.listen ? listenButtonHtml('data-act="say-passage" data-s="' + sectionIndex + '"', 'Listen to the text') : '';
  const cards = section.items.map((item, itemIndex) => questionCardHtml(index.items[itemId(sectionIndex, itemIndex)], index.matchOptions, view)).join('');
  return '<div class="pl" id="sec-' + sectionIndex + '"><h3>' + esc(section.title || ('Exercise ' + (sectionIndex + 1))) + '</h3>'
    + (section.instructions ? '<p class="sub">' + esc(section.instructions) + '</p>' : '')
    + (section.passage ? '<div class="passage">' + passageSay + esc(section.passage) + '</div>' : '')
    + wordBank + cards + '</div>';
}

/** `view` = { listen, home }: read-aloud is available / the student's home page can be linked to. */
function playerHtml(worksheet, index, view) {
  const hasScore = index.scoredIds.length > 0;
  const privacyLink = location.protocol === 'file:' ? '' : ' &middot; <a href="privacy.html">Privacy</a>';
  const homeLink = view.home ? ' &middot; <a href="#review">My review deck</a>' : '';
  return '<div class="hero"><div class="brand-mini">' + LOGO + '<span>Vocabloom</span></div><h1>' + esc(worksheet.title) + '</h1></div>'
    + '<div class="namebar"><input id="sname" type="text" placeholder="Your name" autocomplete="name" aria-label="Your name"><span class="date">' + new Date().toLocaleDateString('en-GB') + '</span></div>'
    + (hasScore ? '<div class="bar"><div class="t"><span>Score</span><span id="score"></span></div><div class="prog"><i id="pb"></i></div></div>' : '<div style="height:6px"></div>')
    + worksheet.sections.map((section, sectionIndex) => sectionHtml(section, sectionIndex, index, view)).join('')
    + '<div class="pl"><div id="mist"></div><div id="prac"></div><div id="deck"></div>'
    + '<div class="final" id="final" aria-live="polite"><div class="big" id="fscore"></div><div id="fdetail" style="margin:4px 0;font-size:14px"></div><div id="fmsg"></div></div>'
    + '<div class="actions"><button class="sec" data-act="reset">Start over</button>' + (hasScore ? '<button data-act="all">Check all</button>' : '') + '</div>'
    + '<p class="foot">Made with Vocabloom' + privacyLink + homeLink + '<br>Hints and explanations may be written with the help of AI.</p></div>';
}
