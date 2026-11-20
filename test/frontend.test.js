'use strict';
/**
 * Tests the browser code that has no DOM dependency: matching, grading, the data model and share links.
 * The source files are plain scripts that share one scope, so they are loaded together in a sandbox.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { SCRIPTS, SRC } = require('../scripts/build');

const PURE_FILES = [
  'js/core/text.js', 'js/core/worksheet.js', 'js/core/grading.js', 'js/core/speech.js', 'js/core/deck.js',
  'js/core/local-data.js', 'js/core/platform.js', 'js/share/codec.js', 'js/share/qr.js', 'js/player/keep-place.js'
];
const EXPORTED = ['norm', 'alts', 'hash', 'seededRandom', 'shuffle', 'slug', 'normaliseWorksheet', 'slimJSON', 'isScored',
  'isCorrect', 'hasAnswer', 'answerText', 'firstLetterHint', 'pack', 'unpack', 'MAX_UNPACKED_BYTES',
  'spokenText', 'splitForSpeech', 'pickVoice', 'createSpeaker', 'SPEECH_CHUNK_CHARS', 'SPEECH_LANG', 'SPEECH_RATE',
  'dayNumber', 'emptyDeck', 'cardId', 'makeCard', 'addCard', 'dueCards', 'answerCard', 'deckStats', 'deckIndex',
  'sanitiseDeck', 'loadDeck', 'saveDeck', 'deleteDeck', 'DECK_KEY', 'DECK_MAX_CARDS', 'DECK_WAIT_DAYS', 'DECK_SESSION_SIZE',
  'addRecent', 'cleanRecent', 'loadRecent', 'rememberRecent', 'clearLocalData', 'openedText', 'RECENT_KEY', 'RECENT_MAX',
  'qrMatrix', 'qrSvg', 'rsRemainder', 'isAppleTouchDevice', 'isInstalledApp', 'needsHomeScreenHint', 'HOME_SCREEN_HINT',
  'pickAnchor', 'keepPlace', 'stopKeepingPlace', 'PLACE_MIN_WIDTH_CHANGE', 'PLACE_SETTLE_MS', 'PLACE_EDGE_SLACK'];

function load() {
  const code = PURE_FILES.map(file => fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n')
    + '\n({ ' + EXPORTED.join(', ') + ' })';
  const sandbox = { Blob, Response, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, btoa, atob, Uint8Array, Array, JSON, Math };
  return vm.runInNewContext(code, sandbox);
}
const f = load();

test('every source file listed in the build exists', () => {
  SCRIPTS.forEach(file => assert.ok(fs.existsSync(path.join(SRC, file)), file));
});

test('no source file can close the page script early', () => {
  SCRIPTS.forEach(file => {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8');
    assert.doesNotMatch(code, /<\/script/i, file);
  });
});

test('answers match ignoring case, accents and punctuation', () => {
  assert.equal(f.norm('Café!'), f.norm('cafe'));
  assert.equal(f.norm("  Don't  "), 'dont');
  assert.deepEqual(Array.from(f.alts('color | colour|')), ['color', 'colour']);
});

test('the shuffle is stable for a seed and keeps every element', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = f.shuffle(list, f.seededRandom(42));
  const b = f.shuffle(list, f.seededRandom(42));
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.deepEqual(Array.from(a).sort(), list);
});

test('slug makes safe file names', () => {
  assert.equal(f.slug('Unit 3: Café & Travel!'), 'unit-3-caf-travel');
  assert.equal(f.slug('???'), 'worksheet');
});

test('a worksheet gets defaults, true/false options and matching answers', () => {
  const ws = f.normaliseWorksheet({
    sections: [
      { type: 'truefalse', items: [{ prompt: 'Sky is blue', answers: ['True'] }] },
      { type: 'match', items: [{ left: 'dog', right: 'animal' }] }
    ]
  });
  assert.equal(ws.title, 'Worksheet');
  assert.deepEqual(Array.from(ws.sections[0].items[0].options), ['True', 'False']);
  assert.equal(ws.sections[1].items[0].prompt, 'dog');
  assert.deepEqual(Array.from(ws.sections[1].items[0].answers), ['animal']);
});

test('open writing and items without answers are not scored', () => {
  assert.equal(f.isScored({ type: 'open' }, { answers: ['x'] }), false);
  assert.equal(f.isScored({ type: 'short' }, { answers: [] }), false);
  assert.equal(f.isScored({ type: 'short' }, { answers: ['x'] }), true);
  assert.equal(f.isScored({ type: 'match' }, { answers: [] }), false);
});

test('fill in the blanks needs every blank, and accepts alternatives', () => {
  const item = { prompt: 'I ___ tea and ___ coffee.', answers: ['like|love', 'drink'] };
  assert.equal(f.isCorrect('fill', item, ['Love', 'drink']), true);
  assert.equal(f.isCorrect('fill', item, ['love', 'eat']), false);
  assert.equal(f.isCorrect('fill', item, ['love']), false);
  assert.equal(f.isCorrect('fill', { prompt: 'No blanks', answers: ['x'] }, ['x']), false);
});

test('short answers, choices and matches are graded', () => {
  assert.equal(f.isCorrect('short', { answers: ['Havoc|Chaos'] }, ['chaos']), true);
  assert.equal(f.isCorrect('short', { answers: ['Havoc'] }, ['']), false);
  assert.equal(f.isCorrect('choice', { answers: ['Skip the party'] }, 'skip the party'), true);
  assert.equal(f.isCorrect('choice', { answers: ['Skip the party'] }, 'Go to the party'), false);
  assert.equal(f.isCorrect('open', { answers: ['x'] }, ['x']), false);
});

test('knows when the student has entered something', () => {
  assert.equal(f.hasAnswer('fill', ['', '  ']), false);
  assert.equal(f.hasAnswer('fill', ['', 'x']), true);
  assert.equal(f.hasAnswer('short', ['']), false);
  assert.equal(f.hasAnswer('choice', ''), false);
  assert.equal(f.hasAnswer('choice', 'A'), true);
});

test('shows the first accepted answer, and a first-letter hint that does not give the answer away', () => {
  assert.equal(f.answerText('fill', { answers: ['like|love', 'drink'] }), 'like ; drink');
  assert.equal(f.answerText('short', { answers: ['Havoc|Chaos'] }), 'Havoc');
  const hint = f.firstLetterHint('short', { answers: ['Impact'] });
  assert.match(hint, /^Starts with: I/);
  assert.doesNotMatch(hint, /mpact/);
  assert.equal(f.firstLetterHint('choice', { answers: ['A'] }), '');
});

test('a worksheet survives being packed into a link and unpacked again', async () => {
  const ws = f.normaliseWorksheet({ title: 'Round trip', sections: [{ type: 'short', title: 'A', items: [{ prompt: 'Q ñ é', answers: ['a'] }] }] });
  const packed = await f.pack(ws);
  assert.match(packed, /^s=[\w-]+$/);
  const back = await f.unpack('#' + packed);
  assert.equal(back.title, 'Round trip');
  assert.equal(back.sections[0].items[0].prompt, 'Q ñ é');
});

test('links that are not worksheets, or are huge, are refused', async () => {
  assert.equal(await f.unpack('#hello'), null);
  assert.equal(await f.unpack('#s=' + 'A'.repeat(400001)), null);
});

test('a small link that expands to a huge file is refused (zip bomb)', async () => {
  const bomb = zlib.deflateRawSync(Buffer.alloc(f.MAX_UNPACKED_BYTES + 1024, 'a')).toString('base64url');
  await assert.rejects(() => f.unpack('#s=' + bomb), /too large/i);
});

/* Objects made inside the sandbox have another realm's prototypes: compare them as plain JSON. */
const plain = value => JSON.parse(JSON.stringify(value));

/* ---------- read aloud ---------- */

test('a blank is spoken as a pause and the word "blank"; a settled question reads the answer in its place', () => {
  const item = { prompt: 'I ___ tea and ___ coffee.', answers: ['like|love', 'drink'] };
  assert.equal(f.spokenText('fill', item, false), 'I, blank, tea and, blank, coffee.');
  assert.equal(f.spokenText('fill', item, true), 'I like tea and drink coffee.');
  assert.equal(f.spokenText('fill', { prompt: 'She is ___.', answers: ['happy'] }, false), 'She is, blank.');
  assert.equal(f.spokenText('fill', { prompt: '___ is great', answers: ['Tea'] }, false), 'blank, is great');
});

test('choices are read after the question, and a revealed answer is added once', () => {
  const choice = { prompt: 'Which word is right?', options: ['go', 'goes'], answers: ['goes'] };
  assert.equal(f.spokenText('choice', choice, false), 'Which word is right? go. goes');
  assert.equal(f.spokenText('choice', choice, true), 'Which word is right? Answer: goes');
  assert.equal(f.spokenText('choice', { prompt: 'She ___ to school.', options: ['go', 'goes'], answers: ['goes'] }, true), 'She goes to school.');
  assert.equal(f.spokenText('short', { prompt: 'Name a fruit', answers: ['apple|pear'] }, true), 'Name a fruit. Answer: apple');
  assert.equal(f.spokenText('truefalse', { prompt: 'The sky is green.', options: ['True', 'False'], answers: ['False'] }, false), 'The sky is green.');
  assert.doesNotMatch(f.spokenText('fill', { prompt: 'A ___ B', answers: ['x'] }, false), /_/);
});

test('long texts are read in pieces that end at sentence breaks and never exceed the limit', () => {
  const short = 'One sentence only.';
  assert.deepEqual(plain(f.splitForSpeech(short, 180)), [short]);
  const text = 'First sentence is here. Second sentence is here! Is this the third one? Yes, it is; and a fourth.';
  const chunks = plain(f.splitForSpeech(text, 40));
  assert.ok(chunks.length > 1);
  chunks.forEach(chunk => assert.ok(chunk.length <= 40, chunk));
  assert.equal(chunks.join(' '), text);
  const noStops = 'word '.repeat(100).trim();
  const pieces = plain(f.splitForSpeech(noStops, 60));
  pieces.forEach(piece => assert.ok(piece.length <= 60));
  assert.equal(pieces.join(' '), noStops);
  assert.deepEqual(plain(f.splitForSpeech('', 60)), []);
});

test('the voice is British English first, on-device first, and never a non-English voice', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US', localService: true },
    { name: 'Google UK English Female', lang: 'en-GB', localService: false },
    { name: 'Daniel', lang: 'en_GB', localService: true },
    { name: 'Amelie', lang: 'fr-FR', localService: true }
  ];
  assert.equal(f.pickVoice(voices).name, 'Daniel');
  assert.equal(f.pickVoice(voices.filter(voice => voice.name !== 'Daniel')).name, 'Google UK English Female');
  const noBritish = [{ name: 'Albert', lang: 'en-US', localService: true }, { name: 'Moira', lang: 'en-IE', localService: true }, { name: 'Samantha', lang: 'en-US', localService: true, default: true }];
  assert.equal(f.pickVoice(noBritish).name, 'Moira');
  assert.equal(f.pickVoice(noBritish.filter(voice => voice.lang !== 'en-IE')).name, 'Samantha');
  assert.equal(f.pickVoice([{ name: 'Amelie', lang: 'fr-FR', localService: true }]), null);
  assert.equal(f.pickVoice([]), null);
  assert.equal(f.pickVoice(undefined), null);
});

function fakeButton() {
  const classes = new Set();
  const attributes = {};
  return { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }, setAttribute: (name, value) => { attributes[name] = value; }, attributes };
}

function fakeWindow() {
  const spoken = [];
  const win = {
    spoken,
    cancelled: 0,
    listeners: {},
    addEventListener(name, handler) { win.listeners[name] = handler; },
    speechSynthesis: {
      speak: utterance => spoken.push(utterance),
      cancel: () => { win.cancelled += 1; },
      getVoices: () => [{ name: 'Daniel', lang: 'en-GB', localService: true }]
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  return win;
}

test('without speech support the speaker does nothing and does not fail', () => {
  const speaker = f.createSpeaker({});
  assert.equal(speaker.supported, false);
  assert.equal(speaker.speak('Hello', fakeButton()), false);
  speaker.stop();
});

test('speaking uses British English at a gentle pace, and marks the button while it plays', () => {
  const win = fakeWindow();
  const speaker = f.createSpeaker(win);
  const button = fakeButton();
  assert.equal(speaker.speak('Hello there.', button), true);
  assert.equal(win.spoken.length, 1);
  const utterance = win.spoken[0];
  assert.equal(utterance.lang, f.SPEECH_LANG);
  assert.equal(utterance.rate, f.SPEECH_RATE);
  assert.equal(utterance.voice.name, 'Daniel');
  assert.equal(button.classList.contains('speaking'), true);
  assert.equal(button.attributes['aria-pressed'], 'true');
  utterance.onend();
  assert.equal(button.classList.contains('speaking'), false);
  assert.equal(button.attributes['aria-pressed'], 'false');
});

test('pressing the same button again stops; another button takes over; late events from a stopped run are ignored', () => {
  const win = fakeWindow();
  const speaker = f.createSpeaker(win);
  const first = fakeButton();
  const second = fakeButton();
  speaker.speak('First text.', first);
  const firstUtterance = win.spoken[0];
  speaker.speak('First text.', first);
  assert.equal(win.spoken.length, 1, 'no new speech when the same button is pressed again');
  assert.equal(first.classList.contains('speaking'), false);

  speaker.speak('First text.', first);
  speaker.speak('Second text.', second);
  assert.equal(first.classList.contains('speaking'), false);
  assert.equal(second.classList.contains('speaking'), true);
  firstUtterance.onend();                                   // the old run reports in late
  win.spoken[1].onerror();
  assert.equal(second.classList.contains('speaking'), true, 'a cancelled run must not switch off the new button');
  win.spoken[win.spoken.length - 1].onend();
  assert.equal(second.classList.contains('speaking'), false);
});

test('a long text is queued in pieces and the button stays on until the last one ends', () => {
  const win = fakeWindow();
  const speaker = f.createSpeaker(win);
  const button = fakeButton();
  speaker.speak(('This is a fairly long sentence for the test. ').repeat(12), button);
  assert.ok(win.spoken.length > 1);
  win.spoken.slice(0, -1).forEach(utterance => utterance.onend());
  assert.equal(button.classList.contains('speaking'), true);
  win.spoken[win.spoken.length - 1].onend();
  assert.equal(button.classList.contains('speaking'), false);
  win.listeners.pagehide();
  assert.ok(win.cancelled > 0, 'leaving the page stops the speech');
});

/* ---------- the review deck ---------- */

function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    data,
    get length() { return data.size; },
    key: index => (index < data.size ? Array.from(data.keys())[index] : null),
    getItem: name => (data.has(name) ? data.get(name) : null),
    setItem: (name, value) => { data.set(name, String(value)); },
    removeItem: name => { data.delete(name); }
  };
}

const DAY = 20_000;   // an arbitrary "today" as a day number
const fillItem = { prompt: 'I ___ tea.', answers: ['like|love'], hint: 'A verb', explanation: 'Present simple.' };

test('a card is made from a question, comes back tomorrow, and the same question is the same card', () => {
  const card = f.makeCard('fill', fillItem, 'Unit 3', [], DAY);
  assert.equal(card.box, 1);
  assert.equal(card.due, DAY + 1);
  assert.equal(card.from, 'Unit 3');
  assert.deepEqual(plain(card.answers), ['like|love']);
  assert.equal(card.id, f.makeCard('fill', fillItem, 'Another sheet', [], DAY + 50).id);
  assert.notEqual(card.id, f.makeCard('fill', { prompt: 'I ___ coffee.', answers: ['like|love'] }, 'Unit 3', [], DAY).id);
  assert.notEqual(card.id, f.makeCard('short', fillItem, 'Unit 3', [], DAY).id);
});

test('a long list of choices is cut down without ever losing the right answer', () => {
  const choices = Array.from({ length: 20 }, (unused, i) => 'right side ' + i);
  const card = f.makeCard('match', { prompt: 'left', answers: ['right side 18'] }, '', choices, DAY);
  assert.ok(card.choices.length <= 12);
  assert.ok(Array.from(card.choices).includes('right side 18'));
  const options = Array.from({ length: 20 }, (unused, i) => 'option ' + i);
  const choice = f.makeCard('choice', { prompt: 'q', options, answers: ['option 19'] }, '', [], DAY);
  assert.ok(Array.from(choice.options).includes('option 19'));
  assert.deepEqual(plain(f.makeCard('fill', fillItem, '', ['x'], DAY).choices), [], 'only matching cards keep choices');
});

test('getting a known question wrong again sends it back to box 1 but keeps its history', () => {
  const deck = f.emptyDeck();
  const card = f.makeCard('fill', fillItem, 'Unit 3', [], DAY);
  f.addCard(deck, card, DAY);
  f.answerCard(deck, card.id, true, DAY + 1);
  f.answerCard(deck, card.id, true, DAY + 4);
  assert.equal(deck.cards[card.id].box, 3);
  f.addCard(deck, f.makeCard('fill', fillItem, 'Unit 9', [], DAY + 5), DAY + 5);
  const again = deck.cards[card.id];
  assert.equal(again.box, 1);
  assert.equal(again.due, DAY + 6);
  assert.equal(again.seen, 2);
  assert.equal(again.right, 2);
  assert.equal(again.added, DAY);
  assert.equal(again.from, 'Unit 9');
  assert.equal(Object.keys(deck.cards).length, 1);
});

test('cards come back after 1, 3, 7, 14 and 30 days, then are learned and leave the deck', () => {
  assert.deepEqual(plain(f.DECK_WAIT_DAYS), [1, 3, 7, 14, 30]);
  const deck = f.emptyDeck();
  const card = f.makeCard('fill', fillItem, '', [], DAY);
  f.addCard(deck, card, DAY);
  let today = DAY;
  const expectedBoxes = [2, 3, 4, 5];
  const expectedWaits = [3, 7, 14, 30];
  [1, 3, 7, 14].forEach((wait, step) => {
    today += wait;
    assert.equal(f.dueCards(deck, today).length, 1, 'due after ' + wait + ' days');
    assert.equal(f.dueCards(deck, today - 1).length, 0, 'not due a day earlier');
    f.answerCard(deck, card.id, true, today);
    assert.equal(deck.cards[card.id].box, expectedBoxes[step]);
    assert.equal(deck.cards[card.id].due, today + expectedWaits[step]);
  });
  today += 30;
  f.answerCard(deck, card.id, true, today);
  assert.equal(deck.cards[card.id], undefined, 'learned: it leaves the deck');
  assert.equal(deck.mastered, 1);
});

test('a wrong answer sends the card back to box 1, due tomorrow; unknown cards are ignored', () => {
  const deck = f.emptyDeck();
  const card = f.makeCard('fill', fillItem, '', [], DAY);
  f.addCard(deck, card, DAY);
  f.answerCard(deck, card.id, true, DAY + 1);
  f.answerCard(deck, card.id, true, DAY + 4);
  f.answerCard(deck, card.id, false, DAY + 11);
  assert.equal(deck.cards[card.id].box, 1);
  assert.equal(deck.cards[card.id].due, DAY + 12);
  assert.equal(deck.cards[card.id].seen, 3);
  assert.equal(deck.cards[card.id].right, 2);
  f.answerCard(deck, 'nope', true, DAY);
  assert.equal(Object.keys(deck.cards).length, 1);
});

test('due cards come weakest box first, then longest waiting', () => {
  const deck = f.emptyDeck();
  const make = (prompt, box, due) => {
    const card = f.makeCard('short', { prompt, answers: ['x'] }, '', [], DAY);
    Object.assign(card, { box, due });
    deck.cards[card.id] = card;
    return prompt;
  };
  make('b3-old', 3, DAY - 5);
  make('b1-new', 1, DAY);
  make('b1-old', 1, DAY - 2);
  make('future', 1, DAY + 1);
  assert.deepEqual(plain(f.dueCards(deck, DAY).map(card => card.prompt)), ['b1-old', 'b1-new', 'b3-old']);
});

test('the deck holds at most 300 cards and the best-known ones make room', () => {
  const deck = f.emptyDeck();
  for (let i = 0; i < f.DECK_MAX_CARDS + 5; i++) {
    const card = f.makeCard('short', { prompt: 'question ' + i, answers: ['a'] }, '', [], DAY);
    if (i < 5) card.box = 5;   // these five are the best known
    f.addCard(deck, card, DAY);
  }
  assert.equal(Object.keys(deck.cards).length, f.DECK_MAX_CARDS);
  assert.equal(Object.values(deck.cards).filter(card => card.box === 5).length, 0);
});

test('deck statistics count what is due, what is waiting and what is learned', () => {
  const deck = f.emptyDeck();
  [['a', 1, DAY - 1], ['b', 2, DAY], ['c', 2, DAY + 3], ['d', 4, DAY + 10]].forEach(([prompt, box, due]) => {
    const card = f.makeCard('short', { prompt, answers: ['x'] }, '', [], DAY);
    Object.assign(card, { box, due });
    deck.cards[card.id] = card;
  });
  deck.mastered = 7;
  const stats = plain(f.deckStats(deck, DAY));
  assert.deepEqual(stats, { total: 4, due: 2, mastered: 7, boxes: [1, 2, 0, 1, 0], nextInDays: 3 });
  assert.equal(f.deckStats(f.emptyDeck(), DAY).nextInDays, null);
});

test('deck cards are shaped like worksheet questions so the practice runner can ask them', () => {
  const match = f.makeCard('match', { prompt: 'dog', answers: ['animal'] }, 'Animals', ['animal', 'plant'], DAY);
  const fill = f.makeCard('fill', fillItem, '', [], DAY);
  const index = plain(f.deckIndex([match, fill]));
  assert.equal(index.items[match.id].section.type, 'match');
  assert.equal(index.items[match.id].section.title, 'Animals');
  assert.equal(index.items[fill.id].section.title, 'Review');
  assert.equal(index.items[fill.id].item.prompt, 'I ___ tea.');
  assert.deepEqual(index.matchOptions[0], ['animal', 'plant']);
  assert.equal(index.matchOptions[1], undefined);
});

test('a damaged or edited deck in storage can never break the page', () => {
  const clean = plain(f.sanitiseDeck({
    mastered: -4,
    cards: {
      good: { id: 'good', type: 'short', prompt: 'Q', answers: ['a'], box: 9, due: 'soon', seen: -1, right: 2.7 },
      huge: { type: 'short', prompt: 'x'.repeat(5000), answers: ['y'.repeat(5000)], hint: 'h'.repeat(5000) },
      badType: { type: 'script', prompt: 'Q', answers: ['a'] },
      noAnswers: { type: 'short', prompt: 'Q', answers: [] },
      oneOption: { type: 'choice', prompt: 'Q', answers: ['a'], options: ['a'] },
      noChoices: { type: 'match', prompt: 'Q', answers: ['a'], choices: [] },
      notAnObject: 'string',
      nothing: null
    }
  }, DAY));
  assert.equal(clean.mastered, 0);
  const cards = Object.values(clean.cards);
  assert.deepEqual(cards.map(card => card.type).sort(), ['short', 'short']);
  const good = clean.cards.good;
  assert.equal(good.box, 5);
  assert.equal(good.due, DAY);
  assert.equal(good.seen, 0);
  assert.equal(good.right, 2);
  const huge = cards.find(card => card.id !== 'good');
  assert.ok(huge.prompt.length <= 600 && huge.answers[0].length <= 200 && huge.hint.length <= 300);
  assert.deepEqual(plain(f.sanitiseDeck(null, DAY)), { cards: {}, mastered: 0 });
  assert.deepEqual(plain(f.sanitiseDeck({ cards: 'x' }, DAY)), { cards: {}, mastered: 0 });
  const mc = plain(f.sanitiseDeck({ cards: { mm: { id: 'mm', type: 'choice', prompt: 'Q', answers: ['c'], options: ['a', 'b'] } } }, DAY));
  assert.ok(mc.cards.mm.options.includes('c'), 'the right answer is always one of the options');
  const tf = plain(f.sanitiseDeck({ cards: { tt: { id: 'tt', type: 'truefalse', prompt: 'Q', answers: ['True'] } } }, DAY));
  assert.deepEqual(tf.cards.tt.options, ['True', 'False']);
  const odd = plain(f.sanitiseDeck({ cards: { 'x y!': { id: 'x y!', type: 'short', prompt: 'Q', answers: ['a'] } } }, DAY));
  assert.match(Object.keys(odd.cards)[0], /^[a-z0-9]{2,24}$/, 'an odd id is replaced by one made from the content');
});

test('the deck only exists in storage once the student has chosen to keep one', () => {
  const storage = fakeStorage();
  assert.equal(f.loadDeck(DAY, storage), null, 'nothing saved means no deck');
  const deck = f.emptyDeck();
  f.addCard(deck, f.makeCard('fill', fillItem, 'Unit 3', [], DAY), DAY);
  assert.equal(f.saveDeck(deck, storage), true);
  const back = f.loadDeck(DAY, storage);
  assert.equal(Object.keys(back.cards).length, 1);
  f.deleteDeck(storage);
  assert.equal(storage.data.has(f.DECK_KEY), false);
  assert.equal(f.loadDeck(DAY, storage), null);

  storage.setItem(f.DECK_KEY, '{not json');
  assert.deepEqual(plain(f.loadDeck(DAY, storage)), { cards: {}, mastered: 0 }, 'a damaged deck becomes an empty one');

  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(f.loadDeck(DAY, blocked), null);
  assert.equal(f.saveDeck(deck, blocked), false);
  f.deleteDeck(blocked);
});

test('days are counted on the student\'s own calendar', () => {
  const lateEvening = f.dayNumber(new Date(2026, 10, 20, 23, 59));
  const justAfterMidnight = f.dayNumber(new Date(2026, 10, 21, 0, 1));
  assert.equal(justAfterMidnight - lateEvening, 1);
  assert.equal(f.dayNumber(new Date(2026, 10, 20, 0, 0)), lateEvening);
});

/* ---------- recent worksheets and clearing the device ---------- */

test('recent worksheets: newest first, one per link, at most eight, and only real worksheet links', () => {
  let list = [];
  for (let i = 0; i < 10; i++) list = plain(f.addRecent(list, 'Sheet ' + i, '#w=AbCdEf12345' + (i % 10), 1000 + i));
  assert.equal(list.length, f.RECENT_MAX);
  assert.equal(list[0].title, 'Sheet 9');
  list = plain(f.addRecent(list, 'Renamed', list[3].link, 5000));
  assert.equal(list.length, f.RECENT_MAX);
  assert.equal(list[0].title, 'Renamed');
  assert.equal(list.filter(entry => entry.link === list[0].link).length, 1);

  ['javascript:alert(1)', '#review', '#w=short', 'https://evil.example/', '#s=' + 'a'.repeat(20001), '#s=ab cd', ''].forEach(bad => {
    assert.deepEqual(plain(f.addRecent(list, 'x', bad, 1)), list, 'refused: ' + bad.slice(0, 20));
  });
  assert.equal(plain(f.addRecent([], 'ok', '#s=abc_DEF-123', 1))[0].link, '#s=abc_DEF-123');
  assert.equal(plain(f.addRecent([], 'ok', '#j=abc', 1))[0].link, '#j=abc');
  assert.equal(plain(f.addRecent([], 't'.repeat(500), '#j=abc', 1))[0].title.length, 120);
});

test('the recent list read from storage is checked, so a link target can never be anything but a worksheet link', () => {
  assert.deepEqual(plain(f.cleanRecent('nope')), []);
  const cleaned = plain(f.cleanRecent([
    { title: 'Fine', link: '#s=abc', at: 5 },
    { title: 'Evil', link: 'javascript:alert(1)', at: 5 },
    { title: 'No link' },
    null,
    { link: '#w=AbCdEf123456', at: 'yesterday' }
  ]));
  assert.deepEqual(cleaned.map(entry => entry.link), ['#s=abc', '#w=AbCdEf123456']);
  assert.equal(cleaned[1].title, 'Worksheet');
  assert.equal(cleaned[1].at, 0);
  const storage = fakeStorage();
  f.rememberRecent('Unit 3', '#s=abc', 1234, storage);
  f.rememberRecent('Unit 4', '#s=def', 1235, storage);
  assert.deepEqual(plain(f.loadRecent(storage)).map(entry => entry.title), ['Unit 4', 'Unit 3']);
  storage.setItem(f.RECENT_KEY, '{broken');
  assert.deepEqual(plain(f.loadRecent(storage)), []);
});

test('"clear everything" removes Vocabloom data from this device and nothing else', () => {
  const storage = fakeStorage({
    'vocabloom3:123': '{"name":"Ana"}',
    [f.DECK_KEY]: '{}',
    [f.RECENT_KEY]: '[]',
    'other-site-setting': 'keep me'
  });
  assert.equal(f.clearLocalData(storage), 3);
  assert.deepEqual(Array.from(storage.data.keys()), ['other-site-setting']);
  assert.equal(f.clearLocalData(storage), 0);
});

test('"opened" labels count calendar days', () => {
  const now = new Date(2026, 10, 20, 15, 0).getTime();
  assert.equal(f.openedText(new Date(2026, 10, 20, 8, 0).getTime(), now), 'Opened today');
  assert.equal(f.openedText(new Date(2026, 10, 19, 23, 0).getTime(), now), 'Opened yesterday');
  assert.equal(f.openedText(new Date(2026, 10, 15, 12, 0).getTime(), now), 'Opened 5 days ago');
  assert.equal(f.openedText(0, now), '');
  assert.equal(f.openedText(now + 5 * 86400000, now), '');
});

/* ---------- QR codes ---------- */

const digest = matrix => crypto.createHash('sha256').update(matrix.map(row => row.map(Number).join('')).join('\n')).digest('hex').slice(0, 16);

test('Reed-Solomon error correction matches the published example (HELLO WORLD, version 1-M)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Array.from(f.rsRemainder(data, 10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('QR codes keep their exact pattern (checked against codes that phone scanners decoded)', () => {
  const cases = [
    ['HELLO WORLD', 21, '2d21897bf5a7ac60'],
    ['https://vocabloom-esl.vercel.app/#w=AbCdEf123456', 33, 'd9f04901446f5c7b'],
    ['x'.repeat(213), 57, 'f8a692e420006d88'],
    ['Vocabloom ñ é 漢字', 25, '2911906509ca641d']
  ];
  cases.forEach(([text, size, expected]) => {
    const matrix = plain(f.qrMatrix(text));
    assert.equal(matrix.length, size, text.slice(0, 20));
    assert.equal(digest(matrix), expected, text.slice(0, 20));
  });
});

test('every QR code has the three finder squares, the timing lines and the dark module', () => {
  ['a', 'https://vocabloom-esl.vercel.app/#w=AbCdEf123456', 'x'.repeat(150)].forEach(text => {
    const m = plain(f.qrMatrix(text));
    const size = m.length;
    const version = (size - 17) / 4;
    [[0, 0], [0, size - 7], [size - 7, 0]].forEach(([row, col]) => {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
          assert.equal(Boolean(m[row + i][col + j]), ring !== 2, 'finder ' + row + ',' + col + ' at ' + i + ',' + j);
        }
      }
    });
    for (let i = 8; i < size - 8; i++) {
      assert.equal(Boolean(m[6][i]), i % 2 === 0, 'timing row');
      assert.equal(Boolean(m[i][6]), i % 2 === 0, 'timing column');
    }
    assert.equal(Boolean(m[4 * version + 9][8]), true, 'dark module');
  });
});

test('the same text always gives the same code, and 213 bytes is the limit', () => {
  assert.deepEqual(plain(f.qrMatrix('same')), plain(f.qrMatrix('same')));
  assert.notDeepEqual(plain(f.qrMatrix('one')), plain(f.qrMatrix('two')));
  assert.equal(f.qrMatrix('x'.repeat(213)).length, 57);
  assert.throws(() => f.qrMatrix('x'.repeat(214)), /too long/i);
  assert.equal(f.qrMatrix('').length, 21);
});

test('the QR picture is one self-contained SVG with a quiet zone and nothing that can run', () => {
  const matrix = f.qrMatrix('https://vocabloom-esl.vercel.app/#w=AbCdEf123456');
  const svg = f.qrSvg(matrix);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 41 41"/);
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.doesNotMatch(svg, /<script|onload|href=/i);
  assert.match(svg, /<rect width="41" height="41" fill="#fff"\/>/);
});

/* ---------- device detection (only used to show the right tip) ---------- */

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const MAC_SAFARI = IPAD_AS_MAC;
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const deviceWindow = (userAgent, extra = {}, standaloneMedia = false) => ({
  navigator: Object.assign({ userAgent, maxTouchPoints: 0 }, extra),
  matchMedia: query => ({ matches: standaloneMedia && query === '(display-mode: standalone)' })
});

test('iPhone and iPad are recognised, computers and Android phones are not', () => {
  assert.equal(f.isAppleTouchDevice(deviceWindow(IPHONE_SAFARI)), true);
  assert.equal(f.isAppleTouchDevice(deviceWindow(IPHONE_CHROME)), true, 'Chrome on iPhone is WebKit too');
  assert.equal(f.isAppleTouchDevice(deviceWindow(IPAD_AS_MAC, { maxTouchPoints: 5 })), true, 'an iPad that says it is a Mac');
  assert.equal(f.isAppleTouchDevice(deviceWindow(MAC_SAFARI)), false, 'a real Mac has no touch screen');
  assert.equal(f.isAppleTouchDevice(deviceWindow(WINDOWS_CHROME)), false);
  assert.equal(f.isAppleTouchDevice(deviceWindow('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile Safari/537.36')), false);
  assert.equal(f.isAppleTouchDevice({}), false, 'no navigator at all');
});

test('the Home Screen tip shows in an iPhone browser tab but not once the app is installed', () => {
  assert.equal(f.needsHomeScreenHint(deviceWindow(IPHONE_SAFARI)), true);
  assert.equal(f.needsHomeScreenHint(deviceWindow(IPHONE_SAFARI, { standalone: true })), false, 'iOS standalone flag');
  assert.equal(f.needsHomeScreenHint(deviceWindow(IPHONE_SAFARI, {}, true)), false, 'display-mode: standalone');
  assert.equal(f.needsHomeScreenHint(deviceWindow(WINDOWS_CHROME)), false);
  assert.equal(f.isInstalledApp({ navigator: {} }), false, 'no matchMedia: assume a browser tab');
  assert.match(f.HOME_SCREEN_HINT, /Add to Home Screen/);
});

/* ---------- keeping the student's place when the window changes shape (iPhone Duo, turning the phone) ---------- */

test('the place to keep is the first whole question in view, and the left one of a pair', () => {
  const rect = (top, bottom) => ({ top, bottom });
  assert.equal(f.pickAnchor([], 0), -1);
  assert.equal(f.pickAnchor([rect(-400, -190), rect(-175, 21), rect(33, 229), rect(241, 437)], 0), 2, 'a question cut off by the bar is skipped');
  assert.equal(f.pickAnchor([rect(-20, 176), rect(188, 384)], 0), 0, 'a little hidden under the bar still counts as in view');
  assert.equal(f.pickAnchor([rect(33, 229), rect(33, 235), rect(247, 443)], 0), 0, 'two side by side: the left one');
  assert.equal(f.pickAnchor([rect(-300, 900)], 0), 0, 'one very tall question fills the screen: it is the place');
  assert.equal(f.pickAnchor([rect(-500, -300), rect(-290, -90)], 0), -1, 'everything is above the screen');
  assert.equal(f.pickAnchor([rect(40, 236), rect(248, 444)], 60), 0, 'the bar is measured from its foot, not from the top of the page');
  assert.ok(f.PLACE_MIN_WIDTH_CHANGE >= 20 && f.PLACE_MIN_WIDTH_CHANGE <= 100, 'a scroll bar is not a new shape, a turned phone is');
});

function placeStage(width) {
  const listeners = {};
  const win = {
    innerWidth: width, scrolls: [], frames: [], timers: [], listeners,
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(other => other !== fn); },
    requestAnimationFrame(fn) { win.frames.push(fn); return win.frames.length; },
    cancelAnimationFrame() { win.frames.length = 0; },
    setTimeout(fn) { win.timers.push(fn); return win.timers.length; },
    clearTimeout() { win.timers.length = 0; },
    scrollBy(options) { win.scrolls.push(options); },
    fire(name) { (listeners[name] || []).slice().forEach(fn => fn()); },
    runFrames() { win.frames.splice(0).forEach(fn => fn()); },
    runTimers() { win.timers.splice(0).forEach(fn => fn()); }
  };
  const card = (top, height) => ({ top, height, isConnected: true, getBoundingClientRect() { return { top: this.top, bottom: this.top + this.height }; } });
  const bar = card(0, 40);
  const cards = [card(-380, 196), card(-170, 196), card(40, 196), card(250, 196)];
  const root = { querySelectorAll: () => cards, querySelector: selector => (selector === '.bar' ? bar : null) };
  return { win, root, cards };
}

test('after the window changes shape, the question that was at the top is put back at the top', () => {
  const { win, root, cards } = placeStage(382);
  f.keepPlace(root, win);                        // remembers cards[2], 0px below the score bar
  cards.forEach((card, i) => { card.top = 1000 + i * 100; });   // the page re-flows (two columns): everything moves
  win.innerWidth = 951;
  win.fire('resize');
  assert.equal(win.scrolls.length, 0, 'it waits for the new layout to settle');
  win.runTimers();
  assert.deepEqual(JSON.parse(JSON.stringify(win.scrolls)), [{ top: 1200 - 40, behavior: 'instant' }]);
});

test('a scroll bar appearing, or a keyboard, does not move the page', () => {
  const { win, root, cards } = placeStage(382);
  f.keepPlace(root, win);
  cards.forEach(card => { card.top += 500; });
  win.innerWidth = 372;                          // 10px narrower
  win.fire('resize'); win.runTimers();
  assert.equal(win.scrolls.length, 0);
});

test('scrolling updates the remembered place, and a layout change does not overwrite it before it is used', () => {
  const { win, root, cards } = placeStage(382);
  f.keepPlace(root, win);
  cards.forEach(card => { card.top -= 210; });   // the student scrolls one question down
  win.fire('scroll'); win.runFrames();
  cards.forEach((card, i) => { card.top = 5000 + i * 100; });   // the window is turned: the browser clamps the scroll first
  win.innerWidth = 951;
  win.fire('scroll'); win.runFrames();           // a scroll event from the new layout must not become "the place"
  win.fire('resize'); win.runTimers();
  assert.deepEqual(JSON.parse(JSON.stringify(win.scrolls)), [{ top: 5300 - 40, behavior: 'instant' }], 'cards[3] was the first whole question after the scroll');
});

test('a question that has left the page is not chased, and a new worksheet replaces the old listeners', () => {
  const { win, root, cards } = placeStage(382);
  f.keepPlace(root, win);
  cards[2].isConnected = false;
  win.innerWidth = 951;
  win.fire('resize'); win.runTimers();
  assert.equal(win.scrolls.length, 0);
  f.keepPlace(root, win);
  assert.equal(win.listeners.scroll.length, 1, 'one scroll listener');
  assert.equal(win.listeners.resize.length, 1, 'one resize listener');
  assert.equal(win.listeners.orientationchange.length, 1, 'one turn listener');
  f.stopKeepingPlace();
  assert.equal(win.listeners.scroll.length + win.listeners.resize.length + win.listeners.orientationchange.length, 0, 'leaving the worksheet removes them all');
  f.stopKeepingPlace();   // stopping twice is harmless
});

test('a browser that does not know the scroll word "instant" still gets the page put back', () => {
  const { win, root, cards } = placeStage(382);
  win.scrollBy = function (first, second) {
    if (first && first.behavior) throw new TypeError('not a valid enum value');
    win.scrolls.push({ x: first, y: second });
  };
  f.keepPlace(root, win);
  cards.forEach((card, i) => { card.top = 800 + i * 100; });
  win.innerWidth = 951;
  win.fire('resize'); win.runTimers();
  assert.deepEqual(JSON.parse(JSON.stringify(win.scrolls)), [{ x: 0, y: 1000 - 40 - 0 }]);
  f.stopKeepingPlace();
});
