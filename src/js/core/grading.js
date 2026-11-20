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

/* ---------- what exactly went wrong in a typed answer ---------- */

/** Number of single-letter changes (add, remove, swap for another) between two strings. */
function editDistance(a, b) {
  let previous = [];
  for (let j = 0; j <= b.length; j++) previous.push(j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = row;
  }
  return previous[b.length];
}

/** The words of an answer, without the punctuation around each one. */
const wordsOf = text => String(text || '').split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);

const isLowerLetter = char => char !== '' && char === char.toLowerCase() && char !== char.toUpperCase();
const isUpperLetter = char => char !== '' && char === char.toUpperCase() && char !== char.toLowerCase();

/** How many wrong letters still count as "a spelling slip" for a word of this length (short words must be exact). */
const slipAllowance = length => (length <= 3 ? 0 : (length <= 5 ? 1 : 2));

/**
 * Compares what the student typed with one accepted answer, word by word.
 * Returns the slips as [{ typed, expected, spelling, capital }], an empty list when nothing is wrong,
 * or null when the two are too different to call it a slip (a different word, or a different number of words).
 */
function compareAnswer(typed, accepted) {
  const written = wordsOf(typed);
  const wanted = wordsOf(accepted);
  if (!written.length || written.length !== wanted.length) return null;
  const slips = [];
  for (let i = 0; i < wanted.length; i++) {
    const spelling = norm(written[i]) !== norm(wanted[i]);
    if (spelling && editDistance(norm(written[i]), norm(wanted[i])) > slipAllowance(norm(wanted[i]).length)) return null;
    const capital = isUpperLetter(wanted[i].charAt(0)) && isLowerLetter(written[i].charAt(0));
    if (spelling || capital) slips.push({ typed: written[i], expected: wanted[i], spelling, capital });
  }
  return slips;
}

/** The accepted answer the student came closest to: the one with the fewest slips, or null when none is close. */
function closestSlips(typed, accepted) {
  let best = null;
  accepted.forEach(answer => {
    const slips = compareAnswer(typed, answer);
    if (slips && (!best || slips.length < best.length)) best = slips;
  });
  return best;
}

/**
 * The student's slips in a typed answer (fill-in and short answers only), so feedback can name the real
 * mistake: a missing capital letter, a spelling error, or both.
 * Returns a list (empty when the answer is exactly right), or null when it is wrong in a way that is more
 * than a slip, or when nothing was typed: then the teacher's own hint and explanation apply.
 * A right answer can still have slips: grading ignores capital letters, but the student can be reminded.
 */
function diagnose(type, item, value) {
  if (!hasAnswer(type, value)) return null;
  let found = [];
  if (type === 'short') {
    const accepted = [].concat.apply([], item.answers.map(alts));
    const slips = closestSlips(value[0], accepted);
    if (!slips) return null;
    found = slips;
  } else if (type === 'fill') {
    for (let k = 0; k < blankCount(item); k++) {
      const typed = (value || [])[k];
      if (!String(typed || '').trim()) return null;
      const slips = closestSlips(typed, alts(item.answers[k] || ''));
      if (!slips) return null;
      found = found.concat(slips);
    }
  } else {
    return null;
  }
  return found;
}

const quoteWords = slips => {
  const names = slips.map(slip => '“' + slip.typed + '”');
  return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
};

/** A hint about the student's slip that does not give the answer away. */
function slipHint(slips) {
  const both = slips.filter(slip => slip.spelling && slip.capital);
  const spellingOnly = slips.filter(slip => slip.spelling && !slip.capital);
  const capitalOnly = slips.filter(slip => !slip.spelling && slip.capital);
  const parts = [];
  if (both.length) parts.push('Check the spelling and the capital letter of ' + quoteWords(both) + '.');
  if (spellingOnly.length) parts.push('Check the spelling of ' + quoteWords(spellingOnly) + '.');
  if (capitalOnly.length === 1) parts.push('Does ' + quoteWords(capitalOnly) + ' need a capital letter?');
  else if (capitalOnly.length > 1) parts.push('Check the capital letters in ' + quoteWords(capitalOnly) + '.');
  return parts.join(' ');
}

const slipReason = slip => (slip.spelling && slip.capital ? 'spelling and capital letter' : (slip.spelling ? 'spelling' : 'capital letter'));

/** Once the answer is shown, say exactly what was different. */
function slipReveal(slips) {
  return slips.map(slip => 'You wrote “' + slip.typed + '”: it is “' + slip.expected + '” (' + slipReason(slip) + ').').join(' ');
}

/** A reminder for an answer that was accepted, but not written with the capital letter it needs. */
function capitalReminder(slips) {
  const missing = slips.filter(slip => slip.capital);
  if (!missing.length) return '';
  const names = missing.map(slip => '“' + slip.expected + '”');
  const list = names.length < 2 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return 'Remember the capital letter: ' + list + '.';
}
