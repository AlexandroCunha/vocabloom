/*
 * Grading rules. Pure functions: no DOM, no stored state.
 * `type` is the exercise type, `item` a normalised item, `value` what the student entered:
 * a list of strings for fill / short, one string for choice / truefalse / match.
 */

const firstAlternative = answer => alts(answer)[0] || '';

function fillIsCorrect(item, value) {
  const blanks = blankCount(item);
  if (!blanks) return false;
  for (let k = 0; k < blanks; k++) {
    const accepted = alts(item.answers[k] || '');
    const typed = norm((value || [])[k]);
    if (!accepted.length || !accepted.some(answer => norm(answer) === typed)) return false;
  }
  return true;
}

function shortIsCorrect(item, value) {
  if (!Array.isArray(value)) return false;
  const typed = norm(value[0]);
  return item.answers.some(answer => alts(answer).some(accepted => norm(accepted) && norm(accepted) === typed));
}

function isCorrect(type, item, value) {
  switch (type) {
    case 'fill': return fillIsCorrect(item, value);
    case 'short': return shortIsCorrect(item, value);
    case 'choice':
    case 'truefalse':
    case 'match': return typeof value === 'string' && norm(value) === norm(item.answers[0]);
    default: return false;
  }
}

/** Has the student typed or chosen anything yet? */
function hasAnswer(type, value) {
  if (type === 'fill') return Array.isArray(value) && value.some(part => String(part || '').trim());
  if (type === 'short') return Array.isArray(value) && String(value[0] || '').trim() !== '';
  return typeof value === 'string' && value !== '';
}

/** The answer to show when a student gives up. */
function answerText(type, item) {
  if (type === 'fill') return item.answers.map(firstAlternative).join(' ; ');
  return item.answers[0] ? firstAlternative(item.answers[0]) : '';
}

/** Fallback hint when the teacher or the AI wrote none: the first letter of each answer. */
function firstLetterHint(type, item) {
  if (type !== 'fill' && type !== 'short') return '';
  const answers = type === 'fill' ? item.answers.map(firstAlternative) : [answerText(type, item)];
  const masked = answers.map(word => word.split('').map((char, i) => (char === ' ' ? '  ' : (i === 0 ? char : '•'))).join(' '));
  return 'Starts with: ' + masked.join('   |   ');
}
