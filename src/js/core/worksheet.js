/* The worksheet data model: shapes, defaults and the question "does this item count for the score?". */

const TYPE_NAMES = {
  fill: 'Fill in the blanks',
  short: 'Short answer',
  choice: 'Multiple choice',
  truefalse: 'True / False',
  match: 'Matching',
  open: 'Open writing'
};

/** Fills in every missing field, so the rest of the app never has to check for undefined. */
function normaliseItem(type, raw) {
  const item = {
    prompt: raw.prompt || '',
    answers: raw.answers || [],
    options: raw.options || [],
    left: raw.left || '',
    right: raw.right || '',
    hint: raw.hint || '',
    explanation: raw.explanation || ''
  };
  // The server does this too; doing it here keeps hand-made worksheets (and the demo) working.
  if (type === 'truefalse' && !item.options.length) item.options = ['True', 'False'];
  if (type === 'match') {
    item.prompt = item.prompt || item.left;
    if (!item.answers.length && item.right) item.answers = [item.right];
  }
  return item;
}

function normaliseWorksheet(raw) {
  raw = raw || {};
  return {
    title: String(raw.title || 'Worksheet'),
    answerKeyFound: !!raw.answerKeyFound,
    sections: (raw.sections || []).map(section => {
      const type = section.type || 'open';
      return {
        type,
        title: section.title || '',
        instructions: section.instructions || '',
        passage: section.passage || '',
        wordBank: section.wordBank || [],
        items: (section.items || []).map(item => normaliseItem(type, item))
      };
    })
  };
}

/** JSON without empty strings and empty lists: keeps share links short. */
const slimJSON = worksheet => JSON.stringify(worksheet, (key, value) =>
  (value === '' || (Array.isArray(value) && !value.length)) ? undefined : value);

const blankCount = item => (item.prompt.match(/___/g) || []).length;

/** Open writing is never scored, and neither is an item that has no known answer. */
function isScored(section, item) {
  if (section.type === 'open') return false;
  if (section.type === 'match') return !!item.answers[0];
  return item.answers.length > 0;
}
