'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SECURITY_HEADERS, sameCode, createRateLimiter, clientIp } = require('../lib/security');
const { resolvePublicFile } = require('../server');

test('access code comparison', () => {
  assert.equal(sameCode('secret', 'secret'), true);
  assert.equal(sameCode('secret', 'Secret'), false);
  assert.equal(sameCode('', 'secret'), false);
});

test('rate limiter blocks after the limit and recovers after the window', () => {
  let time = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
  limiter.hit('ip'); limiter.hit('ip');
  assert.equal(limiter.isLimited('ip'), true);
  assert.equal(limiter.isLimited('other'), false);
  time = 1001;
  assert.equal(limiter.isLimited('ip'), false);
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

test('static files cannot escape the public folder', () => {
  assert.equal(resolvePublicFile('/../.env'), null);
  assert.equal(resolvePublicFile('/..%2f.env'), null);
  assert.ok(resolvePublicFile('/demo.json'));
});

test('the page loads nothing from other websites', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)="https?:\/\/(?!www\.w3\.org)/);
});
