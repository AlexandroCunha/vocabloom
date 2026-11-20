'use strict';
/**
 * A tiny stand-in for Upstash Redis (its REST API), for local development and for the tests.
 * It understands only the commands Vocabloom uses: GET SET(EX, NX) INCR TTL DEL EXPIRE.
 *
 *   node scripts/fake-redis.js          starts it on http://127.0.0.1:8787 and prints the variables to use
 *
 * Nothing is saved to disk: stop it and everything is gone.
 */
const http = require('http');

function createFakeRedis({ now = Date.now, token = 'test-token' } = {}) {
  const data = new Map(); // key -> { value: string, expiresAt: number | null }
  const log = [];          // every command received, for tests

  function live(key) {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      data.delete(key);
      return null;
    }
    return entry;
  }

  /** Runs one command and returns its result, or throws an Error for a Redis error reply. */
  function run(args) {
    log.push(args.map(String));
    const [name, key, ...rest] = args.map(String);
    switch (name.toUpperCase()) {
      case 'GET': {
        const entry = live(key);
        return entry ? entry.value : null;
      }
      case 'SET': {
        const options = rest.slice(1).map(option => option.toUpperCase());
        const exIndex = options.indexOf('EX');
        if (options.includes('NX') && live(key)) return null;
        const seconds = exIndex >= 0 ? Number(rest[1 + exIndex + 1]) : null;
        if (exIndex >= 0 && !(seconds > 0)) throw new Error('ERR invalid expire time in set');
        data.set(key, { value: rest[0], expiresAt: seconds ? now() + seconds * 1000 : null });
        return 'OK';
      }
      case 'INCR': {
        const entry = live(key) || { value: '0', expiresAt: null };
        if (!/^-?\d+$/.test(entry.value)) throw new Error('ERR value is not an integer or out of range');
        entry.value = String(Number(entry.value) + 1);
        data.set(key, entry);
        return Number(entry.value);
      }
      case 'TTL': {
        const entry = live(key);
        if (!entry) return -2;
        return entry.expiresAt === null ? -1 : Math.max(1, Math.ceil((entry.expiresAt - now()) / 1000));
      }
      case 'EXPIRE': {
        const entry = live(key);
        if (!entry) return 0;
        entry.expiresAt = now() + Number(rest[0]) * 1000;
        return 1;
      }
      case 'DEL':
        return data.delete(key) ? 1 : 0;
      default:
        throw new Error('ERR unknown command ' + name);
    }
  }

  const outcome = args => {
    try { return { result: run(args) }; } catch (error) { return { error: error.message }; }
  };

  function respond(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer ' + token) return respond(res, 401, { error: 'Unauthorized' });
      let payload;
      try { payload = JSON.parse(text); } catch (error) { return respond(res, 400, { error: 'ERR invalid JSON' }); }
      if (req.url === '/pipeline' || req.url === '/multi-exec') {
        if (!Array.isArray(payload) || !payload.every(Array.isArray)) return respond(res, 400, { error: 'ERR invalid pipeline' });
        return respond(res, 200, payload.map(outcome));
      }
      if (!Array.isArray(payload)) return respond(res, 400, { error: 'ERR invalid command' });
      const result = outcome(payload);
      return respond(res, result.error ? 400 : 200, result);
    });
  });

  return {
    server,
    log,
    data,
    start: (port = 0) => new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address().port))),
    stop: () => new Promise(resolve => server.close(resolve))
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  const fake = createFakeRedis();
  fake.start(port).then(() => {
    console.log('Fake Upstash Redis running on http://127.0.0.1:' + port);
    console.log('Use it with the local server:');
    console.log('  UPSTASH_REDIS_REST_URL=http://127.0.0.1:' + port + ' UPSTASH_REDIS_REST_TOKEN=test-token node server.js');
  });
}

module.exports = { createFakeRedis };
