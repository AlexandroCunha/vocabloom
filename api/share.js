'use strict';
/**
 * Optional short links (they make QR codes possible). Needs the shared database (Upstash Redis).
 *
 *   GET  /api/share           -> { available: true | false }
 *   GET  /api/share?id=ID     -> { worksheet }        students open a short link; no access code needed
 *   POST /api/share           -> { id, days }         teachers store a reviewed worksheet; needs x-access-code
 *        body: { worksheet: {...} }
 */
const { LIMITS, readConfig, DAY_SECONDS } = require('../lib/config');
const { hashClient, clientIp } = require('../lib/security');
const { sendJson, sendTooManyRequests, readJsonBody, readQuery } = require('../lib/http');
const { storeFor, createMemoryBackend } = require('../lib/store');
const { createLimiter } = require('../lib/limits');
const { authenticate } = require('../lib/access');
const { createLink, readLink, LinkError } = require('../lib/links');

function respondWithLinkError(res, error) {
  if (!(error instanceof LinkError)) throw error;
  sendJson(res, error.status, { error: error.publicMessage });
}

/** `deps.store` and `deps.now` exist for tests. */
function createHandler(deps = {}) {
  // Reading a link costs next to nothing, so its limit lives in this instance's memory and never
  // adds load to the database. Creating a link is limited in the shared store, like conversions.
  const readCounters = createMemoryBackend(deps.now);

  async function open(req, res, config, store, client) {
    const id = readQuery(req, 'id');
    if (!id) return sendJson(res, 200, { available: Boolean(store.shared) });

    const attempt = await createLimiter(readCounters, { name: 'share-read', ...LIMITS.shareReads }).hit(client);
    if (attempt.limited) return sendTooManyRequests(res, attempt.retryAfter, 'Too many requests. Try again in a minute.');

    try {
      sendJson(res, 200, { worksheet: await readLink(store.shared, id) });
    } catch (error) {
      respondWithLinkError(res, error);
    }
  }

  async function create(req, res, config, store, client) {
    const teacher = await authenticate({ req, res, config, store, client });
    if (!teacher) return;

    const attempt = await createLimiter(store, { name: 'share-create', ...LIMITS.shareCreations }).hit(client);
    if (attempt.limited) return sendTooManyRequests(res, attempt.retryAfter, 'Too many short links created. Try again later.');

    const body = readJsonBody(req);
    try {
      const id = await createLink(store.shared, body && body.worksheet, config.shareTtlSeconds);
      sendJson(res, 200, { id, days: Math.round(config.shareTtlSeconds / DAY_SECONDS) });
    } catch (error) {
      respondWithLinkError(res, error);
    }
  }

  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    }
    const config = readConfig();
    const store = deps.store || storeFor(config);
    const client = hashClient(clientIp(req), config.clientSecret);
    return req.method === 'GET' ? open(req, res, config, store, client) : create(req, res, config, store, client);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
