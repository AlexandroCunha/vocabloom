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
const { SCRIPTS, SRC } = require('../scripts/build');

const PURE_FILES = ['js/core/text.js', 'js/core/worksheet.js', 'js/core/grading.js', 'js/share/codec.js'];
const EXPORTED = ['norm', 'alts', 'hash', 'seededRandom', 'shuffle', 'slug', 'normaliseWorksheet', 'slimJSON', 'isScored',
  'isCorrect', 'hasAnswer', 'answerText', 'firstLetterHint', 'pack', 'unpack', 'MAX_UNPACKED_BYTES'];

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
