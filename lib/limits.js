'use strict';
/** Rate limits and daily budgets, kept in the store so every server instance counts together. */

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const NOTHING = { count: 0, ttl: 0 };

/** Fixed-window limiter: at most `limit` hits in every `windowSeconds`, counted separately for each id. */
function createLimiter(store, { name, limit, windowSeconds }) {
  const keyOf = id => 'vb:' + name + ':' + id;
  return {
    /** Counts one attempt. `limited` is true when it went over the limit. */
    async hit(id) {
      const { count, ttl } = await store.hit(keyOf(id), windowSeconds);
      return { limited: count > limit, retryAfter: ttl };
    },
    /** Looks without counting. Limited once `limit` attempts have been counted. */
    async check(id) {
      const { count, ttl } = await store.peek(keyOf(id));
      return { limited: count >= limit, retryAfter: ttl, count };
    },
    reset(id) {
      return store.forget(keyOf(id));
    }
  };
}

const utcDay = time => new Date(time).toISOString().slice(0, 10);

function secondsUntilNextUtcDay(time) {
  const today = new Date(time);
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - time) / 1000));
}

/**
 * How many conversions each teacher, and everyone together, may start per day (UTC day).
 * A conversion is only counted once the AI has done the work, so a failed call does not use it up.
 * A limit of 0 means "no limit". The counts always keep going, so usage stays visible.
 */
function createDailyBudget(store, { now = Date.now } = {}) {
  const teacherKey = (teacher, day) => 'vb:day:' + day + ':t:' + teacher;
  const totalKey = day => 'vb:day:' + day + ':all';

  return {
    /** { allowed: true }, or { allowed: false, scope: 'teacher' | 'total', retryAfter } */
    async check(teacher, limits) {
      const day = utcDay(now());
      const [mine, everyone] = await Promise.all([
        limits.perTeacher ? store.peek(teacherKey(teacher, day)) : NOTHING,
        limits.total ? store.peek(totalKey(day)) : NOTHING
      ]);
      const retryAfter = secondsUntilNextUtcDay(now());
      if (limits.perTeacher && mine.count >= limits.perTeacher) return { allowed: false, scope: 'teacher', retryAfter };
      if (limits.total && everyone.count >= limits.total) return { allowed: false, scope: 'total', retryAfter };
      return { allowed: true };
    },
    async spend(teacher) {
      const day = utcDay(now());
      await Promise.all([
        store.hit(teacherKey(teacher, day), TWO_DAYS_SECONDS),
        store.hit(totalKey(day), TWO_DAYS_SECONDS)
      ]);
    }
  };
}

module.exports = { createLimiter, createDailyBudget, utcDay, secondsUntilNextUtcDay };
