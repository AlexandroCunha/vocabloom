'use strict';
/**
 * The only module that talks to a database. Two backends behind one small interface:
 *
 *   - Upstash Redis over HTTPS, shared by every serverless instance (used when it is configured);
 *   - memory, private to one instance (used otherwise, and while Redis cannot be reached).
 *
 *   hit(key, ttlSeconds)             add one to a counter that expires ttlSeconds after its first hit -> { count, ttl }
 *   peek(key)                        read a counter without changing it                              -> { count, ttl }
 *   forget(key)                      delete a key
 *   getJson(key)                     -> value, or null
 *   putJson(key, value, ttlSeconds)  keep a value for ttlSeconds
 *
 * Nothing here ever writes a secret or an address to a log, and every key has an expiry.
 * `store.shared` is the Redis backend on its own, with no fallback: features that only make sense
 * when every instance sees the same data (short links) use it, and get an error instead of a guess.
 */

const MAX_MEMORY_KEYS = 2000;
const REDIS_TIMEOUT_MS = 3000;
const LOG_EVERY_MS = 60 * 1000;
const OPERATIONS = ['hit', 'peek', 'forget', 'getJson', 'putJson'];

class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

/* ---------- memory ---------- */

function createMemoryBackend(now = Date.now) {
  const entries = new Map(); // key -> { value, expiresAt }

  function live(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function makeRoom() {
    if (entries.size < MAX_MEMORY_KEYS) return;
    entries.forEach((entry, key) => { if (entry.expiresAt <= now()) entries.delete(key); });
    // Still full: drop the oldest entries first (a Map remembers insertion order).
    while (entries.size >= MAX_MEMORY_KEYS) entries.delete(entries.keys().next().value);
  }

  const secondsLeft = entry => Math.max(1, Math.ceil((entry.expiresAt - now()) / 1000));

  return {
    async hit(key, ttlSeconds) {
      let entry = live(key);
      if (!entry) {
        makeRoom();
        entry = { value: 0, expiresAt: now() + ttlSeconds * 1000 };
        entries.set(key, entry);
      }
      entry.value += 1;
      return { count: entry.value, ttl: secondsLeft(entry) };
    },
    async peek(key) {
      const entry = live(key);
      return entry ? { count: Number(entry.value) || 0, ttl: secondsLeft(entry) } : { count: 0, ttl: 0 };
    },
    async forget(key) {
      entries.delete(key);
    },
    async getJson(key) {
      const entry = live(key);
      return entry ? JSON.parse(entry.value) : null;
    },
    async putJson(key, value, ttlSeconds) {
      makeRoom();
      entries.set(key, { value: JSON.stringify(value), expiresAt: now() + ttlSeconds * 1000 });
    }
  };
}

/* ---------- Upstash Redis (REST) ---------- */

// The token travels in a header, so the address must be HTTPS. Plain http is only for a local test server.
const REDIS_URL = /^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function createRedisBackend({ url, token, fetch: fetchImpl, timeoutMs = REDIS_TIMEOUT_MS }) {
  const base = String(url).replace(/\/+$/, '');
  if (!REDIS_URL.test(base)) throw new StoreError('The Redis address must start with https://');
  if (!token) throw new StoreError('The Redis token is missing');

  async function send(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (fetchImpl || globalThis.fetch)(base + path, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await response.json();
      if (!response.ok) throw new StoreError('Redis answered with status ' + response.status);
      return body;
    } catch (error) {
      // Never pass the original error on: it can contain the address.
      throw error instanceof StoreError ? error : new StoreError('Redis request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /** One command: ["SET", "key", "value"]. */
  async function command(args) {
    const body = await send('', args);
    if (!body || body.error !== undefined) throw new StoreError('Redis returned an error');
    return body.result;
  }

  /** Several commands in one request. `atomic` runs them as a transaction with nothing in between. */
  async function batch(commands, atomic) {
    const body = await send(atomic ? '/multi-exec' : '/pipeline', commands);
    if (!Array.isArray(body) || body.length !== commands.length || body.some(item => !item || item.error !== undefined)) {
      throw new StoreError('Redis returned an unexpected reply');
    }
    return body.map(item => item.result);
  }

  return {
    async hit(key, ttlSeconds) {
      // SET ... NX only creates the counter (with its expiry) when it does not exist yet.
      const [, count, ttl] = await batch([
        ['SET', key, '0', 'EX', String(ttlSeconds), 'NX'],
        ['INCR', key],
        ['TTL', key]
      ], true);
      if (Number(ttl) < 0) {
        // A counter without an expiry would live forever: repair it.
        await command(['EXPIRE', key, String(ttlSeconds)]);
        return { count: Number(count), ttl: ttlSeconds };
      }
      return { count: Number(count), ttl: Number(ttl) };
    },
    async peek(key) {
      const [value, ttl] = await batch([['GET', key], ['TTL', key]], false);
      return { count: Number(value) || 0, ttl: Number(ttl) > 0 ? Number(ttl) : 0 };
    },
    async forget(key) {
      await command(['DEL', key]);
    },
    async getJson(key) {
      const value = await command(['GET', key]);
      if (!value) return null;
      try { return JSON.parse(value); } catch (error) { return null; }
    },
    async putJson(key, value, ttlSeconds) {
      await command(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]);
    }
  };
}

/* ---------- the store the rest of the app uses ---------- */

/**
 * Redis when configured, memory otherwise. If Redis stops answering, each call falls back to memory
 * (limits then work per instance, which is weaker but never blocks a teacher) and one line is logged.
 */
function createStore(config, deps = {}) {
  const now = deps.now || Date.now;
  const log = deps.log || console.error;
  const memory = createMemoryBackend(now);
  const memoryStore = Object.assign({ persistent: false, shared: null }, memory);
  if (!config.redisUrl && !config.redisToken) return memoryStore;

  let redis;
  try {
    redis = createRedisBackend({ url: config.redisUrl, token: config.redisToken, fetch: deps.fetch, timeoutMs: deps.timeoutMs });
  } catch (error) {
    log('Redis is configured but cannot be used (' + error.message + '). Using memory instead.');
    return memoryStore;
  }

  const store = { persistent: true, shared: redis };
  let lastLogAt = -Infinity;
  OPERATIONS.forEach(name => {
    store[name] = async (...args) => {
      try {
        return await redis[name](...args);
      } catch (error) {
        const time = now();
        if (time - lastLogAt >= LOG_EVERY_MS) {
          lastLogAt = time;
          log('Redis is not answering (' + error.message + '). Using memory for now.');
        }
        return memory[name](...args);
      }
    };
  });
  return store;
}

/** One store per server instance, rebuilt only if the settings change (which tests do). */
let remembered = { key: null, store: null };
function storeFor(config) {
  const key = config.redisUrl + '|' + config.redisToken;
  if (remembered.key !== key || !remembered.store) remembered = { key, store: createStore(config) };
  return remembered.store;
}

module.exports = { createStore, createMemoryBackend, createRedisBackend, storeFor, StoreError };
