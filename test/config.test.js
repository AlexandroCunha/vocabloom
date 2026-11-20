'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig, parseTeachers, DAY_SECONDS } = require('../lib/config');

test('every teacher can have a code of their own', () => {
  const teachers = parseTeachers('anna:code-one, Ben : code-two', '');
  assert.deepEqual(teachers.map(teacher => teacher.name), ['anna', 'ben']);
  assert.deepEqual(teachers.map(teacher => teacher.code), ['code-one', 'code-two']);
  assert.ok(teachers.every(teacher => teacher.shared === false));
});

test('a code may contain colons, and bad entries are ignored', () => {
  const teachers = parseTeachers('anna:abc:def,no-code,:orphan,BAD NAME:x,bob:', '');
  assert.deepEqual(teachers.map(teacher => [teacher.name, teacher.code]), [['anna', 'abc:def']]);
});

test('the first entry wins when a name is repeated', () => {
  assert.deepEqual(parseTeachers('anna:one,anna:two', '').map(teacher => teacher.code), ['one']);
});

test('the old single ACCESS_CODE still works, as one shared teacher', () => {
  const teachers = parseTeachers('', 'old-code');
  assert.deepEqual(teachers, [{ name: 'shared', code: 'old-code', shared: true }]);
  assert.equal(parseTeachers('anna:x', 'old-code').length, 2);
});

test('placeholder codes copied from .env.example never work, and access stays required', () => {
  assert.deepEqual(parseTeachers('anna:CHANGE-ME-long-code,ben:real-code', 'change-me-shared'), [{ name: 'ben', code: 'real-code', shared: false }]);
  const config = readConfig({ ACCESS_CODES: 'anna:CHANGE-ME-long-code', ACCESS_CODE: 'CHANGE-ME-long-shared-password' });
  assert.equal(config.requireCode, true, 'a deployment with only placeholders must not become open');
  assert.deepEqual(config.teachers, []);
});

test('any access setting makes a code required, even a broken one (typos lock people out)', () => {
  assert.equal(readConfig({}).requireCode, false);
  assert.equal(readConfig({ ACCESS_CODE: 'x' }).requireCode, true);
  const broken = readConfig({ ACCESS_CODES: 'oops-no-colon' });
  assert.equal(broken.requireCode, true);
  assert.deepEqual(broken.teachers, []);
});

test('daily limits, cache and links have sensible defaults and can be changed', () => {
  const defaults = readConfig({});
  assert.equal(defaults.dailyLimitPerTeacher, 30);
  assert.equal(defaults.dailyLimitTotal, 150);
  assert.equal(defaults.cacheTtlSeconds, 7 * DAY_SECONDS);
  assert.equal(defaults.shareTtlSeconds, 90 * DAY_SECONDS);

  const custom = readConfig({ DAILY_LIMIT_PER_TEACHER: '5', DAILY_LIMIT_TOTAL: '0', CACHE_TTL_DAYS: '0', SHARE_TTL_DAYS: '10' });
  assert.equal(custom.dailyLimitPerTeacher, 5);
  assert.equal(custom.dailyLimitTotal, 0);
  assert.equal(custom.cacheTtlSeconds, 0);
  assert.equal(custom.shareTtlSeconds, 10 * DAY_SECONDS);
});

test('numbers that make no sense fall back to the defaults', () => {
  const config = readConfig({ DAILY_LIMIT_PER_TEACHER: 'lots', DAILY_LIMIT_TOTAL: '-4', CACHE_TTL_DAYS: '1.5', SHARE_TTL_DAYS: '0' });
  assert.equal(config.dailyLimitPerTeacher, 30);
  assert.equal(config.dailyLimitTotal, 150);
  assert.equal(config.cacheTtlSeconds, 7 * DAY_SECONDS);
  assert.equal(config.shareTtlSeconds, 90 * DAY_SECONDS);
});

test('Redis settings are read from the Upstash names or the ones Vercel adds', () => {
  assert.equal(readConfig({ UPSTASH_REDIS_REST_URL: 'https://a', UPSTASH_REDIS_REST_TOKEN: 't1' }).redisUrl, 'https://a');
  const vercel = readConfig({ KV_REST_API_URL: 'https://b', KV_REST_API_TOKEN: 't2' });
  assert.deepEqual([vercel.redisUrl, vercel.redisToken], ['https://b', 't2']);
  assert.equal(readConfig({}).redisUrl, '');
});

test('the live site refuses to convert without an access code', () => {
  assert.equal(readConfig({ VERCEL_ENV: 'production' }).production, true);
  assert.equal(readConfig({ VERCEL_ENV: 'preview' }).production, false);
});

test('the client secret is never empty, and prefers its own setting', () => {
  assert.equal(readConfig({ RATE_LIMIT_SECRET: 'mine', ANTHROPIC_API_KEY: 'key' }).clientSecret, 'mine');
  assert.equal(readConfig({ ANTHROPIC_API_KEY: 'key' }).clientSecret, 'key');
  assert.ok(readConfig({}).clientSecret.length > 10);
});
