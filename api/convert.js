'use strict';
/**
 * POST /api/convert
 * Body: { pdf: "<base64 of the PDF>" }
 * Header: x-access-code (only if ACCESS_CODE is set on the server)
 * Returns: { worksheet: {...} }
 *
 * Claude reads the PDF (text AND layout/images) and fills the create_worksheet tool,
 * so the answer always arrives as structured JSON.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_B64 = 4.2 * 1024 * 1024; // Vercel serverless request bodies are limited to 4.5 MB
const TYPES = ['fill', 'short', 'choice', 'truefalse', 'match', 'open'];

const TOOL = {
  name: 'create_worksheet',
  description: 'Return the PDF worksheet as structured, interactive exercises.',
  input_schema: {
    type: 'object',
    required: ['title', 'answerKeyFound', 'sections'],
    properties: {
      title: { type: 'string', description: 'Worksheet title as printed in the PDF.' },
      answerKeyFound: { type: 'boolean', description: 'true only if the PDF itself contains the correct answers.' },
      sections: {
        type: 'array',
        description: 'One entry per exercise, in the original order.',
        items: {
          type: 'object',
          required: ['type', 'title', 'items'],
          properties: {
            type: { type: 'string', enum: TYPES },
            title: { type: 'string', description: 'e.g. "Exercise 2 – Complete the sentences"' },
            instructions: { type: 'string', description: 'The instruction line for students, in the original wording.' },
            passage: { type: 'string', description: 'Reading text / dialogue / table shown above the questions, if any.' },
            wordBank: { type: 'array', items: { type: 'string' }, description: 'Words students choose from, if the exercise has a word box.' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  prompt: { type: 'string', description: 'The question or sentence. For fill: the sentence with ___ for each blank.' },
                  answers: { type: 'array', items: { type: 'string' }, description: 'fill: one entry per blank (alternatives separated by |). short: accepted answers. choice/truefalse: exactly one entry that equals one of the options. match: omit.' },
                  options: { type: 'array', items: { type: 'string' }, description: 'choice only: the answer options.' },
                  hint: { type: 'string', description: 'A short nudge shown after a wrong answer. Helps without giving the answer away. British English.' },
                  explanation: { type: 'string', description: 'One or two short, simple sentences saying why the answer is right. British English.' },
                  left: { type: 'string', description: 'match only: the left-hand item.' },
                  right: { type: 'string', description: 'match only: its correct partner.' }
                }
              }
            }
          }
        }
      }
    }
  }
};

const SYSTEM = `You turn a teacher's PDF worksheet into interactive exercises for international students who are learning English. Students will answer on a phone.

Rules:
- Use ONLY what is in the PDF. Do not invent exercises, questions or vocabulary. Keep the original wording, numbering order and language. Skip headers such as Name / Date / Class / page numbers.
- Choose the best type for each exercise:
  fill      - sentence(s) with gaps. Replace every gap (underscores, dots, blank lines, brackets) with exactly three underscores "___". answers has one entry per gap, in order. Put alternatives for the same gap in one entry separated by "|".
  short     - one short answer per item (write the word for a definition, translate a word, answer a short question with a known answer). prompt = the question or definition, answers = accepted answers.
  choice    - multiple choice. options = the printed options without their letters (A., B. ...). answers = [the correct option, copied exactly].
  truefalse - true/false statements. answers = ["True"] or ["False"].
  match     - matching columns. One item per pair: left and its correct partner right.
  open      - writing, opinions, translations into the student's own language, personal answers: anything without one correct answer. No answers needed.
- If the exercise has a word box or a list of words to choose from, copy it into wordBank for that exercise. If a vocabulary table is shown only for reference, put it in passage of the exercise it supports.
- Reading texts, dialogues and tables that questions refer to go in passage of the first exercise that uses them.
- If the PDF contains an answer key, use it and set answerKeyFound = true. Otherwise work out the correct answers yourself and set answerKeyFound = false. Never leave an objective question without answers.
- If a question needs a picture, graph or something you cannot reproduce in text, describe it briefly in the prompt in square brackets.
- For every objective item (fill, short, choice, truefalse, match) also write:
  hint        - a short nudge (about 15 words at most) that helps the student without giving the answer away: a grammar clue, a context clue or what kind of word is missing. Never include the answer itself.
  explanation - one or two short, simple sentences saying why the correct answer is right, suitable for A2-B1 learners.
  Write hints and explanations in British English (for example "practise", "colour", "organise"). Leave the PDF's own text exactly as printed.
- Always answer by calling the create_worksheet tool.`;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
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

function sameCode(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });

  const need = process.env.ACCESS_CODE;
  if (need && !sameCode(req.headers['x-access-code'] || '', need)) {
    return send(res, 401, { error: 'Wrong or missing access code.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const pdf = body && typeof body.pdf === 'string' ? body.pdf : '';
  if (!pdf) return send(res, 400, { error: 'No PDF received.' });
  if (pdf.length > MAX_B64) return send(res, 413, { error: 'The PDF is too large (limit about 3 MB). Compress it and try again.' });
  if (!pdf.startsWith('JVBER')) return send(res, 400, { error: 'That file is not a PDF.' });

  if (process.env.MOCK === '1') {
    try {
      const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'demo.json'), 'utf8'));
      return send(res, 200, { worksheet: normalize(demo), mock: true });
    } catch (e) { return send(res, 500, { error: 'Mock data missing.' }); }
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 500, { error: 'The server has no ANTHROPIC_API_KEY configured.' });

  let r, j;
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'auto' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
            { type: 'text', text: 'Convert this PDF worksheet into interactive exercises. Reply only by calling the create_worksheet tool.' }
          ]
        }]
      })
    });
    j = await r.json();
  } catch (e) {
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  }

  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || 'AI service error';
    console.error('Anthropic error', r.status, msg);
    if (r.status === 429 || r.status === 529) return send(res, 503, { error: 'The AI service is busy. Try again in a minute.' });
    return send(res, 502, { error: 'The AI service returned an error (' + r.status + '): ' + String(msg).slice(0, 300) });
  }
  if (j.stop_reason === 'max_tokens') return send(res, 422, { error: 'This PDF is too long to convert in one go. Split it into smaller parts.' });
  const tu = (j.content || []).find(c => c.type === 'tool_use');
  if (!tu) return send(res, 502, { error: 'The AI did not return a worksheet. Please try again.' });

  const ws = normalize(tu.input);
  if (!ws.sections.length) return send(res, 422, { error: 'No exercises were found in this PDF.' });
  return send(res, 200, { worksheet: ws });
}

module.exports = handler;
module.exports.normalize = normalize;
