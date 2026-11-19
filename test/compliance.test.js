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

test('the only requests the app makes are the PDF conversion and the demo file', () => {
  const urls = [...allSource().matchAll(/fetch\(\s*'([^']*)'/g)].map(match => match[1]).sort();
  assert.deepEqual(urls, ['/api/convert', 'demo.json']);
});

test('student answers are never sent anywhere: the player does not call fetch', () => {
  const player = ['js/player/player.js', 'js/player/practice.js', 'js/player/state.js']
    .map(file => fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n');
  assert.doesNotMatch(player, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
});

test('the privacy notice covers AI, children, and the other companies that handle data', () => {
  const text = read('public', 'privacy.html');
  ['Artificial intelligence', 'Children and young people', 'Who else handles data', 'Data Protection Commission'].forEach(heading => {
    assert.ok(text.includes(heading), 'missing: ' + heading);
  });
  assert.doesNotMatch(text, /Copy my results/);
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
