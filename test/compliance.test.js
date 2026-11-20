'use strict';
/** Checks that stay true for the EU / GDPR promises made in the privacy notice and the docs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SCRIPTS, SRC } = require('../scripts/build');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const allSource = () => SCRIPTS.map(file => fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n');

test('security.txt follows RFC 9116 and has not expired (renew the Expires date when this fails)', () => {
  const text = read('public', '.well-known', 'security.txt');
  assert.match(text, /^Contact: https:\/\//m);
  const expires = text.match(/^Expires: (.+)$/m);
  assert.ok(expires, 'Expires field is required');
  assert.ok(new Date(expires[1]) > new Date(), 'security.txt has expired: renew the Expires date');
});

test('the app sets no cookies and has no analytics or tracking', () => {
  const code = allSource();
  assert.doesNotMatch(code, /document\.cookie/);
  assert.doesNotMatch(code, /google-analytics|gtag\(|googletagmanager|facebook|hotjar|segment\.com/i);
});

test('the only requests the app makes are the PDF conversion, short links and the demo file', () => {
  const urls = [...new Set([...allSource().matchAll(/fetch\(\s*'([^']*)'/g)].map(match => match[1]))].sort();
  assert.deepEqual(urls, ['/api/convert', '/api/share', '/api/share?id=', 'demo.json']);
});

/** Everything a student touches: answers, the review deck, read-aloud, the home page. None of it may use the network. */
const STUDENT_FILES = [
  'js/player/player.js', 'js/player/practice.js', 'js/player/state.js', 'js/player/deck-panel.js', 'js/player/home.js', 'js/player/markup.js',
  'js/core/deck.js', 'js/core/speech.js', 'js/core/local-data.js', 'js/core/grading.js'
];

test('student answers, review decks and read-aloud never touch the network', () => {
  STUDENT_FILES.forEach(file => {
    assert.doesNotMatch(fs.readFileSync(path.join(SRC, file), 'utf8'), /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/, file);
  });
});

test('read-aloud only speaks the worksheet text: it cannot see what a student typed', () => {
  const speech = fs.readFileSync(path.join(SRC, 'js/core/speech.js'), 'utf8');
  assert.doesNotMatch(speech, /localStorage|sessionStorage|\.values|state\.|sname|document\./);
  assert.match(speech, /function spokenText\(type, item, revealAnswers\)/, 'its only input is the question, never the student\'s answer');
});

test('everything kept on a student\'s device starts with "vocabloom", so "clear everything" really clears it all', () => {
  const code = allSource();
  const prefix = code.match(/const LOCAL_KEY_PREFIX = '([^']+)'/)[1];
  ['STORAGE_PREFIX', 'DECK_KEY', 'RECENT_KEY'].forEach(name => {
    const value = code.match(new RegExp('const ' + name + " = '([^']+)'"))[1];
    assert.ok(value.startsWith(prefix), name + ' = ' + value);
  });
  const users = SCRIPTS.filter(file => /localStorage/.test(fs.readFileSync(path.join(SRC, file), 'utf8')));
  assert.deepEqual(users.sort(), ['js/core/deck.js', 'js/core/local-data.js', 'js/player/state.js'], 'only these files may use local storage');
});

test('the access code is only ever kept for the browser tab, never in local storage', () => {
  const upload = fs.readFileSync(path.join(SRC, 'js/teacher/upload.js'), 'utf8');
  assert.match(upload, /sessionStorage/);
  assert.doesNotMatch(upload, /localStorage/);
});

test('the privacy notice covers AI, children, and the other companies that handle data', () => {
  const text = read('public', 'privacy.html');
  ['Artificial intelligence', 'Children and young people', 'Who else handles data', 'Data Protection Commission'].forEach(heading => {
    assert.ok(text.includes(heading), 'missing: ' + heading);
  });
  assert.doesNotMatch(text, /Copy my results/);
});

test('the privacy notice describes the optional server storage and everything kept on a device', () => {
  const text = read('public', 'privacy.html');
  [
    'Short links and QR codes', 'Usage counters', 'keyed hash', 'Converted worksheets', 'Storage provider',
    'Review deck', 'Recent worksheets', 'Offline copy', 'Listen buttons', 'Clear everything on this device'
  ].forEach(phrase => assert.ok(text.includes(phrase), 'missing: ' + phrase));
  assert.doesNotMatch(text, /there is no database/i, 'optional storage exists now, so the notice must not claim there is no database');
});

test('student pages tell students that hints may be written with AI', () => {
  assert.match(fs.readFileSync(path.join(SRC, 'js/player/markup.js'), 'utf8'), /may be written with the help of AI/);
});

test('functions run in an EU region (Dublin)', () => {
  assert.deepEqual(JSON.parse(read('vercel.json')).regions, ['dub1']);
});

test('secrets are never committed', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.doesNotMatch(read('.env.example'), /sk-ant-api/);
});

test('.env.example documents every setting the server reads, and its example codes are placeholders that cannot be used', () => {
  const sources = read('lib', 'config.js') + read('server.js');
  const names = new Set([...sources.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map(match => match[1]));
  assert.ok(names.size >= 15, 'found the settings');
  const example = read('.env.example');
  names.forEach(name => assert.ok(example.includes(name), name + ' is not described in .env.example'));
  example.split('\n').filter(line => /^#?\s*ACCESS_CODES?=/.test(line)).forEach(line => assert.match(line, /CHANGE-ME/i, line));
});

test('only lib/config.js reads the environment, so every setting is in one place', () => {
  const files = ['api', 'lib'].flatMap(dir => fs.readdirSync(path.join(ROOT, dir)).filter(name => name.endsWith('.js')).map(name => path.join(dir, name)));
  files.filter(file => file !== path.join('lib', 'config.js')).forEach(file => {
    assert.doesNotMatch(read(file), /process\.env/, file);
  });
});
