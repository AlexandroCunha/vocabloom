'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../lib/normalize');

const worksheet = sections => normalize({ title: 'T', answerKeyFound: true, sections });

test('keeps a valid fill-in-the-blanks exercise', () => {
  const ws = worksheet([{ type: 'fill', title: 'A', items: [{ prompt: 'I ___ tea.', answers: ['like'] }] }]);
  assert.equal(ws.sections[0].items[0].answers[0], 'like');
});

test('falls back to "open" for unknown exercise types', () => {
  const ws = worksheet([{ type: '<script>', title: 'A', items: [{ prompt: 'Write.' }] }]);
  assert.equal(ws.sections[0].type, 'open');
});

test('drops exercises without items and items without a prompt', () => {
  const ws = worksheet([
    { type: 'short', title: 'empty', items: [] },
    { type: 'short', title: 'kept', items: [{ prompt: '' }, { prompt: 'Capital of Ireland?', answers: ['Dublin'] }] }
  ]);
  assert.equal(ws.sections.length, 1);
  assert.equal(ws.sections[0].items.length, 1);
});

test('multiple choice answer must be one of the options', () => {
  const ws = worksheet([{ type: 'choice', title: 'A', items: [{ prompt: 'Q', options: ['a', 'b'], answers: ['c'] }] }]);
  assert.deepEqual(ws.sections[0].items[0].answers, []);
});

test('true/false answers are normalised', () => {
  const ws = worksheet([{ type: 'truefalse', title: 'A', items: [{ prompt: 'Q', answers: ['false'] }] }]);
  assert.deepEqual(ws.sections[0].items[0].answers, ['False']);
});

test('limits text length and number of sections', () => {
  const many = Array.from({ length: 50 }, () => ({ type: 'open', title: 'x'.repeat(5000), items: [{ prompt: 'Q' }] }));
  const ws = worksheet(many);
  assert.equal(ws.sections.length, 30);
  assert.equal(ws.sections[0].title.length, 200);
});

test('survives garbage input', () => {
  assert.equal(normalize(null).sections.length, 0);
  assert.equal(normalize('nope').title, 'Worksheet');
});
