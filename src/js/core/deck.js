/*
 * The review deck: questions a student got wrong, kept on this device and asked again on later days.
 * It uses Leitner boxes: a question moves up a box each time it is answered right first time, and the
 * wait before it comes back grows (1, 3, 7, 14, then 30 days). A wrong answer sends it back to box 1.
 *
 * The functions here have no DOM and no storage access, and "today" is always passed in as a day number,
 * so they are easy to test. They change the deck object they are given.
 * The deck only exists once the student chooses to save it: no saved deck means nothing is kept.
 */

const DECK_KEY = 'vocabloom-deck1';
const DECK_WAIT_DAYS = [1, 3, 7, 14, 30];   // days until a card comes back, by box (box 1 first)
const DECK_MAX_CARDS = 300;
const DECK_SESSION_SIZE = 10;               // a review round is kept short
const DECK_TYPES = ['fill', 'short', 'choice', 'truefalse', 'match'];
const DECK_LIMITS = { prompt: 600, answer: 200, answers: 12, option: 200, options: 12, text: 300, source: 80 };

/** The student's calendar day as a whole number (local time), so "tomorrow" means tomorrow where they are. */
const dayNumber = date => Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);

const emptyDeck = () => ({ cards: {}, mastered: 0 });

const clip = (value, max) => String(value == null ? '' : value).slice(0, max);
const clipList = (list, count, max) => (Array.isArray(list) ? list : []).slice(0, count).map(entry => clip(entry, max));

/** The same question in two worksheets (or the same worksheet twice) is one card. */
function cardId(type, prompt, answers) {
  const text = [type, prompt, (answers || []).join('|')].join('\n');
  return hash(text).toString(36) + hash('~' + text).toString(36);
}

/** Keeps the list short, but never drops the right answer from it. */
function shortList(list, rightAnswer, max) {
  const names = clipList(list, 200, DECK_LIMITS.option);
  if (names.length <= max) return names;
  const others = names.filter(name => norm(name) !== norm(rightAnswer)).slice(0, max - 1);
  return rightAnswer ? others.concat(clip(rightAnswer, DECK_LIMITS.option)) : others;
}

/**
 * A card from a worksheet question. `choices` are the drop-down answers of a matching exercise.
 * A new card comes back tomorrow.
 */
function makeCard(type, item, source, choices, today) {
  const answers = clipList(item.answers, DECK_LIMITS.answers, DECK_LIMITS.answer);
  const prompt = clip(item.prompt, DECK_LIMITS.prompt);
  return {
    id: cardId(type, prompt, answers),
    type,
    prompt,
    answers,
    options: type === 'choice' || type === 'truefalse' ? shortList(item.options, answers[0], DECK_LIMITS.options) : [],
    choices: type === 'match' ? shortList(choices, answers[0], DECK_LIMITS.options) : [],
    hint: clip(item.hint, DECK_LIMITS.text),
    explanation: clip(item.explanation, DECK_LIMITS.text),
    from: clip(source, DECK_LIMITS.source),
    box: 1,
    due: today + DECK_WAIT_DAYS[0],
    added: today,
    seen: 0,
    right: 0
  };
}

/** When the deck is full, the cards that are best known (highest box, furthest away) make room. */
function trimDeck(deck) {
  const cards = Object.keys(deck.cards).map(id => deck.cards[id]);
  if (cards.length <= DECK_MAX_CARDS) return deck;
  cards.sort((a, b) => (b.box - a.box) || (b.due - a.due) || (a.id < b.id ? -1 : 1));
  cards.slice(0, cards.length - DECK_MAX_CARDS).forEach(card => { delete deck.cards[card.id]; });
  return deck;
}

/** Adds a card, or, when the student got a known question wrong again, sends it back to box 1. */
function addCard(deck, card, today) {
  const known = deck.cards[card.id];
  if (known) {
    Object.assign(known, card, { box: 1, due: today + DECK_WAIT_DAYS[0], added: known.added, seen: known.seen, right: known.right });
  } else {
    deck.cards[card.id] = card;
  }
  return trimDeck(deck);
}

/** Cards that are ready, weakest first, then the ones that have waited longest. */
function dueCards(deck, today) {
  return Object.keys(deck.cards).map(id => deck.cards[id])
    .filter(card => card.due <= today)
    .sort((a, b) => (a.box - b.box) || (a.due - b.due) || (a.id < b.id ? -1 : 1));
}

/** Records one answer. `correct` means right at the first try. A card right in the last box is "mastered" and leaves the deck. */
function answerCard(deck, id, correct, today) {
  const card = deck.cards[id];
  if (!card) return deck;
  card.seen += 1;
  if (correct) {
    card.right += 1;
    if (card.box >= DECK_WAIT_DAYS.length) {
      delete deck.cards[id];
      deck.mastered += 1;
      return deck;
    }
    card.box += 1;
  } else {
    card.box = 1;
  }
  card.due = today + DECK_WAIT_DAYS[card.box - 1];
  return deck;
}

function deckStats(deck, today) {
  const cards = Object.keys(deck.cards).map(id => deck.cards[id]);
  const boxes = DECK_WAIT_DAYS.map((days, box) => cards.filter(card => card.box === box + 1).length);
  const waiting = cards.filter(card => card.due > today).map(card => card.due - today);
  return {
    total: cards.length,
    due: cards.length - waiting.length,
    mastered: deck.mastered,
    boxes,
    nextInDays: waiting.length ? Math.min.apply(null, waiting) : null
  };
}

/** The same shape the worksheet player uses, so the practice runner can ask deck cards too. */
function deckIndex(cards) {
  const items = {};
  const matchOptions = {};
  cards.forEach((card, position) => {
    items[card.id] = {
      id: card.id,
      scored: true,
      sectionIndex: position,
      itemIndex: 0,
      section: { type: card.type, title: card.from || 'Review' },
      item: { prompt: card.prompt, answers: card.answers, options: card.options, hint: card.hint, explanation: card.explanation }
    };
    if (card.type === 'match') matchOptions[position] = card.choices;
  });
  return { items, matchOptions };
}

/* ---------- reading back what was stored ---------- */

const wholeNumber = (value, fallback, min) => (Number.isFinite(value) && value >= min ? Math.floor(value) : fallback);

/** Anything read from storage is checked: a damaged or edited deck must never break the page. */
function cleanCard(raw, today) {
  if (!raw || typeof raw !== 'object' || DECK_TYPES.indexOf(raw.type) === -1) return null;
  const answers = clipList(raw.answers, DECK_LIMITS.answers, DECK_LIMITS.answer).filter(answer => answer.trim());
  const prompt = clip(raw.prompt, DECK_LIMITS.prompt);
  if (!prompt || !answers.length) return null;
  let options = clipList(raw.options, DECK_LIMITS.options, DECK_LIMITS.option);
  let choices = clipList(raw.choices, DECK_LIMITS.options, DECK_LIMITS.option);
  if (raw.type === 'truefalse' && !options.length) options = ['True', 'False'];
  if (raw.type === 'choice' && options.length < 2) return null;
  if (raw.type === 'match' && choices.length < 2) return null;
  const ensureAnswer = list => (list.some(entry => norm(entry) === norm(answers[0])) ? list : list.concat(answers[0]));
  if (raw.type === 'choice' || raw.type === 'truefalse') options = ensureAnswer(options);
  if (raw.type === 'match') choices = ensureAnswer(choices);
  const id = typeof raw.id === 'string' && /^[a-z0-9]{2,24}$/.test(raw.id) ? raw.id : cardId(raw.type, prompt, answers);
  return {
    id,
    type: raw.type,
    prompt,
    answers,
    options: raw.type === 'choice' || raw.type === 'truefalse' ? options : [],
    choices: raw.type === 'match' ? choices : [],
    hint: clip(raw.hint, DECK_LIMITS.text),
    explanation: clip(raw.explanation, DECK_LIMITS.text),
    from: clip(raw.from, DECK_LIMITS.source),
    box: Math.min(DECK_WAIT_DAYS.length, wholeNumber(raw.box, 1, 1)),
    due: wholeNumber(raw.due, today, 0),
    added: wholeNumber(raw.added, today, 0),
    seen: wholeNumber(raw.seen, 0, 0),
    right: wholeNumber(raw.right, 0, 0)
  };
}

function sanitiseDeck(raw, today) {
  const deck = emptyDeck();
  if (!raw || typeof raw !== 'object' || !raw.cards || typeof raw.cards !== 'object') return deck;
  deck.mastered = wholeNumber(raw.mastered, 0, 0);
  Object.keys(raw.cards).forEach(key => {
    const card = cleanCard(raw.cards[key], today);
    if (card) deck.cards[card.id] = card;
  });
  return trimDeck(deck);
}

/* ---------- storage: the key only exists once the student has chosen to keep a deck ---------- */

/** Returns the saved deck, or null when the student has not chosen to keep one. */
function loadDeck(today, storage) {
  storage = storage || localStorage;
  let text = null;
  try { text = storage.getItem(DECK_KEY); } catch (error) { return null; }
  if (text === null) return null;
  try { return sanitiseDeck(JSON.parse(text), today); } catch (error) { return emptyDeck(); }
}

/** Returns false when the browser would not store it (private mode or full storage). */
function saveDeck(deck, storage) {
  try { (storage || localStorage).setItem(DECK_KEY, JSON.stringify(deck)); return true; } catch (error) { return false; }
}

function deleteDeck(storage) {
  try { (storage || localStorage).removeItem(DECK_KEY); } catch (error) { /* nothing to delete */ }
}
