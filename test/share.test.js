'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createHandler } = require('../api/share');
const { createStore } = require('../lib/store');
const { createFakeRedis } = require('../scripts/fake-redis');
const { ID_PATTERN } = require('../lib/links');

const WORKSHEET = {
  title: 'Unit 3',
  answerKeyFound: true,
  sections: [{ type: 'short', title: 'Words', items: [{ prompt: 'A big dog is ___', answers: ['huge'], hint: 'Very big' }] }]
};
const ENV_NAMES = ['ACCESS_CODE', 'ACCESS_CODES', 'SHARE_TTL_DAYS'];

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

/** The handler wired to a fake Redis (so links are shared, as in production) or to memory only. */
async function setup({ redis = true, now = Date.now } = {}) {
  const fake = createFakeRedis({ now });
  const port = redis ? await fake.start() : null;
  const store = createStore(redis ? { redisUrl: 'http://127.0.0.1:' + port, redisToken: 'test-token' } : { redisUrl: '', redisToken: '' }, { now, log: () => {} });
  const handler = createHandler({ store, now });
  async function call({ method = 'GET', query = '', code = 'teacher-code', body, ip = '10.0.0.1' } = {}) {
    const res = fakeResponse();
    await handler({ method, url: '/api/share' + query, headers: { 'x-access-code': code, 'x-forwarded-for': ip }, body }, res);
    return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
  }
  return { call, fake, store, stop: () => (redis ? fake.stop() : null) };
}

const LIVE = { ACCESS_CODES: 'anna:teacher-code' };

test('the server says whether short links are available', () => withEnv(LIVE, async () => {
  const withRedis = await setup();
  const without = await setup({ redis: false });
  try {
    assert.deepEqual((await withRedis.call()).json, { available: true });
    assert.deepEqual((await without.call()).json, { available: false });
  } finally { await withRedis.stop(); }
}));

test('a teacher stores a worksheet and anyone with the link can read it back', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  try {
    const created = await call({ method: 'POST', body: { worksheet: WORKSHEET } });
    assert.equal(created.status, 200);
    assert.match(created.json.id, ID_PATTERN);
    assert.equal(created.json.days, 90);

    const opened = await call({ query: '?id=' + created.json.id, code: '', ip: '10.0.0.50' });
    assert.equal(opened.status, 200);
    assert.equal(opened.json.worksheet.title, 'Unit 3');
    assert.equal(opened.json.worksheet.sections[0].items[0].answers[0], 'huge');
    assert.equal(opened.headers['cache-control'], 'no-store');
  } finally { await stop(); }
}));

test('creating a short link needs a valid access code', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  try {
    assert.equal((await call({ method: 'POST', code: 'nope', body: { worksheet: WORKSHEET } })).status, 401);
    assert.equal((await call({ method: 'POST', code: '', body: { worksheet: WORKSHEET } })).status, 401);
  } finally { await stop(); }
}));

test('without a shared database, creating a link says so, and opening one says it is unavailable', () => withEnv(LIVE, async () => {
  const { call } = await setup({ redis: false });
  const created = await call({ method: 'POST', body: { worksheet: WORKSHEET } });
  assert.equal(created.status, 503);
  assert.match(created.json.error, /not set up/);
  assert.equal((await call({ query: '?id=AAAAAAAAAAAA' })).status, 503);
}));

test('only a worksheet that has been validated is stored', () => withEnv(LIVE, async () => {
  const { call, fake, stop } = await setup();
  try {
    const dirty = {
      title: 'T'.repeat(500), extra: 'dropped',
      sections: [{ type: 'nonsense', title: 'x', items: [{ prompt: '<img src=x onerror=alert(1)>', answers: ['y'], secret: 'dropped' }] }]
    };
    const created = await call({ method: 'POST', body: { worksheet: dirty } });
    assert.equal(created.status, 200);
    const stored = JSON.parse([...fake.data.values()].find(entry => entry.value.startsWith('{')).value);
    assert.equal(stored.title.length, 200);
    assert.equal(stored.extra, undefined);
    assert.equal(stored.sections[0].type, 'open', 'unknown exercise types are reduced to a safe one');
    assert.equal(stored.sections[0].items[0].secret, undefined);
  } finally { await stop(); }
}));

test('nothing to share, or too much to share, is refused', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  try {
    assert.equal((await call({ method: 'POST', body: { worksheet: { title: 'Empty', sections: [] } } })).status, 400);
    assert.equal((await call({ method: 'POST', body: {} })).status, 400);
    const huge = { title: 'Big', sections: [{ type: 'short', title: 'x', items: Array.from({ length: 100 }, (_, i) => ({ prompt: 'p'.repeat(1500) + i, answers: ['a'.repeat(300)], hint: 'h'.repeat(300), explanation: 'e'.repeat(600) })) },
      { type: 'short', title: 'y', items: Array.from({ length: 100 }, (_, i) => ({ prompt: 'q'.repeat(1500) + i, answers: ['a'.repeat(300)], hint: 'h'.repeat(300), explanation: 'e'.repeat(600) })) }] };
    const refused = await call({ method: 'POST', body: { worksheet: huge } });
    assert.equal(refused.status, 413);
  } finally { await stop(); }
}));

test('a link that was never made, or is malformed, is a 404', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  try {
    assert.equal((await call({ query: '?id=AAAAAAAAAAAA' })).status, 404);
    assert.equal((await call({ query: '?id=short' })).status, 404);
    assert.equal((await call({ query: '?id=' + encodeURIComponent('../../etc/passwd') })).status, 404);
    assert.match((await call({ query: '?id=AAAAAAAAAAAA' })).json.error, /expired or does not exist/);
  } finally { await stop(); }
}));

test('links expire after SHARE_TTL_DAYS', () => withEnv({ ...LIVE, SHARE_TTL_DAYS: '1' }, async () => {
  const state = { time: 5000000 };
  const { call, stop } = await setup({ now: () => state.time });
  try {
    const id = (await call({ method: 'POST', body: { worksheet: WORKSHEET } })).json.id;
    assert.equal((await call({ query: '?id=' + id })).status, 200);
    state.time += 24 * 3600 * 1000 + 1000;
    assert.equal((await call({ query: '?id=' + id })).status, 404);
  } finally { await stop(); }
}));

test('every link gets its own unpredictable ID', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  try {
    const ids = new Set();
    for (let i = 0; i < 12; i++) ids.add((await call({ method: 'POST', body: { worksheet: WORKSHEET } })).json.id);
    assert.equal(ids.size, 12);
  } finally { await stop(); }
}));

test('if the database stops answering, students get a clear message instead of a crash', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  const id = (await call({ method: 'POST', body: { worksheet: WORKSHEET } })).json.id;
  await stop();
  const failed = await call({ query: '?id=' + id });
  assert.equal(failed.status, 503);
  assert.match(failed.json.error, /not available/);
}));

test('opening and creating links are rate limited', () => withEnv(LIVE, async () => {
  const { call, stop } = await setup();
  try {
    for (let i = 0; i < 120; i++) await call({ query: '?id=AAAAAAAAAAAA', ip: '10.0.0.7' });
    const blocked = await call({ query: '?id=AAAAAAAAAAAA', ip: '10.0.0.7' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers['retry-after']);
    assert.equal((await call({ query: '?id=AAAAAAAAAAAA', ip: '10.0.0.8' })).status, 404, 'another client is fine');

    for (let i = 0; i < 30; i++) assert.equal((await call({ method: 'POST', body: { worksheet: WORKSHEET }, ip: '10.0.0.9' })).status, 200);
    assert.equal((await call({ method: 'POST', body: { worksheet: WORKSHEET }, ip: '10.0.0.9' })).status, 429);
  } finally { await stop(); }
}));

test('other methods are refused', () => withEnv(LIVE, async () => {
  const { call } = await setup({ redis: false });
  assert.equal((await call({ method: 'DELETE' })).status, 405);
}));
