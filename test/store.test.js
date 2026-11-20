'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, createMemoryBackend, createRedisBackend, StoreError } = require('../lib/store');
const { createFakeRedis } = require('../scripts/fake-redis');

/** A clock the test can move forward. */
function clock(start = 1000000) {
  const state = { time: start };
  const now = () => state.time;
  now.advance = seconds => { state.time += seconds * 1000; };
  return now;
}

async function withFakeRedis(run, now = clock()) {
  const fake = createFakeRedis({ now });
  const port = await fake.start();
  try { return await run({ fake, now, url: 'http://127.0.0.1:' + port, token: 'test-token' }); } finally { await fake.stop(); }
}

/* ---------- memory ---------- */

test('memory: a counter counts, remembers how long it has left, and starts again after it expires', async () => {
  const now = clock();
  const memory = createMemoryBackend(now);
  assert.deepEqual(await memory.peek('k'), { count: 0, ttl: 0 });
  assert.deepEqual(await memory.hit('k', 60), { count: 1, ttl: 60 });
  now.advance(20);
  assert.deepEqual(await memory.hit('k', 60), { count: 2, ttl: 40 });
  assert.deepEqual(await memory.peek('k'), { count: 2, ttl: 40 });
  now.advance(41);
  assert.deepEqual(await memory.peek('k'), { count: 0, ttl: 0 });
  assert.equal((await memory.hit('k', 60)).count, 1);
});

test('memory: forget removes a key', async () => {
  const memory = createMemoryBackend(clock());
  await memory.hit('k', 60);
  await memory.forget('k');
  assert.equal((await memory.peek('k')).count, 0);
});

test('memory: values come back as copies and expire', async () => {
  const now = clock();
  const memory = createMemoryBackend(now);
  const original = { title: 'A', list: [1, 2] };
  await memory.putJson('v', original, 30);
  original.list.push(3);
  assert.deepEqual(await memory.getJson('v'), { title: 'A', list: [1, 2] });
  now.advance(31);
  assert.equal(await memory.getJson('v'), null);
});

test('memory: it never grows without limit', async () => {
  const memory = createMemoryBackend(clock());
  for (let i = 0; i < 2600; i++) await memory.hit('key' + i, 60);
  assert.equal((await memory.peek('key0')).count, 0, 'the oldest entries are dropped first');
  assert.equal((await memory.peek('key2599')).count, 1);
});

/* ---------- Redis (talking to the fake REST server) ---------- */

test('redis: a counter is created with an expiry, counts up, and expires', () => withFakeRedis(async ({ fake, now, url, token }) => {
  const redis = createRedisBackend({ url, token });
  assert.deepEqual(await redis.hit('vb:test', 60), { count: 1, ttl: 60 });
  now.advance(10);
  assert.deepEqual(await redis.hit('vb:test', 60), { count: 2, ttl: 50 });
  assert.deepEqual(await redis.peek('vb:test'), { count: 2, ttl: 50 });
  now.advance(51);
  assert.deepEqual(await redis.peek('vb:test'), { count: 0, ttl: 0 });
  assert.equal((await redis.hit('vb:test', 60)).count, 1);
  assert.ok(fake.log.some(command => command[0] === 'SET' && command.includes('NX') && command.includes('EX')), 'creates the counter with SET ... EX ... NX');
}));

test('redis: a counter that somehow has no expiry is repaired', () => withFakeRedis(async ({ fake, url, token }) => {
  fake.data.set('vb:stuck', { value: '4', expiresAt: null });
  const redis = createRedisBackend({ url, token });
  assert.deepEqual(await redis.hit('vb:stuck', 90), { count: 5, ttl: 90 });
  assert.equal(fake.data.get('vb:stuck').expiresAt > 0, true);
}));

test('redis: values are stored as JSON with an expiry, and forget deletes them', () => withFakeRedis(async ({ now, url, token }) => {
  const redis = createRedisBackend({ url, token });
  await redis.putJson('vb:v', { title: 'Ñ' }, 30);
  assert.deepEqual(await redis.getJson('vb:v'), { title: 'Ñ' });
  await redis.forget('vb:v');
  assert.equal(await redis.getJson('vb:v'), null);
  await redis.putJson('vb:w', { a: 1 }, 5);
  now.advance(6);
  assert.equal(await redis.getJson('vb:w'), null);
}));

test('redis: a wrong token is an error, and the error never contains the token or the address', () => withFakeRedis(async ({ url }) => {
  const redis = createRedisBackend({ url, token: 'super-secret-token' });
  await assert.rejects(() => redis.peek('k'), error => {
    assert.ok(error instanceof StoreError);
    assert.doesNotMatch(error.message, /super-secret|127\.0\.0\.1/);
    return true;
  });
}));

test('redis: an unreachable server or a slow one is a StoreError, not a hang', async () => {
  const refused = createRedisBackend({ url: 'http://127.0.0.1:1', token: 't' });
  await assert.rejects(() => refused.hit('k', 5), StoreError);

  const hanging = createRedisBackend({
    url: 'https://example.invalid', token: 't', timeoutMs: 30,
    fetch: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  });
  const started = Date.now();
  await assert.rejects(() => hanging.peek('k'), StoreError);
  assert.ok(Date.now() - started < 1000);
});

test('redis: only HTTPS addresses are accepted (the token is sent in a header), plus a local test server', () => {
  assert.throws(() => createRedisBackend({ url: 'http://example.com', token: 't' }), StoreError);
  assert.throws(() => createRedisBackend({ url: 'ftp://example.com', token: 't' }), StoreError);
  assert.throws(() => createRedisBackend({ url: 'https://example.upstash.io', token: '' }), StoreError);
  assert.doesNotThrow(() => createRedisBackend({ url: 'https://example.upstash.io/', token: 't' }));
  assert.doesNotThrow(() => createRedisBackend({ url: 'http://localhost:8787', token: 't' }));
});

/* ---------- the store the app uses ---------- */

test('without Redis settings the store is memory only, with no shared backend', async () => {
  const store = createStore({ redisUrl: '', redisToken: '' });
  assert.equal(store.persistent, false);
  assert.equal(store.shared, null);
  assert.equal((await store.hit('k', 60)).count, 1);
});

test('with Redis settings the store is shared and counts in Redis', () => withFakeRedis(async ({ fake, url, token }) => {
  const store = createStore({ redisUrl: url, redisToken: token });
  assert.equal(store.persistent, true);
  assert.ok(store.shared);
  await store.hit('vb:a', 60);
  assert.equal(fake.data.get('vb:a').value, '1');
}));

test('if Redis stops answering, the store keeps working from memory and says so once', async () => {
  const logged = [];
  const store = createStore({ redisUrl: 'http://127.0.0.1:1', redisToken: 't' }, { log: line => logged.push(line), now: clock() });
  assert.equal((await store.hit('k', 60)).count, 1);
  assert.equal((await store.hit('k', 60)).count, 2);
  await store.putJson('v', { ok: true }, 60);
  assert.deepEqual(await store.getJson('v'), { ok: true });
  assert.equal(logged.length, 1, 'one line, not one per call');
  assert.doesNotMatch(logged[0], /127\.0\.0\.1|token/i);
  await assert.rejects(() => store.shared.peek('k'), StoreError, 'the shared backend never pretends');
});

test('a broken Redis setting falls back to memory and says why', async () => {
  const logged = [];
  const store = createStore({ redisUrl: 'http://example.com', redisToken: 'secret-token' }, { log: line => logged.push(line) });
  assert.equal(store.persistent, false);
  assert.equal(store.shared, null);
  assert.equal(logged.length, 1);
  assert.doesNotMatch(logged[0], /secret-token/);
  const half = createStore({ redisUrl: 'https://example.upstash.io', redisToken: '' }, { log: () => {} });
  assert.equal(half.persistent, false);
});
