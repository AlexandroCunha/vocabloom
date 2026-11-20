'use strict';
/** Every setting the server reads, in one place. Nothing else touches process.env. */

const MB = 1024 * 1024;
const DAY_SECONDS = 24 * 60 * 60;

const LIMITS = Object.freeze({
  // Vercel serverless request bodies are limited to 4.5 MB, and base64 adds a third.
  maxPdfBase64Chars: 4.2 * MB,
  // Wrong access codes: 5 tries per 15 minutes, per client.
  wrongCodes: { limit: 5, windowSeconds: 15 * 60 },
  // Conversions cost money: 20 per hour per client (answers reused from the cache count too).
  conversions: { limit: 20, windowSeconds: 60 * 60 },
  // Short links: how many one client may create per hour, and how many it may open per minute.
  shareCreations: { limit: 30, windowSeconds: 60 * 60 },
  shareReads: { limit: 120, windowSeconds: 60 },
  // A stored worksheet is the validated JSON and never larger than this.
  maxSharedWorksheetBytes: 200 * 1024
});

const DEFAULTS = Object.freeze({
  dailyLimitPerTeacher: 30,
  dailyLimitTotal: 150,
  cacheTtlDays: 7,
  shareTtlDays: 90
});

const TEACHER_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** The example file uses CHANGE-ME codes. If one is deployed by mistake it must never work as a real code. */
const PLACEHOLDER_CODE = /change-me/i;

/**
 * ACCESS_CODES="anna:her-own-long-code,ben:his-own-long-code" gives every teacher a code of their own,
 * so one code can be withdrawn without changing the others. The older single ACCESS_CODE still works
 * and counts as one shared teacher. Entries that are not "name:code" are ignored, and so are placeholder
 * codes copied from .env.example (access is still required, so nobody gets in until a real code is set).
 */
function parseTeachers(accessCodes, accessCode) {
  const teachers = [];
  String(accessCodes || '').split(',').forEach(entry => {
    const separator = entry.indexOf(':');
    if (separator < 1) return;
    const name = entry.slice(0, separator).trim().toLowerCase();
    const code = entry.slice(separator + 1).trim();
    if (TEACHER_NAME.test(name) && code && !PLACEHOLDER_CODE.test(code) && !teachers.some(teacher => teacher.name === name)) {
      teachers.push({ name, code, shared: false });
    }
  });
  if (accessCode && !PLACEHOLDER_CODE.test(accessCode) && !teachers.some(teacher => teacher.name === 'shared')) {
    teachers.push({ name: 'shared', code: accessCode, shared: true });
  }
  return teachers;
}

/** A whole number from the environment, or the fallback when it is missing or not a valid number. */
function readWholeNumber(value, fallback, min) {
  if (value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= min ? Math.min(number, 100000) : fallback;
}

/** Read at request time so tests (and a redeploy with new variables) see the current values. */
function readConfig(env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY || '';
  return {
    // Any access setting at all means a code is required, even if none of the entries could be read:
    // a typo must lock people out, never open the door.
    requireCode: Boolean(env.ACCESS_CODES || env.ACCESS_CODE),
    teachers: parseTeachers(env.ACCESS_CODES, env.ACCESS_CODE),
    apiKey,
    apiUrl: env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages',
    model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    mock: env.MOCK === '1',
    production: env.VERCEL_ENV === 'production',
    // Optional shared database (Upstash Redis). The KV_ names are the ones Vercel's marketplace adds.
    redisUrl: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
    redisToken: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
    // 0 means "no limit" for the two daily limits and "off" for the cache.
    dailyLimitPerTeacher: readWholeNumber(env.DAILY_LIMIT_PER_TEACHER, DEFAULTS.dailyLimitPerTeacher, 0),
    dailyLimitTotal: readWholeNumber(env.DAILY_LIMIT_TOTAL, DEFAULTS.dailyLimitTotal, 0),
    cacheTtlSeconds: readWholeNumber(env.CACHE_TTL_DAYS, DEFAULTS.cacheTtlDays, 0) * DAY_SECONDS,
    shareTtlSeconds: readWholeNumber(env.SHARE_TTL_DAYS, DEFAULTS.shareTtlDays, 1) * DAY_SECONDS,
    // Secret that keeps stored client fingerprints from being turned back into IP addresses.
    clientSecret: env.RATE_LIMIT_SECRET || apiKey || 'vocabloom-local-development'
  };
}

module.exports = { LIMITS, DEFAULTS, DAY_SECONDS, readConfig, parseTeachers };
