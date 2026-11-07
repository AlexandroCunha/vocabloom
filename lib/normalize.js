'use strict';
/**
 * Never trust model output: whatever comes back is reduced to the shape, types and
 * lengths the interface expects before it reaches a browser.
 */
const { TYPES } = require('./worksheet-schema');

const str = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max || 2000) : '');
const arr = x => (Array.isArray(x) ? x : []);

function normalize(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const ws = { title: str(raw.title, 200) || 'Worksheet', answerKeyFound: !!raw.answerKeyFound, sections: [] };
  arr(raw.sections).slice(0, 30).forEach(s => {
    s = s || {};
    const type = TYPES.includes(s.type) ? s.type : 'open';
    const sec = {
      type, title: str(s.title, 200), instructions: str(s.instructions, 800), passage: str(s.passage, 8000),
      wordBank: arr(s.wordBank).map(x => str(x, 80)).filter(Boolean).slice(0, 100), items: []
    };
    arr(s.items).slice(0, 100).forEach(it => {
      it = it || {};
      const o = {
        prompt: str(it.prompt, 1500),
        answers: arr(it.answers).map(x => str(x, 300)).filter(Boolean),
        options: arr(it.options).map(x => str(x, 300)).filter(Boolean).slice(0, 8),
        left: str(it.left, 300), right: str(it.right, 300),
        hint: str(it.hint, 300), explanation: str(it.explanation, 600)
      };
      if (type === 'match') {
        if (!o.left || !o.right) return;
        o.prompt = o.left; o.answers = [o.right]; o.options = [];
      } else if (!o.prompt) return;
      if (type === 'truefalse') {
        o.options = ['True', 'False'];
        const a = (o.answers[0] || '').toLowerCase();
        o.answers = a[0] === 't' ? ['True'] : a[0] === 'f' ? ['False'] : [];
      }
      if (type === 'choice') {
        if (o.options.length < 2) return;
        const hit = o.options.find(x => x.toLowerCase() === (o.answers[0] || '').toLowerCase());
        o.answers = hit ? [hit] : [];
      }
      if (type === 'fill' && o.prompt.indexOf('___') < 0) o.prompt += ' ___';
      if (type === 'open') { o.answers = []; o.hint = ''; o.explanation = ''; }
      sec.items.push(o);
    });
    if (sec.items.length) ws.sections.push(sec);
  });
  return ws;
}

module.exports = { normalize };
