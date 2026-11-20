'use strict';
/**
 * Optional short links. A teacher can store a reviewed worksheet on the server and share a short link
 * (https://site/#w=ID) instead of the long one that carries the whole worksheet. A short link is small
 * enough for a QR code. Only the validated worksheet is stored, for SHARE_TTL_DAYS, under a random ID.
 */
const crypto = require('crypto');
const { LIMITS } = require('./config');
const { normalize } = require('./normalize');

/** 9 random bytes = 72 bits, written as 12 URL-safe characters: impossible to guess. */
const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const newId = () => crypto.randomBytes(9).toString('base64url');
const keyOf = id => 'vb:link:' + id;

/** An error whose message is safe to show to users. */
class LinkError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.name = 'LinkError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

const unavailable = () => new LinkError(503, 'Short links are not available right now. Use the long link instead.');

/**
 * `shared` is the store's Redis backend, or null when none is configured.
 * Returns the new ID. The worksheet is validated again here: the browser is not trusted.
 */
async function createLink(shared, rawWorksheet, ttlSeconds) {
  if (!shared) throw new LinkError(503, 'Short links are not set up on this server.');
  const worksheet = normalize(rawWorksheet);
  if (!worksheet.sections.length) throw new LinkError(400, 'There is nothing to share yet.');
  if (Buffer.byteLength(JSON.stringify(worksheet)) > LIMITS.maxSharedWorksheetBytes) {
    throw new LinkError(413, 'This worksheet is too large for a short link. Use the long link instead.');
  }
  const id = newId();
  try {
    await shared.putJson(keyOf(id), worksheet, ttlSeconds);
  } catch (error) {
    throw unavailable();
  }
  return id;
}

/** The worksheet behind a short link, or a LinkError (404 when it never existed or has expired). */
async function readLink(shared, id) {
  if (!ID_PATTERN.test(id)) throw new LinkError(404, 'This link is not valid. Ask your teacher for a new one.');
  if (!shared) throw unavailable();
  let saved;
  try {
    saved = await shared.getJson(keyOf(id));
  } catch (error) {
    throw unavailable();
  }
  if (!saved) throw new LinkError(404, 'This link has expired or does not exist. Ask your teacher for a new one.');
  return normalize(saved);
}

module.exports = { createLink, readLink, LinkError, ID_PATTERN };
