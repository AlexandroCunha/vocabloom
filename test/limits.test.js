'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryBackend } = require('../lib/store');
const { createLimiter, createDailyBudget, utcDay, secondsUntilNextUtcDay } = require('../lib/limits');

function clock(start) {
  const state = { time: start };
  const now = () => state.time;
  now.advance = seconds => { state.time += seconds * 1000; };
  return now;
}

test('a limiter allows the limit, blocks the next hit, and recovers after the window', async () => {
  const now = clock(0);
  const limiter = createLimiter(createMemoryBackend(now), { name: 't', limit: 2, windowSeconds: 10 });
  assert.equal((await limiter.hit('a')).limited, false);
  assert.equal((await limiter.hit('a')).limited, false);
  const blocked = await limiter.hit('a');
  assert.equal(blocked.limited, true);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 10);
  assert.equal((await limiter.hit('b')).limited, false, 'other clients are not affected');
  now.advance(11);
  assert.equal((await limiter.hit('a')).limited, false);
});

test('check looks without counting, and reset forgets', async () => {
  const limiter = createLimiter(createMemoryBackend(clock(0)), { name: 't', limit: 2, windowSeconds: 10 });
  assert.deepEqual(await limiter.check('a'), { limited: false, retryAfter: 0, count: 0 });
  await limiter.hit('a');
  await limiter.hit('a');
  const state = await limiter.check('a');
  assert.equal(state.limited, true, 'limited as soon as the limit has been used');
  assert.equal(state.count, 2);
  assert.equal((await limiter.check('a')).count, 2, 'checking does not count');
  await limiter.reset('a');
  assert.equal((await limiter.check('a')).limited, false);
});

test('limiters with different names do not share counters', async () => {
  const store = createMemoryBackend(clock(0));
  const one = createLimiter(store, { name: 'one', limit: 1, windowSeconds: 10 });
  const two = createLimiter(store, { name: 'two', limit: 1, windowSeconds: 10 });
  await one.hit('x');
  assert.equal((await one.hit('x')).limited, true);
  assert.equal((await two.hit('x')).limited, false);
});

test('the day is the UTC day, and the wait is until the next UTC midnight', () => {
  const evening = Date.UTC(2026, 10, 20, 23, 59, 0);
  assert.equal(utcDay(evening), '2026-11-20');
  assert.equal(secondsUntilNextUtcDay(evening), 60);
  assert.equal(utcDay(evening + 60 * 1000), '2026-11-21');
});

test('a teacher can be stopped at their own limit without affecting colleagues', async () => {
  const budget = createDailyBudget(createMemoryBackend(clock(Date.UTC(2026, 10, 20, 9))), { now: clock(Date.UTC(2026, 10, 20, 9)) });
  const limits = { perTeacher: 2, total: 100 };
  assert.equal((await budget.check('anna', limits)).allowed, true);
  await budget.spend('anna');
  await budget.spend('anna');
  const stopped = await budget.check('anna', limits);
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.scope, 'teacher');
  assert.equal((await budget.check('ben', limits)).allowed, true);
});

test('the school total stops everyone', async () => {
  const now = clock(Date.UTC(2026, 10, 20, 9));
  const budget = createDailyBudget(createMemoryBackend(now), { now });
  const limits = { perTeacher: 10, total: 3 };
  await budget.spend('anna');
  await budget.spend('ben');
  await budget.spend('cara');
  const stopped = await budget.check('dan', limits);
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.scope, 'total');
});

test('a limit of 0 means no limit', async () => {
  const now = clock(Date.UTC(2026, 10, 20, 9));
  const budget = createDailyBudget(createMemoryBackend(now), { now });
  for (let i = 0; i < 5; i++) await budget.spend('anna');
  assert.equal((await budget.check('anna', { perTeacher: 0, total: 0 })).allowed, true);
});

test('the budget starts again the next day, and says how long to wait', async () => {
  const now = clock(Date.UTC(2026, 10, 20, 23, 0, 0));
  const budget = createDailyBudget(createMemoryBackend(now), { now });
  await budget.spend('anna');
  const stopped = await budget.check('anna', { perTeacher: 1, total: 0 });
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.retryAfter, 3600);
  now.advance(3600);
  assert.equal((await budget.check('anna', { perTeacher: 1, total: 0 })).allowed, true);
});
