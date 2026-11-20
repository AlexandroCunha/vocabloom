'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createHandler } = require('../api/convert');
const { createStore } = require('../lib/store');
const { ConversionError } = require('../lib/claude');
const { createFakeRedis } = require('../scripts/fake-redis');

const WORKSHEET = { title: 'T', answerKeyFound: true, sections: [{ type: 'short', title: 'A', items: [{ prompt: 'Q?', answers: ['a'] }] }] };
const pdfNumber = n => 'JVBERi0xLjQK' + 'A'.repeat(n); // "%PDF-1.4" plus filler: a different PDF for every n
const FAKE_PDF = pdfNumber(0);

const ENV_NAMES = ['MOCK', 'ACCESS_CODE', 'ACCESS_CODES', 'ANTHROPIC_API_KEY', 'VERCEL_ENV', 'DAILY_LIMIT_PER_TEACHER',
  'DAILY_LIMIT_TOTAL', 'CACHE_TTL_DAYS', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];

/** Runs `run` with exactly these environment variables set, then puts everything back. */
async function withEnv(vars, run) {
  const saved = {};
  ENV_NAMES.forEach(name => { saved[name] = process.env[name]; delete process.env[name]; });
  Object.assign(process.env, vars);
  try { return await run(); } finally {
    ENV_NAMES.forEach(name => { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; });
  }
}

function fakeResponse() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.end = text => { res.body = text; };
  return res;
}

/** A handler with its own empty memory store and a conversion that counts how often it is called. */
function setup({ convert, now } = {}) {
  const calls = { convert: 0 };
  const store = createStore({ redisUrl: '', redisToken: '' }, { now });
  const handler = createHandler({
    store, now,
    convert: convert || (async () => { calls.convert += 1; return JSON.parse(JSON.stringify(WORKSHEET)); })
  });
  async function call({ method = 'POST', code = 'school-code', body = { pdf: FAKE_PDF }, ip = '10.0.0.1' } = {}) {
    const res = fakeResponse();
    await handler({ method, headers: { 'x-access-code': code, 'x-forwarded-for': ip }, body }, res);
    return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
  }
  return { call, calls, store };
}

const LIVE = { ANTHROPIC_API_KEY: 'test-key', ACCESS_CODE: 'school-code' };

/* ---------- who may use it ---------- */

test('rejects other methods', () => withEnv(LIVE, async () => {
  assert.equal((await setup().call({ method: 'GET' })).status, 405);
}));

test('rejects a wrong or missing access code', () => withEnv(LIVE, async () => {
  const { call } = setup();
  assert.equal((await call({ code: 'nope' })).status, 401);
  assert.equal((await call({ code: '' })).status, 401);
}));

test('blocks repeated wrong access codes, even for the right code afterwards', () => withEnv(LIVE, async () => {
  const { call } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await call({ code: 'nope' })).status, 401);
  const blocked = await call({ code: 'nope' });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['retry-after']);
  assert.equal((await call({ code: 'school-code' })).status, 429, 'a guess that is right still waits for the window to pass');
  assert.equal((await call({ code: 'nope', ip: '10.0.0.99' })).status, 401, 'other clients are not affected');
}));

test('a right code clears earlier typos', () => withEnv(LIVE, async () => {
  const { call } = setup();
  for (let i = 0; i < 4; i++) await call({ code: 'nope' });
  assert.equal((await call({ code: 'school-code' })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await call({ code: 'nope' })).status, 401);
}));

test('every teacher has a code of their own, and a code that is removed stops working', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'anna:anna-code,ben:ben-code' }, async () => {
    const { call } = setup();
    assert.equal((await call({ code: 'anna-code' })).status, 200);
    assert.equal((await call({ code: 'ben-code', body: { pdf: pdfNumber(1) } })).status, 200);
    assert.equal((await call({ code: 'school-code' })).status, 401);
  });
  await withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'ben:ben-code' }, async () => {
    assert.equal((await setup().call({ code: 'anna-code' })).status, 401, 'anna was removed from the list');
  });
});

test('a typo in ACCESS_CODES locks everyone out instead of opening the door', () => withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'oops-no-colon' }, async () => {
  assert.equal((await setup().call({ code: 'oops-no-colon' })).status, 401);
  assert.equal((await setup().call({ code: '' })).status, 401);
}));

test('the live site refuses to convert when no access code is set at all', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'k', VERCEL_ENV: 'production' }, async () => {
    const { call, calls } = setup();
    const refused = await call({ code: '' });
    assert.equal(refused.status, 500);
    assert.match(refused.json.error, /not configured/);
    assert.equal(calls.convert, 0);
  });
  await withEnv({ ANTHROPIC_API_KEY: 'k' }, async () => {
    assert.equal((await setup().call({ code: '' })).status, 200, 'local development still works without a code');
  });
});

/* ---------- the PDF ---------- */

test('rejects bodies that are not a PDF', () => withEnv(LIVE, async () => {
  const { call } = setup();
  assert.equal((await call({ body: { pdf: 'AAAA' } })).status, 400);
  assert.equal((await call({ body: { pdf: FAKE_PDF + '<script>' } })).status, 400);
  assert.equal((await call({ body: null })).status, 400);
}));

test('rejects oversized files', () => withEnv(LIVE, async () => {
  assert.equal((await setup().call({ body: { pdf: 'JVBER' + 'A'.repeat(5 * 1024 * 1024) } })).status, 413);
}));

/* ---------- demo mode and the burst limit ---------- */

test('returns the demo worksheet in mock mode, with security headers', () => withEnv({ MOCK: '1', ACCESS_CODE: 'school-code' }, async () => {
  const ok = await setup().call();
  assert.equal(ok.status, 200);
  assert.ok(ok.json.worksheet.sections.length > 0);
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.equal(ok.headers['cache-control'], 'no-store');
}));

test('limits the number of conversions per client in an hour', () => withEnv({ MOCK: '1', ACCESS_CODE: 'school-code' }, async () => {
  const { call } = setup();
  for (let i = 0; i < 20; i++) assert.equal((await call()).status, 200);
  const blocked = await call();
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['retry-after']);
}));

/* ---------- converting, and not paying twice ---------- */

test('converts a PDF and returns the validated worksheet', () => withEnv(LIVE, async () => {
  const { call, calls } = setup();
  const result = await call();
  assert.equal(result.status, 200);
  assert.equal(result.json.worksheet.sections[0].items[0].answers[0], 'a');
  assert.equal(result.json.cached, undefined);
  assert.equal(calls.convert, 1);
}));

test('the same PDF is not converted twice, unless the teacher asks for a fresh conversion', () => withEnv(LIVE, async () => {
  const { call, calls } = setup();
  await call();
  const again = await call();
  assert.equal(again.status, 200);
  assert.equal(again.json.cached, true);
  assert.equal(calls.convert, 1, 'the second answer came from the cache');
  const other = await call({ body: { pdf: pdfNumber(7) } });
  assert.equal(other.json.cached, undefined);
  assert.equal(calls.convert, 2, 'a different PDF is converted');
  const fresh = await call({ body: { pdf: FAKE_PDF, fresh: true } });
  assert.equal(fresh.json.cached, undefined);
  assert.equal(calls.convert, 3, 'fresh: true skips the cache');
  assert.equal((await call()).json.cached, true, 'and the new result is the one remembered');
}));

test('CACHE_TTL_DAYS=0 switches the cache off', () => withEnv({ ...LIVE, CACHE_TTL_DAYS: '0' }, async () => {
  const { call, calls } = setup();
  await call();
  await call();
  assert.equal(calls.convert, 2);
}));

test('a cached worksheet is shared between teachers, because it depends only on the PDF', () => withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'anna:a-code,ben:b-code' }, async () => {
  const { call, calls } = setup();
  await call({ code: 'a-code' });
  const second = await call({ code: 'b-code' });
  assert.equal(second.json.cached, true);
  assert.equal(calls.convert, 1);
}));

/* ---------- the daily budget ---------- */

test('each teacher has a daily limit, and colleagues are not affected', () => withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'anna:a-code,ben:b-code', DAILY_LIMIT_PER_TEACHER: '2' }, async () => {
  const { call, calls } = setup();
  assert.equal((await call({ code: 'a-code', body: { pdf: pdfNumber(1) } })).status, 200);
  assert.equal((await call({ code: 'a-code', body: { pdf: pdfNumber(2) } })).status, 200);
  const stopped = await call({ code: 'a-code', body: { pdf: pdfNumber(3) } });
  assert.equal(stopped.status, 429);
  assert.match(stopped.json.error, /your daily limit/);
  assert.ok(Number(stopped.headers['retry-after']) > 0);
  assert.equal(calls.convert, 2, 'the AI was not called for the blocked one');
  assert.equal((await call({ code: 'b-code', body: { pdf: pdfNumber(4) } })).status, 200);
}));

test('the school has a daily total too', () => withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'anna:a-code,ben:b-code', DAILY_LIMIT_TOTAL: '2' }, async () => {
  const { call } = setup();
  await call({ code: 'a-code', body: { pdf: pdfNumber(1) } });
  await call({ code: 'b-code', body: { pdf: pdfNumber(2) } });
  const stopped = await call({ code: 'a-code', body: { pdf: pdfNumber(3) } });
  assert.equal(stopped.status, 429);
  assert.match(stopped.json.error, /school has reached/);
}));

test('a reused worksheet costs nothing, so it never uses up the daily limit', () => withEnv({ ...LIVE, DAILY_LIMIT_TOTAL: '1' }, async () => {
  const { call } = setup();
  assert.equal((await call()).status, 200);
  assert.equal((await call()).json.cached, true);
  assert.equal((await call()).json.cached, true);
  assert.equal((await call({ body: { pdf: pdfNumber(5) } })).status, 429, 'a new PDF would cost, and the limit is reached');
}));

test('the old single shared code is limited by the school total only', () => withEnv({ ...LIVE, DAILY_LIMIT_PER_TEACHER: '1', DAILY_LIMIT_TOTAL: '3' }, async () => {
  const { call } = setup();
  for (let n = 1; n <= 3; n++) assert.equal((await call({ body: { pdf: pdfNumber(n) } })).status, 200);
  assert.equal((await call({ body: { pdf: pdfNumber(4) } })).status, 429);
}));

test('the budget starts again the next day', () => withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'anna:a-code', DAILY_LIMIT_PER_TEACHER: '1' }, async () => {
  const state = { time: Date.UTC(2026, 10, 20, 20, 0, 0) };
  const { call } = setup({ now: () => state.time });
  assert.equal((await call({ code: 'a-code', body: { pdf: pdfNumber(1) } })).status, 200);
  assert.equal((await call({ code: 'a-code', body: { pdf: pdfNumber(2) } })).status, 429);
  state.time = Date.UTC(2026, 10, 21, 0, 0, 5);
  assert.equal((await call({ code: 'a-code', body: { pdf: pdfNumber(2) } })).status, 200);
}));

test('a provider that is busy or down costs nothing, but a PDF the AI read and rejected does', async () => {
  await withEnv({ ...LIVE, DAILY_LIMIT_TOTAL: '1' }, async () => {
    let failure = new ConversionError(503, 'The AI service is busy. Try again in a minute.');
    const { call } = setup({ convert: async () => { throw failure; } });
    assert.equal((await call({ body: { pdf: pdfNumber(1) } })).status, 503);
    assert.equal((await call({ body: { pdf: pdfNumber(2) } })).status, 503, 'still allowed to try: nothing was used');
    failure = new ConversionError(422, 'No exercises were found in this PDF.');
    assert.equal((await call({ body: { pdf: pdfNumber(3) } })).status, 422);
    const stopped = await call({ body: { pdf: pdfNumber(4) } });
    assert.equal(stopped.status, 429, 'the 422 was paid for');
  });
});

test('errors that are not ConversionErrors are not hidden', () => withEnv(LIVE, async () => {
  const { call } = setup({ convert: async () => { throw new TypeError('bug'); } });
  await assert.rejects(() => call(), TypeError);
}));

/* ---------- privacy of what is stored ---------- */

test('what reaches the database holds no IP address, no access code and no PDF', async () => {
  const fake = createFakeRedis();
  const port = await fake.start();
  try {
    await withEnv({ ANTHROPIC_API_KEY: 'k', ACCESS_CODES: 'anna:anna-secret-code', UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + port, UPSTASH_REDIS_REST_TOKEN: 'test-token' }, async () => {
      const store = createStore({ redisUrl: 'http://127.0.0.1:' + port, redisToken: 'test-token' });
      const handler = createHandler({ store, convert: async () => JSON.parse(JSON.stringify(WORKSHEET)) });
      const res = fakeResponse();
      await handler({ method: 'POST', headers: { 'x-access-code': 'anna-secret-code', 'x-forwarded-for': '203.0.113.77' }, body: { pdf: pdfNumber(9) } }, res);
      assert.equal(res.statusCode, 200);
    });
    const everything = JSON.stringify(fake.log) + JSON.stringify([...fake.data.keys()]);
    assert.doesNotMatch(everything, /203\.0\.113\.77/);
    assert.doesNotMatch(everything, /anna-secret-code/);
    assert.doesNotMatch(everything, /JVBERi0x/);
    assert.ok([...fake.data.keys()].every(key => key.startsWith('vb:')));
    assert.ok([...fake.data.values()].every(entry => entry.expiresAt !== null), 'every key expires');
  } finally { await fake.stop(); }
});
