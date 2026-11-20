'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SECURITY_HEADERS, CSP, sameCode, findTeacher, hashClient, clientIp } = require('../lib/security');
const { resolvePublicFile } = require('../server');

test('access code comparison', () => {
  assert.equal(sameCode('secret', 'secret'), true);
  assert.equal(sameCode('secret', 'Secret'), false);
  assert.equal(sameCode('', 'secret'), false);
});

test('each teacher is found by their own code, and only by it', () => {
  const teachers = [{ name: 'anna', code: 'anna-code' }, { name: 'ben', code: 'ben-code' }];
  assert.equal(findTeacher('ben-code', teachers).name, 'ben');
  assert.equal(findTeacher('anna-code', teachers).name, 'anna');
  assert.equal(findTeacher('anna', teachers), null);
  assert.equal(findTeacher('', teachers), null);
  assert.equal(findTeacher('anything', []), null);
});

test('client fingerprints are stable, secret-dependent and never contain the address', () => {
  const a = hashClient('203.0.113.7', 'secret-one');
  assert.equal(a, hashClient('203.0.113.7', 'secret-one'));
  assert.notEqual(a, hashClient('203.0.113.8', 'secret-one'));
  assert.notEqual(a, hashClient('203.0.113.7', 'secret-two'));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(a, /203/);
});

test('client address comes from x-forwarded-for when present', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
});

test('vercel.json sends the same security headers as the code', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const configured = {};
  config.headers[0].headers.forEach(h => { configured[h.key] = h.value; });
  assert.deepEqual(configured, SECURITY_HEADERS);
});

test('the policy lets the page install its own service worker and manifest, and nothing else', () => {
  const directives = Object.fromEntries(CSP.split('; ').map(part => [part.split(' ')[0], part.split(' ').slice(1).join(' ')]));
  assert.equal(directives['worker-src'], "'self'");
  assert.equal(directives['manifest-src'], "'self'");
  assert.equal(directives['default-src'], "'none'");
  assert.equal(directives['connect-src'], "'self'");
});

test('static files cannot escape the public folder', () => {
  assert.equal(resolvePublicFile('/../.env'), null);
  assert.equal(resolvePublicFile('/..%2f.env'), null);
  assert.ok(resolvePublicFile('/demo.json'));
});

test('the page loads nothing from other websites', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)="https?:\/\/(?!www\.w3\.org)/);
});
