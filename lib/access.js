'use strict';
/** Who is asking? Checks the access code of a request, with a limit on wrong guesses. */
const { LIMITS } = require('./config');
const { findTeacher } = require('./security');
const { createLimiter } = require('./limits');
const { sendJson, sendTooManyRequests } = require('./http');

/** Used when no access code is configured at all (local development, demos). */
const OPEN_ACCESS = Object.freeze({ name: 'open', shared: true });

/**
 * Returns the teacher making the request, or null after sending the error response itself.
 * `client` is the fingerprint of the caller's address (see hashClient), never the address.
 */
async function authenticate({ req, res, config, store, client }) {
  if (!config.requireCode) return OPEN_ACCESS;

  const wrongCodes = createLimiter(store, { name: 'wrong', ...LIMITS.wrongCodes });
  // Checked before the code is even looked at: a client that is over the limit gets no more guesses,
  // not even a correct one.
  const before = await wrongCodes.check(client);
  if (before.limited) {
    sendTooManyRequests(res, before.retryAfter, 'Too many wrong access codes. Try again later.');
    return null;
  }

  const teacher = findTeacher(req.headers['x-access-code'] || '', config.teachers);
  if (!teacher) {
    await wrongCodes.hit(client);
    sendJson(res, 401, { error: 'Wrong or missing access code.' });
    return null;
  }
  if (before.count > 0) await wrongCodes.reset(client);
  return teacher;
}

module.exports = { authenticate, OPEN_ACCESS };
