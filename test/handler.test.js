'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MOCK = '1';
process.env.ACCESS_CODE = 'school-code';
delete process.env.ANTHROPIC_API_KEY;
const handler = require('../api/convert');

const FAKE_PDF = 'JVBERi0xLjQK'; // "%PDF-1.4"

function fakeResponse() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.end = text => { res.body = text; };
  return res;
}
async function call({ method = 'POST', code = 'school-code', body = { pdf: FAKE_PDF }, ip = '10.0.0.1' } = {}) {
  const res = fakeResponse();
  await handler({ method, headers: { 'x-access-code': code, 'x-forwarded-for': ip }, body }, res);
  return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
}

test('rejects other methods', async () => {
  assert.equal((await call({ method: 'GET' })).status, 405);
});

test('rejects a wrong access code', async () => {
  assert.equal((await call({ code: 'nope', ip: '10.0.0.2' })).status, 401);
});

test('blocks repeated wrong access codes', async () => {
  const ip = '10.0.0.3';
  for (let i = 0; i < 5; i++) await call({ code: 'nope', ip });
  const blocked = await call({ code: 'nope', ip });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['retry-after']);
});

test('rejects bodies that are not a PDF', async () => {
  assert.equal((await call({ body: { pdf: 'AAAA' }, ip: '10.0.0.4' })).status, 400);
  assert.equal((await call({ body: { pdf: FAKE_PDF + '<script>' }, ip: '10.0.0.4' })).status, 400);
  assert.equal((await call({ body: null, ip: '10.0.0.4' })).status, 400);
});

test('rejects oversized files', async () => {
  const big = 'JVBER' + 'A'.repeat(5 * 1024 * 1024);
  assert.equal((await call({ body: { pdf: big }, ip: '10.0.0.5' })).status, 413);
});

test('returns the demo worksheet in mock mode, with security headers', async () => {
  const ok = await call({ ip: '10.0.0.6' });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.worksheet.sections.length > 0);
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.equal(ok.headers['cache-control'], 'no-store');
});

test('limits the number of conversions per address', async () => {
  const ip = '10.0.0.7';
  for (let i = 0; i < 20; i++) assert.equal((await call({ ip })).status, 200);
  assert.equal((await call({ ip })).status, 429);
});
